import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaService } from '@/prisma/prisma.service';
import type { AuthUser } from '@/common/types/auth.types';
import { TalentsService } from '@/talent-pool/talents.service';
import { TalentQueryDto } from '@/talent-pool/dto/talent-query.dto';

describe('talent salary units: disposable migrated PostgreSQL only', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let prisma: PrismaService;
  let talents: TalentsService;
  let actor: AuthUser;
  let suffix = 0;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').withDatabase('hrm_talent_salary_test').withStartupTimeout(60000).start();
    const databaseUrl = container.getConnectionUri();
    const url = new URL(databaseUrl);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/hrm_talent_salary_test') throw new Error('Disposable salary database required');
    try {
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', timeout: 90000,
      });
    } catch { throw new Error('Disposable salary migrations failed'); }
    prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    talents = new TalentsService(prisma);
    const hr = await prisma.user.create({ data: { name: '虚构金额验收HR', sysRole: 'hr', status: 'active' } });
    actor = { id: hr.id, name: hr.name, sysRole: hr.sysRole, deptId: null, isAssessorOnly: false, canViewAll: false };
  }, 150000);
  afterAll(async () => { try { await prisma?.$disconnect(); } finally { await container?.stop(); } }, 30000);
  const input = () => ({ name: `虚构金额人才${++suffix}`, phone: `1700000${String(suffix).padStart(4, '0')}`, sourceChannel: 'other' });

  it('migrations preserve old K values and new exact yuan persists without truncation', async () => {
    const legacy = await prisma.talentCandidate.create({ data: { ...input(), createdById: actor.id, ownerId: actor.id, expectSalaryMin: 7, expectSalaryMax: 10 } });
    expect(legacy.expectSalaryUnit).toBe('legacy_k');
    const view = await talents.detail(legacy.id);
    expect(view).toMatchObject({ expectSalaryMin: 7, expectSalaryMax: 10, expectSalaryMinYuan: 7000, expectSalaryMaxYuan: 10000, salaryNeedsReview: false });
    const exact = await talents.create({ ...input(), expectSalaryMinYuan: 5501, expectSalaryMaxYuan: 6809 }, actor);
    expect(exact).toMatchObject({ expectSalaryMinYuan: 5501, expectSalaryMaxYuan: 6809, expectSalaryMin: 5.501, salaryNeedsReview: false });
    expect(await prisma.talentCandidate.findUniqueOrThrow({ where: { id: exact.id } })).toMatchObject({ expectSalaryMin: 5501, expectSalaryMax: 6809, expectSalaryUnit: 'yuan' });
    expect(await prisma.talentCandidate.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ expectSalaryMin: 7, expectSalaryMax: 10, expectSalaryUnit: 'legacy_k' });
  });

  it('unrelated edits preserve suspicious history while explicitly reviewed yuan999 is valid', async () => {
    const legacy = await prisma.talentCandidate.create({ data: { ...input(), createdById: actor.id, ownerId: actor.id, expectSalaryMin: 999, expectSalaryMax: 999 } });
    const before = await talents.detail(legacy.id);
    expect(before).toMatchObject({ salaryNeedsReview: true, expectSalaryMinYuan: null, expectSalaryMaxYuan: null });
    await talents.update(legacy.id, { note: '虚构仅改备注', editVersion: before.editVersion }, actor);
    expect(await prisma.talentCandidate.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ expectSalaryMin: 999, expectSalaryMax: 999, expectSalaryUnit: 'legacy_k' });
    const latest = await talents.detail(legacy.id);
    const reviewed = await talents.update(legacy.id, { expectSalaryMinYuan: 999, expectSalaryMaxYuan: 999, editVersion: latest.editVersion }, actor);
    expect(reviewed).toMatchObject({ salaryNeedsReview: false, expectSalaryMinYuan: 999, expectSalaryMaxYuan: 999 });
  });

  it('partial old-client K edits preserve an untouched exact yuan bound and unit-aware queries agree', async () => {
    const exact = await talents.create({ ...input(), expectSalaryMinYuan: 5501, expectSalaryMaxYuan: 6809 }, actor);
    const updated = await talents.update(exact.id, { expectSalaryMax: 8, editVersion: exact.editVersion }, actor);
    expect(updated).toMatchObject({ expectSalaryMinYuan: 5501, expectSalaryMaxYuan: 8000 });
    const byYuan = await talents.list(Object.assign(new TalentQueryDto(), { salaryMinYuan: 7500, salaryMaxYuan: 7900 }), actor);
    const byK = await talents.list(Object.assign(new TalentQueryDto(), { salaryMin: 7, salaryMax: 8 }), actor);
    expect(byYuan.items.some(row => row.id === exact.id)).toBe(true);
    expect(byK.items.some(row => row.id === exact.id)).toBe(true);
    const count = await prisma.talentCandidate.count();
    await expect(talents.create({ ...input(), expectSalaryMinYuan: 5500.5 }, actor)).rejects.toThrow();
    expect(await prisma.talentCandidate.count()).toBe(count);
  });

  it('pending follow-up includes never contacted and every scheduled date, independently of recruitment stage', async () => {
    const rows = await Promise.all(['new', 'future', 'past', 'finished', 'hired'].map(async kind =>
      talents.create({ ...input(), name: `虚构待跟进验收_${kind}` }, actor)));
    const [, future, past, finished, hired] = rows;
    for (const [row, nextFollowUpAt] of [[future, new Date('2030-01-01')], [past, new Date('2000-01-01')], [finished, null]] as const) {
      await prisma.talentFollowUp.create({ data: { candidateId: row.id, occurredAt: new Date('2026-11-20'),
        channel: 'other', summary: '虚构跟进', nextFollowUpAt, createdById: actor.id } });
    }
    await prisma.talentCandidate.update({ where: { id: hired.id }, data: { status: 'hired' } });
    const result = await talents.list(Object.assign(new TalentQueryDto(), { keyword: '虚构待跟进验收_', dueOnly: true }), actor);
    expect(result.items.map(row => row.id).sort()).toEqual(rows.filter(row => row.id !== finished.id).map(row => row.id).sort());
    expect(result.items.find(row => row.id === future.id)?.nextFollowUpAt?.toISOString().slice(0, 10)).toBe('2030-01-01');
    expect(result.items.find(row => row.id === hired.id)?.status).toBe('hired');
  });
});
