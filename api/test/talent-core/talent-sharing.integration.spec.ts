import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ConflictException } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaService } from '@/prisma/prisma.service';
import type { AuthUser } from '@/common/types/auth.types';
import { TalentsService } from '@/talent-pool/talents.service';
import { TalentSharesService } from '@/talent-pool/talent-shares.service';
import { TalentQueryDto } from '@/talent-pool/dto/talent-query.dto';

// Owns the entire database lifecycle; never uses an inherited DATABASE_URL or external providers.
describe('talent core: disposable PostgreSQL', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let prisma: PrismaService;
  let talents: TalentsService;
  let shares: TalentSharesService;
  let actor: AuthUser;
  let recipientIds: string[];
  let candidateId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('hrm_talent_core_test').withStartupTimeout(60000).start();
    const databaseUrl = container.getConnectionUri();
    const url = new URL(databaseUrl);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/hrm_talent_core_test') {
      throw new Error('Disposable talent database must be loopback and test-owned');
    }
    try {
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', timeout: 90000,
      });
    } catch (error) {
      const stderr = String((error as { stderr?: Buffer }).stderr ?? '').replace(/postgres(?:ql)?:\/\/[^\s'"\x1b]+/gi, '[disposable database URL redacted]');
      throw new Error(`Disposable talent schema initialization failed: ${stderr}`);
    }
    prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    talents = new TalentsService(prisma);
    shares = new TalentSharesService(prisma, talents);
    const hr = await prisma.user.create({ data: { name: 'Synthetic talent HR', sysRole: 'hr', status: 'active' } });
    actor = { id: hr.id, name: hr.name, sysRole: hr.sysRole, deptId: null, isAssessorOnly: false, canViewAll: false };
    recipientIds = (await Promise.all(['A', 'B'].map(name => prisma.user.create({
      data: { name: `Synthetic recipient ${name}`, sysRole: 'hr_user', status: 'probation', hrCapabilities: ['employee_archive_edit'] },
    })))).map(user => user.id);
    candidateId = (await talents.create({ name: 'Synthetic candidate', phone: '17000000000', sourceChannel: 'referral' }, actor)).id;
  }, 150000);

  afterAll(async () => {
    try { await prisma?.$disconnect(); } finally { await container?.stop(); }
  }, 30000);

  async function counts() {
    return { shares: await prisma.talentShare.count(), notifications: await prisma.notificationLog.count(), audits: await prisma.auditLog.count() };
  }

  it('creates an anonymous external link with isolated original-file access and no notification', async () => {
    const candidate = await talents.create({ name: 'Synthetic external candidate', phone: '17000000006', sourceChannel: 'referral' }, actor);
    const file = await prisma.talentResumeFile.create({ data: { candidateId: candidate.id, objectKey: 'talent-resume/synthetic/external.pdf', fileName: 'Synthetic.pdf', mimeType: 'application/pdf', fileSize: 10, uploadedById: actor.id } });
    const otherFile = await prisma.talentResumeFile.create({ data: { candidateId, objectKey: 'talent-resume/synthetic/other.pdf', fileName: 'Other.pdf', mimeType: 'application/pdf', fileSize: 10, uploadedById: actor.id } });
    const notifications = await prisma.notificationLog.count();
    const input = { requestId: randomUUID(), isPublicLink: true, expiresInDays: 7 };
    const summary = await shares.create(candidate.id, input, actor).catch(error => {
      // PostgreSQL errors can include an inserted row; never log a sharing bearer token.
      throw new Error(`Migrated external share creation failed (${error.code ?? error.name})`);
    });
    expect(await shares.create(candidate.id, input, actor)).toEqual(summary);
    expect(await prisma.talentShare.findUnique({ where: { id: summary.id } })).toMatchObject({ isPublicLink: true, recipientIds: [], includeResume: false });
    const view = await shares.resolve(summary.token);
    expect(view.candidate.name).toBe(candidate.name);
    expect(view.files).toEqual([]);
    for (const key of ['phone', 'email', 'note', 'followUps', 'expectSalaryMin', 'expectSalaryMax', 'expectSalaryMinYuan', 'expectSalaryMaxYuan', 'expectSalaryUnit', 'salaryNeedsReview']) {
      expect(view.candidate).not.toHaveProperty(key);
    }
    await expect(shares.resolveFile(summary.token, file.id)).rejects.toThrow('链接已失效或无权查看');
    const original = await shares.create(candidate.id, { isPublicLink: true, expiresInDays: 30, includeResume: true }, actor);
    expect(original.token).not.toBe(summary.token);
    expect(await shares.resolveFile(original.token, file.id)).toBe(file.objectKey);
    await expect(shares.resolveFile(original.token, otherFile.id)).rejects.toThrow('链接已失效或无权查看');
    const originalView = await shares.resolve(original.token);
    expect(originalView.files).toHaveLength(1);
    expect(originalView.files[0]).not.toHaveProperty('objectKey');
    expect(await prisma.notificationLog.count()).toBe(notifications);
    expect((await prisma.talentShare.findUnique({ where: { id: original.id } }))?.lastViewedById).toBeNull();
    await shares.revoke(original.id, actor);
    await expect(shares.resolve(original.token)).rejects.toThrow('链接已失效或无权查看');
    await expect(shares.resolveFile(original.token, file.id)).rejects.toThrow('链接已失效或无权查看');
    await prisma.talentShare.update({ where: { id: summary.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(shares.resolve(summary.token)).rejects.toThrow('链接已失效或无权查看');
    const deleted = await shares.create(candidate.id, { isPublicLink: true, expiresInDays: 7, includeResume: true }, actor);
    await prisma.talentCandidate.update({ where: { id: candidate.id }, data: { deletedAt: new Date() } });
    await expect(shares.resolve(deleted.token)).rejects.toThrow('链接已失效或无权查看');
    await expect(shares.resolveFile(deleted.token, file.id)).rejects.toThrow('链接已失效或无权查看');
  });

  it('database-default legacy links require a nonempty recipient list and current recipient eligibility', async () => {
    const legacy = await prisma.talentShare.create({ data: { candidateId, token: 'c'.repeat(64), recipientIds, includeResume: true, expiresAt: new Date(Date.now() + 60000), createdById: actor.id } });
    const invalidEmptyAccepted = await prisma.talentShare.create({ data: { candidateId, token: 'd'.repeat(64), recipientIds: [], expiresAt: new Date(Date.now() + 60000), createdById: actor.id } }).then(() => true, () => false);
    expect(legacy.isPublicLink).toBe(false);
    expect(invalidEmptyAccepted).toBe(false);
    await expect(shares.resolve(legacy.token)).rejects.toThrow('链接已失效或无权查看');
    await expect(shares.resolve(legacy.token, actor)).rejects.toThrow('链接已失效或无权查看');
    const user = { ...actor, id: recipientIds[0], sysRole: 'hr_user' } as AuthUser;
    await expect(shares.resolve(legacy.token, user)).resolves.toHaveProperty('candidate.name', 'Synthetic candidate');
    await prisma.user.update({ where: { id: user.id }, data: { status: 'resigned' } });
    try {
      await expect(shares.resolve(legacy.token, user)).rejects.toThrow('链接已失效或无权查看');
      await expect(shares.resolveFile(legacy.token, randomUUID(), user)).rejects.toThrow('链接已失效或无权查看');
    } finally { await prisma.user.update({ where: { id: user.id }, data: { status: 'probation' } }); }
  });

  it('migrated database also rejects contradictory public recipients and oversized restricted lists', async () => {
    const invalid = [
      { isPublicLink: true, recipientIds: [recipientIds[0]!] },
      { isPublicLink: false, recipientIds: Array.from({ length: 6 }, () => randomUUID()) },
    ];
    for (const data of invalid) {
      const accepted = await prisma.talentShare.create({ data: { ...data, candidateId, token: randomUUID().replace(/-/g, '').repeat(2),
        expiresAt: new Date(Date.now() + 60000), createdById: actor.id } }).then(() => true, () => false);
      expect(accepted).toBe(false);
    }
  });

  it.each(['notification', 'audit'])('rolls back all writes on a real %s database error, then safely retries', async failure => {
    const baseline = await counts();
    const requestId = randomUUID();
    const input = { requestId, recipientIds, expiresInDays: 7 };
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION talent_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic transaction failure'; END; $$`);
    const table = failure === 'notification' ? 'notification_logs' : 'audit_logs';
    const condition = failure === 'notification' ? `WHEN (NEW.user_id = '${recipientIds[1]}'::uuid)` : '';
    await prisma.$executeRawUnsafe(`CREATE TRIGGER talent_test_failure BEFORE INSERT ON ${table} FOR EACH ROW ${condition} EXECUTE FUNCTION talent_test_fail()`);
    try {
      await expect(shares.create(candidateId, input, actor)).rejects.toThrow();
      expect(await counts()).toEqual(baseline);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER talent_test_failure ON ${table}`);
    }
    const first = await shares.create(candidateId, input, actor);
    expect(await shares.create(candidateId, input, actor)).toEqual(first);
    expect(await counts()).toEqual({ shares: baseline.shares + 1, notifications: baseline.notifications + 2, audits: baseline.audits + 1 });
    expect(await prisma.notificationLog.count({ where: { channel: { not: 'system' } } })).toBe(0);
  });

  it('serializes concurrent identical requests into one share and one notification set', async () => {
    const baseline = await counts();
    const input = { requestId: randomUUID(), recipientIds, expiresInDays: 30 };
    const results = await Promise.all(Array.from({ length: 3 }, () => shares.create(candidateId, input, actor)));
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(await counts()).toEqual({ shares: baseline.shares + 1, notifications: baseline.notifications + 2, audits: baseline.audits + 1 });
  });

  it('compares UUIDs by identity rather than spelling when replaying a committed request', async () => {
    const input = { requestId: randomUUID(), recipientIds: recipientIds.map(id => id.toUpperCase()), expiresInDays: 7 };
    const uppercaseActor = { ...actor, id: actor.id.toUpperCase() };
    const first = await shares.create(candidateId.toUpperCase(), input, uppercaseActor);
    await expect(shares.create(candidateId.toUpperCase(), input, uppercaseActor)).resolves.toEqual(first);
  });

  it('conflicts on global requestId reuse across different candidate locks without leaving duplicate notifications', async () => {
    const other = await talents.create({ name: 'Synthetic second candidate', phone: '17000000001', sourceChannel: 'referral' }, actor);
    const baseline = await counts();
    const input = { requestId: randomUUID(), recipientIds, expiresInDays: 7 };
    const results = await Promise.allSettled([candidateId, other.id].map(id => shares.create(id, input, actor)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect(await counts()).toEqual({ shares: baseline.shares + 1, notifications: baseline.notifications + 2, audits: baseline.audits + 1 });
  });

  it('checks active owner eligibility, education FK/name and legacy text with real rows', async () => {
    const education = await prisma.personnelReferenceData.create({ data: { kind: 'education', name: 'Synthetic active degree longer than twenty characters' } });
    const created = await talents.create({ name: 'Synthetic educated candidate', phone: '17000000002', sourceChannel: 'referral',
      ownerId: recipientIds[0], educationReferenceDataId: education.id, education: education.name }, actor);
    expect(created).toMatchObject({ ownerId: recipientIds[0], education: education.name, educationReferenceDataId: education.id });
    await prisma.user.update({ where: { id: recipientIds[0] }, data: { status: 'resigned' } });
    await expect(talents.create({ name: 'Synthetic denied', phone: '17000000003', sourceChannel: 'referral', ownerId: recipientIds[0] }, actor)).rejects.toThrow();
    await prisma.user.update({ where: { id: recipientIds[0] }, data: { status: 'probation' } });
    await prisma.talentCandidate.update({ where: { id: created.id }, data: { ownerId: null, educationReferenceDataId: null, education: 'legacy_unmapped' } });
    const detail = await talents.detail(created.id);
    expect(detail).toMatchObject({ ownerId: actor.id, ownerName: actor.name, education: 'legacy_unmapped' });
    await expect(talents.update(created.id, { ownerId: actor.id, education: 'legacy_unmapped', educationReferenceDataId: null,
      note: 'Synthetic edit', editVersion: detail.editVersion }, actor)).resolves.toMatchObject({ education: 'legacy_unmapped', ownerId: null });
  });

  it('pending follow-up is independent of application stage, while stale scope and candidate history remain unchanged', async () => {
    const closed = await talents.create({ name: 'Synthetic closed', phone: '17000000004', sourceChannel: 'referral' }, actor);
    const open = await talents.create({ name: 'Synthetic open', phone: '17000000005', sourceChannel: 'referral' }, actor);
    for (const candidate of [closed, open]) {
      await prisma.talentCandidate.update({ where: { id: candidate.id }, data: { createdAt: new Date('2020-01-01') } });
      await prisma.talentFollowUp.create({ data: { candidateId: candidate.id, occurredAt: new Date('2026-01-01'), nextFollowUpAt: new Date('2026-01-02'),
        channel: 'phone', summary: 'Synthetic', planStatus: 'pending', createdById: actor.id } });
      await prisma.talentApplication.create({ data: { candidateId: candidate.id, positionName: 'Synthetic role', ownerId: actor.id,
        createdById: actor.id, stage: candidate.id === closed.id ? 'withdrawn' : 'screening' } });
    }
    for (const flag of ['dueOnly', 'staleOnly']) {
      const result = await talents.list(Object.assign(new TalentQueryDto(), { [flag]: true }));
      expect(result.items.some(row => row.id === closed.id)).toBe(flag === 'dueOnly');
      expect(result.items.some(row => row.id === open.id)).toBe(true);
    }
    const detail = await talents.detail(closed.id);
    expect(detail).toMatchObject({ status: 'new', latestApplication: { stage: 'withdrawn', ownerName: actor.name }, applications: [{ positionName: 'Synthetic role' }] });
    const general = await talents.list(new TalentQueryDto());
    expect(general.items.some(row => row.id === closed.id)).toBe(true);
  });
});
