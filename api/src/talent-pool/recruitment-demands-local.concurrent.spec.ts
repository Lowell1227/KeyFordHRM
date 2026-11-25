import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { RecruitmentDemandsService } from './recruitment-demands.service';
import { TalentRecruitmentService } from './talent-recruitment.service';

describe('local recruitment demands: two-connection PostgreSQL ordering and origin constraints', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let db: PrismaService, other: PrismaService;
  let demands: RecruitmentDemandsService, recruitment: TalentRecruitmentService;
  const databaseName = 'hrm_local_demand_concurrent_test';
  const workerName = 'local-demand-concurrent-worker';

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').withDatabase(databaseName).withStartupTimeout(60000).start();
    const databaseUrl = container.getConnectionUri(), url = new URL(databaseUrl);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/' + databaseName) {
      throw new Error('Only this test-owned loopback PostgreSQL container is allowed');
    }
    try {
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', timeout: 90000,
      });
    } catch { throw new Error('Migration initialization failed in the owned concurrency container'); }
    const client = (name: string) => {
      const connection = new URL(databaseUrl);
      connection.searchParams.set('connection_limit', '1');
      connection.searchParams.set('application_name', name);
      return new PrismaService({ datasources: { db: { url: connection.toString() } } });
    };
    db = client(workerName); other = client('local-demand-concurrent-holder');
    await db.$connect(); await other.$connect();
    const [identity] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(identity.name).toBe(databaseName);
    const migrations = await db.$queryRaw<Array<{ name: string }>>`
      SELECT migration_name AS name FROM _prisma_migrations
      WHERE migration_name = '20261125010000_local_recruitment_demands' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    expect(migrations).toHaveLength(1);
    // No application module, external adapter, notifications, preview service or host DATABASE_URL is used.
    demands = new RecruitmentDemandsService(db);
    recruitment = new TalentRecruitmentService(db, demands);
  }, 150000);

  afterAll(async () => {
    try { await other?.$disconnect(); await db?.$disconnect(); } finally { await container?.stop(); }
  }, 30000);

  async function fixture(approve = true) {
    const suffix = randomUUID();
    const department = await db.department.create({ data: { name: 'Synthetic concurrent department ' + suffix } });
    const position = await db.position.create({ data: { code: suffix, name: 'Synthetic concurrent position ' + suffix } });
    const accounts: User[] = [];
    for (const [name, hrCapabilities] of [
      ['Synthetic concurrent operator', ['recruitment_edit']],
      ['Synthetic independent demand reviewer', ['recruitment_demand_review']],
    ] as const) {
      accounts.push(await db.user.create({ data: { name, sysRole: 'employee', status: 'active', hrCapabilities: [...hrCapabilities] } }));
    }
    const [editor, reviewer]: AuthUser[] = accounts.map(row => ({ id: row.id, name: row.name, sysRole: row.sysRole,
      deptId: null, hrCapabilities: row.hrCapabilities, isAssessorOnly: false, canViewAll: false }));
    let demand = await demands.createLocal({ requestId: suffix, deptId: department.id, positionId: position.id, headcount: 2,
      reason: 'Synthetic concurrency test justification' }, editor);
    expect(demand).toMatchObject({ sourceKind: 'local', sourceState: 'draft', usable: false });
    demand = await demands.actLocal(demand.id, { expectedRevision: demand.revision, action: 'submit' }, editor);
    if (approve) demand = await demands.actLocal(demand.id, { expectedRevision: demand.revision, action: 'approve' }, reviewer);
    return { editor, reviewer, department, position, demand };
  }

  async function waitForBlockedWorker(tx: Prisma.TransactionClient, fragment: string) {
    // Observe from the holder connection: the worker's only connection is deliberately blocked.
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      await tx.$queryRaw`SELECT 1 AS cleared FROM pg_stat_clear_snapshot()`;
      const rows = await tx.$queryRaw<Array<{ pid: number; blocker: number }>>`
        SELECT activity.pid, pg_backend_pid() AS blocker FROM pg_stat_activity AS activity
        WHERE activity.datname = current_database() AND activity.application_name = ${workerName}
          AND activity.wait_event_type = 'Lock' AND activity.query LIKE ${'%' + fragment + '%'}
          AND pg_backend_pid() = ANY(pg_blocking_pids(activity.pid))`;
      if (rows.length === 1) {
        expect(rows[0].pid).not.toBe(rows[0].blocker);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Expected the actual worker SQL to wait on this other connection: ' + fragment);
  }

  async function history(id: string) {
    return {
      row: await db.recruitmentDemand.findUniqueOrThrow({ where: { id } }),
      events: await db.recruitmentDemandEvent.findMany({ where: { demandId: id }, orderBy: { revision: 'asc' } }),
      audits: await db.auditLog.findMany({ where: { entityType: 'recruitment_demand', entityId: id }, orderBy: { id: 'asc' } }),
    };
  }

  it('rejects queued hiring after actual local withdrawal commits, keeping the application and hiring history unchanged', async () => {
    const f = await fixture();
    expect(f.demand).toMatchObject({ sourceKind: 'local', sourceState: 'approved', usable: true });
    const proof = await demands.prepareSubmission(f.demand.id, f.demand.revision, f.editor);
    expect(proof).toMatchObject({ sourceKind: 'local', demandId: f.demand.id, revision: f.demand.revision });
    const candidate = await db.talentCandidate.create({ data: { name: 'Synthetic queued hiring candidate',
      phone: 'test-' + randomUUID().slice(0, 12), sourceChannel: 'referral', createdById: f.editor.id } });
    const application = await recruitment.create(candidate.id, { deptId: f.department.id, positionName: f.position.name }, f.editor);
    const before = await db.talentApplication.findUniqueOrThrow({ where: { id: application.id } });
    const beforeEvents = await db.talentApplicationEvent.findMany({ where: { applicationId: application.id } });
    const beforeAudits = await db.auditLog.count({ where: { entityType: 'talent_application', entityId: application.id } });
    let queued: Promise<unknown> | undefined;
    try {
      await other.$transaction(async tx => {
        // Run the real withdrawal and its append-only event/audit inside this held transaction, not a second nested connection.
        const heldClient = { $transaction: <T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>) => callback(tx) } as unknown as PrismaService;
        const heldDemands = new RecruitmentDemandsService(heldClient);
        const withdrawn = await heldDemands.actLocal(f.demand.id, { expectedRevision: f.demand.revision,
          action: 'withdraw', reason: 'Synthetic withdrawal commits before queued hiring' }, f.editor);
        expect(withdrawn).toMatchObject({ sourceState: 'withdrawn', revision: f.demand.revision + 1, usable: false });
        queued = recruitment.act(application.id, { expectedRevision: application.revision, action: 'submit_hiring',
          note: 'Synthetic queued hiring opinion', recruitmentDemandId: f.demand.id, expectedDemandRevision: f.demand.revision }, f.editor)
          .then(() => null, error => error);
        await waitForBlockedWorker(tx, 'pg_advisory_xact_lock');
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000, maxWait: 5000 });
      expect(await queued).toBeInstanceOf(ConflictException);
    } finally { if (queued) await queued; }
    expect(await db.talentApplication.findUniqueOrThrow({ where: { id: application.id } })).toEqual(before);
    expect(await db.talentApplicationEvent.findMany({ where: { applicationId: application.id } })).toEqual(beforeEvents);
    expect(await db.auditLog.count({ where: { entityType: 'talent_application', entityId: application.id } })).toBe(beforeAudits);
    expect(await db.talentApplicationEvent.count({ where: { applicationId: application.id, action: 'submit_hiring' } })).toBe(0);
    const after = await history(f.demand.id);
    expect(after.row).toMatchObject({ sourceState: 'withdrawn', revision: f.demand.revision + 1 });
    expect(after.events.filter(event => event.action === 'local_withdraw')).toHaveLength(1);
    expect(after.audits.filter(audit => audit.action === 'recruitment_demand_local_withdraw')).toHaveLength(1);
  }, 30000);

  it('rejects queued approval after reviewer capability revocation commits, with no approval event or row change', async () => {
    const f = await fixture(false), before = await history(f.demand.id);
    expect(f.reviewer.hrCapabilities).toContain('recruitment_demand_review');
    let queued: Promise<unknown> | undefined;
    try {
      await other.$transaction(async tx => {
        await tx.user.update({ where: { id: f.reviewer.id }, data: { hrCapabilities: [] } });
        queued = demands.actLocal(f.demand.id, { expectedRevision: f.demand.revision, action: 'approve' }, f.reviewer)
          .then(() => null, error => error);
        await waitForBlockedWorker(tx, 'FOR SHARE');
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000, maxWait: 5000 });
      expect(await queued).toBeInstanceOf(ForbiddenException);
    } finally { if (queued) await queued; }
    expect((await db.user.findUniqueOrThrow({ where: { id: f.reviewer.id } })).hrCapabilities).toEqual([]);
    expect(await history(f.demand.id)).toEqual(before);
    expect(await db.recruitmentDemandEvent.count({ where: { demandId: f.demand.id, action: 'local_approve' } })).toBe(0);
    expect((await history(f.demand.id)).row).toMatchObject({ sourceState: 'pending', approvedById: null, approvedHeadcount: null });
  }, 30000);

  it('rejects forged SQL origins and NULL local approval evidence, preserving all rows and immutable history', async () => {
    const f = await fixture(false), before = await history(f.demand.id);
    const external = await db.recruitmentDemand.create({ data: { organizationKey: 'synthetic-organization', processCode: 'synthetic-process',
      instanceId: 'synthetic-' + randomUUID(), sourceFingerprint: 'a'.repeat(64), sourceState: 'pending', lastSyncedAt: new Date() } });
    await expect(db.$executeRaw`UPDATE recruitment_demands SET source_kind = 'dingtalk' WHERE id = ${f.demand.id}::uuid`)
      .rejects.toThrow('source kind is immutable');
    await expect(db.$executeRaw`UPDATE recruitment_demands SET source_kind = 'local' WHERE id = ${external.id}::uuid`)
      .rejects.toThrow('source kind is immutable');
    await expect(db.$executeRaw`UPDATE recruitment_demands SET instance_id = 'synthetic-forged-external-instance' WHERE id = ${f.demand.id}::uuid`)
      .rejects.toThrow('recruitment_demands_origin_shape_check');
    for (const [count, fingerprint] of [[null, before.row.sourceFingerprint], [2, null], [null, null]] as const) {
      await expect(db.$executeRaw`
        UPDATE recruitment_demands SET source_state = 'approved', approved_by_id = ${f.reviewer.id}::uuid,
          approved_at = now(), approved_headcount = ${count}::integer, mapped_fingerprint = ${fingerprint}::char(64)
        WHERE id = ${f.demand.id}::uuid`).rejects.toThrow('recruitment_demands_origin_shape_check');
    }
    expect(await history(f.demand.id)).toEqual(before);
    expect(await db.recruitmentDemand.findUniqueOrThrow({ where: { id: external.id } })).toEqual(external);
    expect(await db.recruitmentDemandEvent.count({ where: { demandId: external.id } })).toBe(0);
  }, 15000);
});
