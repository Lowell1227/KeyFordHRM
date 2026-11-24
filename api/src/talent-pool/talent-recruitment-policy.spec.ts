import { ForbiddenException } from '@nestjs/common';
import * as policy from './talent-recruitment-policy';
import { allowedApplicationActions, assertRecruitmentReader, assertRecruitmentWriter, canConfirmTalentHiring, canReadRecruitment, canWriteRecruitment, isFeedbackOpen } from './talent-recruitment-policy';

const hr = { id: 'hr', sysRole: 'hr', status: 'active', archivedAt: null, deletedAt: null, isAssessorOnly: false, hrCapabilities: [] };
const application = { stage: 'hiring_review', hiringRequestedById: 'submitter', reviewReturnStage: 'interviewing' };

describe('recruitment policy', () => {
  it.each(['accepted', 'withdrawn', 'screening', 'offered'])('keeps explicit termination available for an unreleased acceptance in %s without generic withdrawal', stage => {
    const state = { ...application, stage, events: [{ action: 'accept_offer', version: 3 }, { action: 'withdraw', version: 4 }] };
    const actions = allowedApplicationActions(hr, state, false);
    expect(actions).toContain('terminate_offer');
    expect(actions).not.toContain('withdraw');
    if (stage === 'withdrawn') expect(actions).toContain('reopen');
  });
  it('preserves ordinary withdrawal for a new offer after the previous acceptance was explicitly terminated', () => {
    const state = { ...application, stage: 'offered', events: [{ action: 'accept_offer', version: 1 }, { action: 'terminate_offer', version: 2 }] };
    expect(allowedApplicationActions(hr, state, false)).toContain('withdraw');
    expect(allowedApplicationActions(hr, state, false)).not.toContain('terminate_offer');
  });
  it('uses the latest acceptance or termination event, never unrelated newer events or array order', () => {
    expect(typeof (policy as any).hasActiveTalentAcceptance).toBe('function');
    const events = [{ action: 'accept_offer', version: 8 }, { action: 'terminate_offer', version: 5 }, { action: 'withdraw', version: 10 }];
    expect((policy as any).hasActiveTalentAcceptance(events)).toBe(true);
    expect((policy as any).hasActiveTalentAcceptance([...events, { action: 'terminate_offer', version: 11 }])).toBe(false);
    expect((policy as any).hasActiveTalentAcceptance([])).toBe(false);
    expect(events.map(event => event.version)).toEqual([8, 5, 10]);
  });
  it('does not allow repeated termination, arrival termination, or termination while onboarding is active', () => {
    const accepted = { ...application, stage: 'accepted', events: [{ action: 'accept_offer', version: 1 }] };
    expect(allowedApplicationActions(hr, accepted, true)).not.toContain('terminate_offer');
    expect(allowedApplicationActions(hr, { ...accepted, stage: 'hired' }, false)).toEqual([]);
    const terminated = { ...accepted, stage: 'withdrawn', events: [...accepted.events, { action: 'terminate_offer', version: 2 }] };
    expect(allowedApplicationActions(hr, terminated, false)).not.toContain('terminate_offer');
    expect(allowedApplicationActions(hr, { ...application, stage: 'accepted' }, false)).toEqual(['withdraw']);
  });
  it('does not offer termination when this application has an effective personnel request, even if its stage is legacy withdrawn', () => {
    const state = { ...application, stage: 'withdrawn', events: [{ action: 'accept_offer', version: 2 }], onboardingRequests: [{ recordStatus: 'effective' }] };
    expect(allowedApplicationActions(hr, state, false)).not.toContain('terminate_offer');
  });
  it('keeps termination restricted to current recruitment editors rather than readers or narrow confirmers', () => {
    const accepted = { ...application, stage: 'withdrawn', events: [{ action: 'accept_offer', version: 1 }] };
    for (const actor of [
      { ...hr, status: 'resigned' }, { ...hr, isAssessorOnly: true },
      { ...hr, sysRole: 'employee', hrCapabilities: ['recruitment_view'] },
      { ...hr, sysRole: 'employee', hrCapabilities: ['talent_hiring_confirm'] },
    ]) expect(allowedApplicationActions(actor, accepted, false)).not.toContain('terminate_offer');
  });
  it.each(['employee', 'hr_user', 'manager'])('gives an explicit %s operator daily actions, not archive management or hiring confirmation', sysRole => {
    const actor = { ...hr, sysRole, hrCapabilities: ['recruitment_edit'] };
    expect(canReadRecruitment(actor)).toBe(true);
    expect(typeof (policy as any).canEditRecruitment).toBe('function');
    expect((policy as any).canEditRecruitment(actor)).toBe(true);
    expect(canWriteRecruitment(actor)).toBe(false);
    expect(canConfirmTalentHiring(actor, 'other')).toBe(false);
    expect(allowedApplicationActions(actor, { ...application, stage: 'screening' }, false)).toEqual(['start_interview', 'submit_hiring', 'reject', 'reserve', 'withdraw']);
    expect(allowedApplicationActions(actor, { ...application, stage: 'offered' }, false)).toEqual(['accept_offer', 'decline_offer', 'withdraw']);
    expect(allowedApplicationActions(actor, application, false)).not.toContain('approve_hiring');
  });
  it('requires current eligibility for the new operator, even with explicit grants', () => {
    expect(typeof (policy as any).canEditRecruitment).toBe('function');
    for (const change of [{ status: 'resigned' }, { status: 'pending_entry' }, { deletedAt: new Date() }, { archivedAt: new Date() }, { isAssessorOnly: true }]) {
      expect((policy as any).canEditRecruitment({ ...hr, sysRole: 'employee', hrCapabilities: ['recruitment_edit'], ...change })).toBe(false);
    }
    expect(policy.talentOwnerWhere()).toMatchObject({ isAssessorOnly: false, OR: expect.arrayContaining([{ hrCapabilities: { has: 'recruitment_edit' } }]) });
  });
  it.each([undefined, null, {}])('rejects missing trusted identity before looking up any account: %j', async user => {
    const tx = { user: { findUnique: jest.fn() } };
    await expect(assertRecruitmentReader(tx as never, user as never)).rejects.toThrow(ForbiddenException);
    await expect(assertRecruitmentWriter(tx as never, user as never)).rejects.toThrow(ForbiddenException);
    expect(tx.user.findUnique).not.toHaveBeenCalled();
  });
  it('uses current database grants instead of the request role and never requires request status', async () => {
    const tx = { user: { findUnique: jest.fn().mockResolvedValue({ ...hr, sysRole: 'employee', hrCapabilities: ['recruitment_view'] }) } };
    const staleRequest = { id: hr.id, sysRole: 'hr' };
    await expect(assertRecruitmentReader(tx as never, staleRequest)).resolves.toMatchObject({ sysRole: 'employee' });
    await expect(assertRecruitmentWriter(tx as never, staleRequest)).rejects.toThrow(ForbiddenException);
    tx.user.findUnique.mockResolvedValue({ ...hr, sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] });
    await expect(assertRecruitmentWriter(tx as never, { id: hr.id })).resolves.toMatchObject({ sysRole: 'hr_user' });
  });
  it.each(['employee', 'manager', 'dept_head', 'vp', 'hr_user'])('lets explicit %s recruitment readers read without maintenance or hiring confirmation', sysRole => {
    const reader = { ...hr, sysRole, hrCapabilities: ['recruitment_view'] };
    expect(canReadRecruitment(reader)).toBe(true);
    expect(canWriteRecruitment(reader)).toBe(false);
    expect(canConfirmTalentHiring(reader, 'other')).toBe(false);
    expect(allowedApplicationActions(reader, application, false)).toEqual([]);
  });
  it.each(['hr', 'system_admin', 'hr_user', 'employee'])('blocks assessor-only mixed %s from full recruitment reads', sysRole => {
    const actor = { ...hr, sysRole, isAssessorOnly: true, hrCapabilities: ['recruitment_view', 'employee_archive_edit', 'employee_archive_review'] };
    expect(canReadRecruitment(actor)).toBe(false);
    expect(canWriteRecruitment(actor)).toBe(false);
  });
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
