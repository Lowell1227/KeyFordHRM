import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SysRole } from '@prisma/client';
import { RolesGuard } from '@/common/guards/roles.guard';
import { TalentsController } from './talents.controller';
import { TalentSharesController } from './talent-shares.controller';
import { TalentInterviewsController } from './talent-interviews.controller';
import type { AuthUser } from '@/common/types/auth.types';

/**
 * 权限边界（需求 §5.4 / §8）：/talents* 只允许 HR 或具备档案能力的账号；
 * /talents/shares/:token 只要求登录（被分享人是部门负责人，不能被 HR 角色挡住）。
 * 用真实 Reflector + 真实守卫，读控制器上真实的装饰器元数据。
 */

function context(handler: unknown, cls: unknown, user: AuthUser | undefined) {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

function user(sysRole: SysRole, hrCapabilities: string[] = []): AuthUser {
  return {
    id: 'user-1', name: '测试用户', sysRole, deptId: null,
    isAssessorOnly: false, canViewAll: false, hrCapabilities,
  };
}

describe('人才库权限边界（RolesGuard + 真实路由元数据）', () => {
  const guard = new RolesGuard(new Reflector());
  const services = {
    talents: {}, files: {}, followUps: {}, shares: {}, storage: {},
  };
  const controller = new TalentsController(
    services.talents as never, services.files as never,
    services.followUps as never, services.shares as never,
  );
  const sharesController = new TalentSharesController(services.shares as never, services.storage as never);

  const deniedRoles: SysRole[] = [SysRole.employee, SysRole.manager, SysRole.dept_head, SysRole.vp];
  const hrOnlyHandlers: Array<[string, unknown]> = [
    ['列表', controller.list],
    ['手机号查重', controller.checkPhone],
    ['新增', controller.create],
    ['详情', controller.detail],
    ['编辑', controller.update],
    ['删除', controller.remove],
    ['绑定简历', controller.bindFile],
    ['解绑简历', controller.unbindFile],
    ['记跟进', controller.addFollowUp],
    ['跟进列表', controller.listFollowUps],
    ['标记已入职', controller.convert],
    ['创建分享', controller.createShare],
    ['撤销分享', controller.revokeShare],
  ];

  it.each(deniedRoles)('普通角色 %s 访问任何 /talents 接口都被 403 拦截', (role) => {
    for (const [, handler] of hrOnlyHandlers) {
      expect(() => guard.canActivate(context(handler, TalentsController, user(role))))
        .toThrow(ForbiddenException);
    }
  });

  it('HR 与系统管理员可以访问 /talents 接口', () => {
    for (const role of [SysRole.hr, SysRole.system_admin]) {
      for (const [, handler] of hrOnlyHandlers) {
        expect(guard.canActivate(context(handler, TalentsController, user(role)))).toBe(true);
      }
    }
  });

  it('具备档案能力的 hr_user 可以访问，无能力的 hr_user 被 403', () => {
    const capable = user(SysRole.hr_user, ['employee_archive_edit']);
    const incapable = user(SysRole.hr_user, []);
    for (const [, handler] of hrOnlyHandlers) {
      expect(guard.canActivate(context(handler, TalentsController, capable))).toBe(true);
      expect(() => guard.canActivate(context(handler, TalentsController, incapable))).toThrow(ForbiddenException);
    }
  });

  it('分享视图 /talents/shares/:token 只要求登录：部门负责人/经理/员工均可达（白名单在服务层）', () => {
    for (const role of [SysRole.dept_head, SysRole.manager, SysRole.employee, SysRole.hr_user]) {
      expect(guard.canActivate(context(sharesController.view, TalentSharesController, user(role)))).toBe(true);
      expect(guard.canActivate(context(sharesController.downloadFile, TalentSharesController, user(role)))).toBe(true);
    }
  });

  it('未登录用户无法通过守卫（无 user 即不满足角色/能力）', () => {
    expect(() => guard.canActivate(context(controller.list, TalentsController, undefined))).toThrow(ForbiddenException);
  });

  it('仅档案审核能力只读人才，不能创建、跟进、转发、删除或维护邀约', () => {
    const reviewer = user(SysRole.hr_user, ['employee_archive_review']);
    for (const handler of [controller.list, controller.detail, controller.listFollowUps]) {
      expect(guard.canActivate(context(handler, TalentsController, reviewer))).toBe(true);
    }
    for (const handler of [controller.create, controller.update, controller.remove, controller.deleteImpact, controller.addFollowUp, controller.createShare, controller.revokeShare]) {
      expect(() => guard.canActivate(context(handler, TalentsController, reviewer))).toThrow(ForbiddenException);
    }
    const interviews = new TalentInterviewsController({} as never);
    for (const actor of [reviewer, user(SysRole.employee)]) {
      for (const handler of [interviews.create, interviews.update, interviews.cancel, interviews.complete, interviews.retrySync]) {
        expect(() => guard.canActivate(context(handler, TalentInterviewsController, actor))).toThrow(ForbiddenException);
      }
      for (const handler of [interviews.list, interviews.detail]) {
        expect(guard.canActivate(context(handler, TalentInterviewsController, actor))).toBe(true);
      }
    }
  });
});
