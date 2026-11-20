import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { EmployeeArchivesService } from '@/employee-archives/employee-archives.service';
import { EmployeeDataReviewsService } from '@/employee-archives/employee-data-reviews.service';
import { EmployeeEffectiveDateService } from '@/employee-archives/employee-effective-date.service';
import { EmployeeIdentityMatchService } from '@/employee-archives/employee-identity-match.service';
import { EmployeeNumberService } from '@/employee-archives/employee-number.service';
import { EmployeeOnboardingService } from '@/employee-archives/employee-onboarding.service';
import { shanghaiBusinessDate } from '@/employee-archives/employment-timeline';
import { TalentRecruitmentService } from '@/talent-pool/talent-recruitment.service';

describe('a new accepted application after a cancelled first hire (disposable PostgreSQL)', () => {
  let container: StartedPostgreSqlContainer, db: PrismaService;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:14-alpine').withDatabase('hrm_first_hire_test').start();
    const url = new URL(container.getConnectionUri());
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/hrm_first_hire_test') throw Error('Unexpected test database');
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe',
    });
    db = new PrismaService({ datasources: { db: { url: url.toString() } } });
  }, 120000);
  afterAll(async () => { try { await db?.$disconnect(); } finally { await container?.stop(); } });

  it.each([true, false])('requires review and arrival on the original identity, with stored ID number = %s', async hasId => {
    const config = new ConfigService({ EMPLOYEE_ARCHIVE_ENCRYPTION_KEY: randomUUID() });
    const numbers = new EmployeeNumberService(), identities = new EmployeeIdentityMatchService(db, config);
    const onboarding = new EmployeeOnboardingService(db, numbers, identities, new EmployeeEffectiveDateService(db));
    const reviews = new EmployeeDataReviewsService(db, onboarding);
    const archive = new EmployeeArchivesService(db, config, numbers, identities, onboarding, reviews);
    const recruitment = new TalentRecruitmentService(db);
    const editor = await db.user.create({ data: { name: 'Synthetic editor', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] } });
    const reviewer = await db.user.create({ data: { name: 'Synthetic reviewer', sysRole: 'hr_user', hrCapabilities: ['employee_archive_review'] } });
    const confirmer = await db.user.create({ data: { name: 'Synthetic confirmer', hrCapabilities: ['talent_hiring_confirm'] } });
    const subject = await db.contractSubject.create({ data: { name: 'Synthetic employer ' + hasId, internalCompany: 'fuede' } });
    const dept = await db.department.create({ data: { name: 'Synthetic department' } });
    const position = await db.position.create({ data: { name: 'Synthetic position', code: 'SYNTHETIC_' + hasId } });
    const candidate = await db.talentCandidate.create({ data: { name: 'Synthetic candidate ' + hasId, phone: hasId ? '17000000000' : '17000000001', sourceChannel: 'other', createdById: editor.id } });
    const accepted = async (positionName: string) => {
      let app = await recruitment.create(candidate.id, { positionName }, editor);
      for (const action of ['submit_hiring', 'approve_hiring', 'accept_offer'] as const) {
        app = await recruitment.act(app.id, { expectedRevision: app.revision, action, note: 'Synthetic' }, action === 'approve_hiring' ? confirmer : editor);
      }
      return app;
    };
    const today = shanghaiBusinessDate(), body = {
      name: candidate.name, phone: candidate.phone, idNumber: hasId ? '990000200001010001' : undefined, talentCandidateId: candidate.id,
      company: 'fuede' as const, employee: { contractSubjectId: subject.id }, deptId: dept.id, positionId: position.id,
      entryDate: today, effectiveFrom: today, employmentType: 'full_time' as const, employeeStatus: 'probation' as const,
    };
    const approve = async (id: string) => expect((await reviews.approveBatch({ requestIds: [id], scopes: ['profile'] }, reviewer)).failed).toEqual([]);
    const old = await accepted('Synthetic A');
    const a = await archive.createEmployee({ ...body, profile: { school: 'Prior verified school' },
      contracts: [{ contractType: 'attachment', name: 'Prior attachment' }], talentApplicationId: old.id }, editor);
    await approve(a.id);
    await onboarding.cancelReentry(a.id, { reason: 'Synthetic no-show' }, editor.id);
    const oldStage = await recruitment.detail(old.id, editor);
    await recruitment.act(old.id, { expectedRevision: oldStage.revision, action: 'withdraw', note: 'Synthetic' }, editor);
    const history = await db.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: a.id } });
    const userId = history.userId!;
    const original = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(original).toMatchObject({ status: 'pending_entry', employeeNo: null });
    const next = await accepted('Synthetic B');
    const input = { ...body, talentApplicationId: next.id, profile: { school: '', major: 'Current verified major' },
      contracts: [{ contractType: 'contract', name: 'Current contract' }] };
    for (const change of [{ name: 'Different candidate' }, { phone: '17000000009' }, ...(hasId ? [{ idNumber: undefined }] : [])]) {
      await expect(archive.createEmployee({ ...input, ...change }, editor)).rejects.toMatchObject({ status: 409 });
    }
    // Sweep stale identity states in this disposable database; no service may create B under any of them.
    const blocked = async () => expect(archive.createEmployee(input, editor)).rejects.toMatchObject({ status: 409 });
    for (const state of [{ status: 'active' as const }, { status: 'resigned' as const }, { employeeNo: 'occupied' }]) {
      await db.user.update({ where: { id: userId }, data: state });
      await blocked();
      await db.user.update({ where: { id: userId }, data: { status: 'pending_entry', employeeNo: null } });
    }
    const number = await db.employeeNumberAssignment.create({ data: { userId, status: 'historical', employeeNo: 'historical' } });
    await blocked();
    await db.employeeNumberAssignment.delete({ where: { id: number.id } });
    const employment = await db.employmentRecord.create({ data: { userId, effectiveFrom: today, employeeStatus: 'active', changeType: 'hire' } });
    await blocked();
    await db.employmentRecord.delete({ where: { id: employment.id } });
    const other = await db.user.create({ data: { name: 'Different historical identity', status: 'pending_entry' } });
    const base = { employeeName: candidate.name, sourceType: 'manual_employee_create', proposedValue: {}, createdById: editor.id };
    const ambiguous = await db.employeeDataChangeRequest.create({ data: { ...base, talentCandidateId: candidate.id, userId: other.id,
      requiresArrivalConfirmation: true, intakeType: 'new_hire', recordStatus: 'cancelled', onboardingStatus: 'cancelled',
      cancelledAt: new Date(), profileReviewStatus: 'approved' } });
    await blocked();
    await db.employeeDataChangeRequest.delete({ where: { id: ambiguous.id } });
    for (const state of [{ arrivalDate: today, arrivalConfirmedAt: new Date(), arrivalConfirmedById: reviewer.id, recordStatus: 'archived' }, { recordStatus: 'draft' },
      { intakeType: 'reentry' as const, recordStatus: 'cancelled' }]) {
      const request = await db.employeeDataChangeRequest.create({ data: { ...base, userId, ...state } });
      await blocked();
      await db.employeeDataChangeRequest.delete({ where: { id: request.id } });
    }

    await expect(archive.createEmployee({ ...input, idNumber: '990000200001010002', phoneDuplicateAcknowledged: true }, editor)).rejects.toThrow();
    const draft = await archive.saveEmployeeCreateDraft(input, editor);
    const submitted = { ...input, draftId: draft.id, expectedVersion: draft.requestVersion };
    const raced = await Promise.allSettled([archive.createEmployee(submitted, editor), archive.createEmployee(submitted, editor)]);
    expect(raced.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(raced.find(r => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    const b = await db.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: draft.id } });
    expect(b).toMatchObject({ talentApplicationId: next.id, intakeType: 'new_hire', profileReviewStatus: 'pending', onboardingStatus: 'submitted' });
    await approve(b.id);
    const pending = await db.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: b.id } });
    expect(pending).toMatchObject({ userId, onboardingStatus: 'pending_entry', arrivalConfirmedAt: null });
    expect((await db.employeeProfile.findUniqueOrThrow({ where: { userId } }))).toMatchObject({ school: 'Prior verified school', major: 'Current verified major' });
    expect((await db.employeeContract.findMany({ where: { userId, isActive: true } })).map(row => row.name).sort()).toEqual(['Current contract', 'Prior attachment']);
    const arrival = { arrivalDate: today.toISOString().slice(0, 10), requestVersion: pending.requestVersion };
    await expect(onboarding.confirmArrival(b.id, arrival, editor)).rejects.toMatchObject({ status: 403 });
    await onboarding.confirmArrival(b.id, arrival, reviewer);
    expect(await db.user.count({ where: { name: candidate.name } })).toBe(1);
    const activated = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(activated.status).toBe('probation');
    expect(activated.passwordHash === original.passwordHash).toBe(true);
    expect(await db.talentCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).toMatchObject({ convertedUserId: userId });
    expect((await recruitment.detail(next.id, editor)).stage).toBe('hired');
    expect((await recruitment.detail(old.id, editor)).stage).toBe('withdrawn');
    expect(await db.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: a.id } })).toEqual(history);
    expect(await db.employeeNumberAssignment.count({ where: { userId, status: 'current', sourceRequestId: b.id } })).toBe(1);
    expect(await db.employeeNumberAssignment.count({ where: { userId, status: 'released', sourceRequestId: a.id } })).toBe(1);
  });
});
