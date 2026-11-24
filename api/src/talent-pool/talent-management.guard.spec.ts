import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { TalentManagementGuard } from './talent-management.guard';
import { TalentResumeController } from './talent-resume.controller';
import { TalentResumeTasksController } from './talent-resume-tasks.controller';
import { TalentSharesController } from './talent-shares.controller';

describe('recruitment management assessor boundary', () => {
  const guard = new TalentManagementGuard();
  const context = user => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as never;

  it.each(['hr', 'system_admin', 'hr_user', 'employee'])('denies mixed assessor-only %s before management handlers run', sysRole => {
    expect(() => guard.canActivate(context({ id: 'fixture', sysRole, isAssessorOnly: true,
      hrCapabilities: ['recruitment_view', 'employee_archive_edit', 'employee_archive_review'] }))).toThrow(ForbiddenException);
  });

  it('does not invent an AuthUser status requirement or treat this boundary as a capability grant', () => {
    expect(guard.canActivate(context({ id: 'fixture', sysRole: 'hr', isAssessorOnly: false }))).toBe(true);
    expect(() => guard.canActivate(context(undefined))).toThrow(ForbiddenException);
  });

  it('attaches to management/parse controllers, never the existing public/token sharing controller', () => {
    for (const controller of [TalentResumeController, TalentResumeTasksController]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(TalentManagementGuard);
    }
    expect(Reflect.getMetadata(GUARDS_METADATA, TalentSharesController) ?? []).not.toContain(TalentManagementGuard);
    expect(Reflect.getMetadata(GUARDS_METADATA, TalentSharesController.prototype.view) ?? []).not.toContain(TalentManagementGuard);
    expect(Reflect.getMetadata(GUARDS_METADATA, TalentSharesController.prototype.downloadFile) ?? []).not.toContain(TalentManagementGuard);
  });
});
