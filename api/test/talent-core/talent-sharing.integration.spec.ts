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
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'], {
        cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', timeout: 60000,
      });
    } catch { throw new Error('Disposable talent schema initialization failed'); }
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
  }, 120000);

  afterAll(async () => {
    try { await prisma?.$disconnect(); } finally { await container?.stop(); }
  }, 30000);

  async function counts() {
    return { shares: await prisma.talentShare.count(), notifications: await prisma.notificationLog.count(), audits: await prisma.auditLog.count() };
  }

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

  it('excludes closed applications from due/stale only, keeps open applications and does not project candidate status', async () => {
    const closed = await talents.create({ name: 'Synthetic closed', phone: '17000000004', sourceChannel: 'referral' }, actor);
    const open = await talents.create({ name: 'Synthetic open', phone: '17000000005', sourceChannel: 'referral' }, actor);
    for (const candidate of [closed, open]) {
      await prisma.talentCandidate.update({ where: { id: candidate.id }, data: { createdAt: new Date('2020-01-01') } });
      await prisma.talentFollowUp.create({ data: { candidateId: candidate.id, occurredAt: new Date('2026-01-01'), nextFollowUpAt: new Date('2026-01-02'),
        channel: 'phone', summary: 'Synthetic', createdById: actor.id } });
      await prisma.talentApplication.create({ data: { candidateId: candidate.id, positionName: 'Synthetic role', ownerId: actor.id,
        createdById: actor.id, stage: candidate.id === closed.id ? 'withdrawn' : 'screening' } });
    }
    for (const flag of ['dueOnly', 'staleOnly']) {
      const result = await talents.list(Object.assign(new TalentQueryDto(), { [flag]: true }));
      expect(result.items.some(row => row.id === closed.id)).toBe(false);
      expect(result.items.some(row => row.id === open.id)).toBe(true);
    }
    const detail = await talents.detail(closed.id);
    expect(detail).toMatchObject({ status: 'new', latestApplication: { stage: 'withdrawn', ownerName: actor.name }, applications: [{ positionName: 'Synthetic role' }] });
    const general = await talents.list(new TalentQueryDto());
    expect(general.items.some(row => row.id === closed.id)).toBe(true);
  });
});
