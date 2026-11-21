import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConflictException } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import * as ExcelJS from 'exceljs';
import type { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { TalentQueryDto } from '@/talent-pool/dto/talent-query.dto';
import { TalentFollowUpsService } from '@/talent-pool/talent-follow-ups.service';
import { TalentsService } from '@/talent-pool/talents.service';

const migration = '20261121090000_talent_follow_up_plans';
const query = (filters: Partial<TalentQueryDto>) => Object.assign(new TalentQueryDto(), filters);

describe('single follow-up plan and responsibility filters on disposable PostgreSQL', () => {
  let container: StartedPostgreSqlContainer, db: PrismaService, service: TalentFollowUpsService, talents: TalentsService;
  let hr: AuthUser, other: AuthUser, legacy: string, empty: string;
  const oldIds = Array.from({ length: 4 }, () => randomUUID()).sort();
  let sequence = 0;
  async function candidate(name: string, ownerId?: string) {
    return db.talentCandidate.create({ data: { name, phone: String(17000000000 + sequence++), ownerId,
      sourceChannel: 'other', createdById: hr.id } });
  }
  const note = { channel: 'phone', summary: 'Synthetic note', occurredAt: '2030-05-10' };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:14-alpine').withDatabase('hrm_follow_up_plans_test').start();
    const url = new URL(container.getConnectionUri());
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/hrm_follow_up_plans_test') throw Error('Unexpected test database');
    const project = path.resolve(__dirname, '../..');
    const schema = mkdtempSync(path.join(tmpdir(), 'hrm-follow-up-schema-'));
    const migrations = path.join(project, 'prisma', 'migrations');
    const deploy = () => execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(schema, 'schema.prisma')], {
      cwd: project, env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe', timeout: 90000,
    });
    try {
      cpSync(path.join(project, 'prisma', 'schema.prisma'), path.join(schema, 'schema.prisma'));
      mkdirSync(path.join(schema, 'migrations'));
      for (const name of readdirSync(migrations)) {
        if (name === 'migration_lock.toml' || (/^\d/.test(name) && name < migration)) {
          cpSync(path.join(migrations, name), path.join(schema, 'migrations', name), { recursive: true });
        }
      }
      deploy();
      db = new PrismaService({ datasources: { db: { url: url.toString() } } });
      const oldSchema = await db.$queryRaw<Array<{ present: boolean }>>`SELECT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'talent_follow_ups' AND column_name = 'plan_status') AS present`;
      expect(oldSchema[0].present).toBe(false);
      [hr, other] = await Promise.all(['A', 'B'].map(suffix => db.user.create({ data: { name: 'Synthetic HR ' + suffix, sysRole: 'hr' } })));
      legacy = (await candidate('Synthetic legacy')).id;
      empty = (await candidate('Synthetic never contacted')).id;
      for (const [index, id] of oldIds.entries()) {
        // Tied occurred/created days, stable UUID tiebreak, and a subsequent ordinary note.
        const date = index === 3 ? null : '2030-06-0' + (index + 1);
        await db.$executeRaw`INSERT INTO talent_follow_ups(id,candidate_id,created_by_id,occurred_at,created_at,channel,summary,next_follow_up_at)
          VALUES (${id}::uuid,${legacy}::uuid,${hr.id}::uuid,${index === 3 ? '2030-05-11' : '2030-05-10'}::date,
          '2030-05-10T01:00:00Z','phone',${'Historical ' + index},${date}::date)`;
      }
      cpSync(path.join(migrations, migration), path.join(schema, 'migrations', migration), { recursive: true });
      deploy();
      talents = new TalentsService(db);
      service = new TalentFollowUpsService(db, talents);
    } finally { rmSync(schema, { recursive: true, force: true }); }
  }, 180000);
  afterAll(async () => { try { await db?.$disconnect(); } finally { await container?.stop(); } });

  it('carries the prior displayed date forward without rewriting original dates, notes or inventing actors', async () => {
    const rows = await service.list(legacy);
    for (const [index, id] of oldIds.entries()) {
      expect(rows.find(row => row.id === id)).toMatchObject({
        summary: 'Historical ' + index, occurredAt: new Date(index === 3 ? '2030-05-11' : '2030-05-10'),
        nextFollowUpAt: index === 3 ? null : new Date('2030-06-0' + (index + 1)),
        planStatus: ['superseded', 'superseded', 'pending', 'none'][index], planClosedById: null, planClosedAt: null,
      });
    }
    const result = await talents.list(query({ dueOnly: true }), hr);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: legacy, nextFollowUpAt: new Date('2030-06-03') }),
      expect.objectContaining({ id: empty, nextFollowUpAt: null }),
    ]));
  });

  it('serializes competing first plans and competing completions; cancellation keeps closed dates from resurfacing', async () => {
    const row = await candidate('Synthetic concurrent');
    const initial = { ...note, nextFollowUpAt: '2030-06-01', expectedPlanId: null };
    const attempts = await Promise.allSettled([hr, other].map(actor => service.create(row.id, initial, actor)));
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(result => result.status === 'rejected')).toMatchObject({ reason: expect.any(ConflictException) });
    const [first] = await service.list(row.id);
    await service.create(row.id, { ...note, expectedPlanId: first.id }, hr);
    const complete = { ...note, expectedPlanId: first.id, completePlanId: first.id, nextFollowUpAt: '2030-07-01' };
    const changes = await Promise.allSettled([hr, other].map(actor => service.create(row.id, complete, actor)));
    expect(changes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(changes.find(result => result.status === 'rejected')).toMatchObject({ reason: expect.any(ConflictException) });
    const current = (await service.list(row.id)).find(item => item.planStatus === 'pending')!;
    await expect(service.cancel(row.id, first.id, hr)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.cancel(empty, current.id, hr)).rejects.toBeInstanceOf(ConflictException);
    await service.cancel(row.id, current.id, other);
    const history = await service.list(row.id);
    expect(history).toHaveLength(3);
    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, planStatus: 'completed', planClosedById: expect.any(String) }),
      expect.objectContaining({ id: current.id, planStatus: 'cancelled', planClosedById: other.id, planClosedAt: expect.any(Date) }),
    ]));
    expect((await talents.list(query({ keyword: row.name, dueOnly: true }), hr)).total).toBe(0);
    expect((await talents.list(query({ keyword: row.name }), hr)).items[0].nextFollowUpAt).toBeNull();
    expect(await db.auditLog.count({ where: { entityId: current.id, userId: other.id, action: 'cancel_talent_follow_up_plan' } })).toBe(1);
  });

  it('enforces the single pending and status/date constraints and rolls back a failed complete-and-record', async () => {
    const row = await candidate('Synthetic atomic');
    const first = await service.create(row.id, { ...note, nextFollowUpAt: '2030-06-01' }, hr);
    const direct = { candidateId: row.id, channel: 'other', summary: 'Synthetic', occurredAt: new Date(note.occurredAt), createdById: hr.id };
    await expect(db.talentFollowUp.create({ data: { ...direct, nextFollowUpAt: new Date('2030-06-02'), planStatus: 'pending' } }))
      .rejects.toMatchObject({ code: 'P2002' });
    await expect(db.talentFollowUp.create({ data: { ...direct, planStatus: 'pending' } })).rejects.toThrow('talent_follow_ups_plan_date_check');
    const finish = { ...note, expectedPlanId: first.id, completePlanId: first.id };
    await db.$executeRawUnsafe(`CREATE FUNCTION fail_test_followup_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic followup insertion failure'; END; $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER fail_followup BEFORE INSERT ON talent_follow_ups FOR EACH ROW EXECUTE FUNCTION fail_test_followup_insert()');
    try {
      await expect(service.create(row.id, finish, other)).rejects.toThrow('Synthetic followup insertion failure');
      expect(await service.list(row.id)).toEqual([expect.objectContaining({ id: first.id, planStatus: 'pending', planClosedById: null })]);
      expect(await db.auditLog.count({ where: { entityId: first.id, action: 'complete_talent_follow_up_plan' } })).toBe(0);
    } finally { await db.$executeRawUnsafe('DROP TRIGGER fail_followup ON talent_follow_ups'); }
    await service.create(row.id, finish, other);
    const history = await service.list(row.id);
    expect(history.map(item => item.planStatus).sort()).toEqual(['completed', 'none']);
    expect(history.find(item => item.id === first.id)).toMatchObject({ planClosedById: other.id, planClosedAt: expect.any(Date) });
    expect((await talents.list(query({ keyword: row.name, dueOnly: true }), hr)).total).toBe(0);
  });

  it('filters talent scope and one matching application across list, summary and actual workbook rows', async () => {
    const row = await candidate('Synthetic scope positive', other.id), split = await candidate('Synthetic scope split');
    const application = (candidateId: string, ownerId: string, positionName: string, stage: string) => db.talentApplication.create({
      data: { candidateId, ownerId, positionName, stage, createdById: hr.id },
    });
    const matched = await application(row.id, hr.id, 'Synthetic Finance', 'screening');
    await application(row.id, other.id, 'Synthetic Finance', 'screening');
    await application(split.id, hr.id, 'Synthetic Other', 'screening');
    await application(split.id, other.id, 'Synthetic Finance', 'screening');
    const filters = query({ keyword: 'Synthetic scope', responsibilityScope: 'application', mineOnly: true,
      applicationPosition: 'Synthetic Finance', applicationStage: 'screening' });
    const list = await talents.list(filters, hr);
    expect(list.items.map(item => [item.id, item.latestApplication?.id])).toEqual([[row.id, matched.id]]);
    const file = await talents.exportApplications(filters, hr), bytes: Buffer[] = [];
    for await (const chunk of file.getStream()) bytes.push(Buffer.from(chunk));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.concat(bytes) as never);
    expect(workbook.worksheets[0].rowCount).toBe(2);
    expect(workbook.worksheets[0].getRow(2).values).toContain(row.name);
    expect((await talents.list(query({ keyword: 'Synthetic scope', mineOnly: true }), hr)).items.map(item => item.id)).toEqual([split.id]);
  });

  it('returns a consistent due page while another HR cancels between selecting the page and reading its dates', async () => {
    const row = await candidate('Synthetic page read');
    const plan = await service.create(row.id, { ...note, nextFollowUpAt: '2030-06-01', expectedPlanId: null }, hr);
    let cancellations = 0;
    const reader = db.$extends({ query: {
      async $queryRaw({ args, query: readDates }) {
        await service.cancel(row.id, plan.id, other);
        cancellations++;
        return readDates(args);
      },
    } });
    const filters = query({ keyword: row.name, dueOnly: true });
    const snapshot = await new TalentsService(reader as unknown as PrismaService).list(filters, hr);
    expect(cancellations).toBe(1);
    expect(snapshot.total).toBe(1);
    expect(snapshot.items.map(item => [item.id, item.nextFollowUpAt])).toEqual([[row.id, new Date('2030-06-01')]]);
    expect(await talents.list(filters, hr)).toMatchObject({ total: 0, items: [] });
  });

  it('accepts the uppercase spelling of a current UUID in a supplement, completion and cancellation', async () => {
    const row = await candidate('Synthetic uppercase ID');
    const first = await service.create(row.id, { ...note, nextFollowUpAt: '2030-06-01' }, hr);
    await service.create(row.id, { ...note, expectedPlanId: first.id.toUpperCase() }, other);
    const next = await service.create(row.id, { ...note, expectedPlanId: first.id.toUpperCase(),
      completePlanId: first.id.toUpperCase(), nextFollowUpAt: '2030-06-02' }, hr);
    await expect(service.cancel(row.id, next.id.toUpperCase(), other)).resolves.toMatchObject({ id: next.id, planStatus: 'cancelled' });
    expect((await service.list(row.id)).find(item => item.id === first.id)).toMatchObject({ planStatus: 'completed' });
  });
});
