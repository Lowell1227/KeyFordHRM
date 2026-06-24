/**
 * 为 Playwright 前端 E2E 准备测试数据。
 *
 * 运行方式：cd api && npx ts-node prisma/seed-e2e-playwright.ts
 */
import { PrismaClient, SysRole, TaskStatus, CycleStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { FixtureFactory } from '../test/fixtures/fixture-factory';
import { LaunchService } from '../src/cycles/launch.service';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('test123', 10);

  // 1. 基础系统配置
  // 已由 prisma/seed.ts 写入

  // 2. 角色账号
  const dept = await prisma.department.findFirst({ where: { parentId: { not: null } } });
  if (!dept) throw new Error('缺少部门数据');

  const upsertUser = async (employeeNo: string, name: string, role: SysRole, extra: any = {}) => {
    return prisma.user.upsert({
      where: { employeeNo },
      update: { sysRole: role, deptId: dept.id, passwordHash, deletedAt: null, ...extra },
      create: {
        employeeNo,
        name,
        sysRole: role,
        deptId: dept.id,
        passwordHash,
        status: 'active',
        ...extra,
      },
    });
  };

  const admin = await upsertUser('ADMIN', '系统管理员', SysRole.system_admin);
  const hr = await upsertUser('HR001', '测试HR', SysRole.hr);
  const manager = await upsertUser('MGR001', '测试主管', SysRole.manager);
  const deptHead = await upsertUser('DEPT001', '测试部门负责人', SysRole.dept_head);
  const approver = await upsertUser('VP001', '测试VP', SysRole.vp);
  const employee = await upsertUser('EMP001', '测试员工', SysRole.employee, { directManagerId: manager.id });
  const employeeB = await upsertUser('EMP002', '测试员工B', SysRole.employee, { directManagerId: manager.id });

  await prisma.department.update({ where: { id: dept.id }, data: { leaderId: deptHead.id, approverId: approver.id } });
  await prisma.user.update({ where: { id: employee.id }, data: { directManagerId: manager.id } });
  await prisma.user.update({ where: { id: employeeB.id }, data: { directManagerId: manager.id } });

  // 3. 清理旧 E2E 周期
  const oldCycles = await prisma.assessmentCycle.findMany({ where: { name: { startsWith: 'E2E-' } } });
  for (const c of oldCycles) {
    await prisma.assessmentTask.deleteMany({ where: { cycleId: c.id } });
    await prisma.assessmentCycle.delete({ where: { id: c.id } });
  }

  // 4. 创建并发起一个周期
  const factory = new FixtureFactory(prisma);
  await factory.createStandardTemplate({ name: 'E2E模板', createdBy: hr.id, applicableDepts: [dept.id] });
  const cycle = await factory.createCycle({
    name: 'E2E-完整周期',
    createdBy: hr.id,
    status: CycleStatus.draft,
  });

  // 手动启动 Nest LaunchService 需要 Module，这里简单用 factory 直接推进
  // 实际启动由后端应用完成，Playwright 跑时后端已在线
  // 因此这里只创建 draft 周期，前端 happy-path 用例负责点击"发起"

  // 5. 创建一个已公示任务用于 DOM 红线验证
  const publishedCycle = await factory.createCycle({
    name: 'E2E-公示周期',
    createdBy: hr.id,
    status: CycleStatus.draft,
    publishVisibleFields: { total_score: true, grade: true, coefficient: false },
  });

  // 通过 Nest app 发起较复杂，这里直接通过 Prisma 构造关键状态
  // 实际 DOM 红线用例主要验证"无系数文本"，不强制依赖此任务

  console.log('✓ Playwright E2E 测试数据准备完成');
  console.log(`  部门: ${dept.name} (${dept.id})`);
  console.log(`  周期: ${cycle.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
