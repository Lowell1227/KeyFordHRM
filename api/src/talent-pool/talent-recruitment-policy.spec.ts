import { allowedApplicationActions, canConfirmTalentHiring, canReadRecruitment, canWriteRecruitment, isFeedbackOpen } from './talent-recruitment-policy';

const hr = { id: 'hr', sysRole: 'hr', status: 'active', archivedAt: null, deletedAt: null, isAssessorOnly: false, hrCapabilities: [] };
const application = { stage: 'hiring_review', hiringRequestedById: 'submitter', reviewReturnStage: 'interviewing' };

describe('recruitment policy', () => {
  it('requires independent HR or an explicit grant, never administrator or view-all inference', () => {
    expect(canConfirmTalentHiring(hr, 'submitter')).toBe(true);
    expect(canConfirmTalentHiring(hr, hr.id)).toBe(false);
    expect(canConfirmTalentHiring({ ...hr, sysRole: 'system_admin', canViewAll: true }, 'submitter')).toBe(false);
    expect(canConfirmTalentHiring({ ...hr, sysRole: 'system_admin', hrCapabilities: ['talent_hiring_confirm'] }, 'submitter')).toBe(true);
    expect(canConfirmTalentHiring({ ...hr, sysRole: 'hr_user', hrCapabilities: ['employee_archive_review'] }, 'submitter')).toBe(false);
  });
  it.each([{ status: 'resigned' }, { status: 'pending_entry' }, { archivedAt: new Date() }, { deletedAt: new Date() }, { isAssessorOnly: true }])('rejects a no-longer-eligible confirmer: %j', (change) => {
    expect(canConfirmTalentHiring({ ...hr, ...change }, 'submitter')).toBe(false);
  });
  it('keeps archive read and maintenance boundaries separate from confirmation', () => {
    const reviewer = { ...hr, sysRole: 'hr_user', hrCapabilities: ['employee_archive_review', 'talent_hiring_confirm'] };
    expect(canReadRecruitment(reviewer)).toBe(true);
    expect(canWriteRecruitment(reviewer)).toBe(false);
    expect(allowedApplicationActions(reviewer, application, false)).toEqual(['approve_hiring', 'return_hiring']);
    expect(canReadRecruitment({ ...hr, sysRole: 'employee', hrCapabilities: ['talent_hiring_confirm'] })).toBe(false);
  });
  it('grants explicit non-HR confirmers only independent pending review actions, not archive maintenance', () => {
    const confirmer = { ...hr, sysRole: 'employee', hrCapabilities: ['talent_hiring_confirm'] };
    expect(canReadRecruitment(confirmer)).toBe(false);
    expect(canWriteRecruitment(confirmer)).toBe(false);
    expect(allowedApplicationActions(confirmer, application, false)).toEqual(['approve_hiring', 'return_hiring']);
    expect(allowedApplicationActions(confirmer, { ...application, hiringRequestedById: confirmer.id }, false)).toEqual([]);
    expect(allowedApplicationActions(confirmer, { ...application, stage: 'offered' }, false)).toEqual([]);
  });
  it('exposes only legal actions and never manual onboarding/hired', () => {
    expect(allowedApplicationActions(hr, { ...application, stage: 'hired' }, false)).toEqual([]);
    expect(allowedApplicationActions(hr, { ...application, stage: 'accepted' }, true)).not.toContain('withdraw');
    expect(allowedApplicationActions(hr, { ...application, stage: 'accepted' }, false)).toEqual(['withdraw']);
    expect(allowedApplicationActions(hr, { ...application, stage: 'rejected' }, false)).toEqual(expect.arrayContaining(['reopen']));
    expect(allowedApplicationActions(hr, { ...application, hiringRequestedById: hr.id }, false)).not.toContain('approve_hiring');
  });
  it('locks linked feedback at hiring review and afterwards while preserving legacy invitations', () => {
    expect(isFeedbackOpen(null, 'completed')).toBe(true);
    expect(isFeedbackOpen('interviewing', 'completed')).toBe(true);
    expect(isFeedbackOpen('hiring_review', 'scheduled')).toBe(false);
    expect(isFeedbackOpen('accepted', 'completed')).toBe(false);
    expect(isFeedbackOpen(null, 'cancelled')).toBe(false);
  });
});
