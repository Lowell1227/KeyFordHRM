import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTalentDto } from './dto/create-talent.dto';
import { TalentQueryDto } from './dto/talent-query.dto';
import { UpdateTalentDto } from './dto/update-talent.dto';
import { salaryWrite, serializeTalentSalary, talentSalaryWhere } from './talent-salary';
import { TalentsService } from './talents.service';
import { talentEditVersion } from './talent-edit-version';

describe('talent salary amounts and compatibility', () => {
  it.each([
    ['legacy_k', 5, 8, 5000, 8000, 5, 8, false],
    ['legacy_k', 999, 1000, null, null, 999, 1000, true],
    ['legacy_k', null, 999, null, null, null, 999, true],
    ['yuan', 5500, 5501, 5500, 5501, 5.5, 5.501, false],
    ['yuan', 0, 999, 0, 999, 0, 0.999, false],
  ])('serializes %s raw %s..%s without altering stored amounts', (unit, min, max, minYuan, maxYuan, minK, maxK, review) => {
    const row = { expectSalaryMin: min as number | null, expectSalaryMax: max as number | null, expectSalaryUnit: unit as string };
    expect(serializeTalentSalary(row)).toMatchObject({ expectSalaryMin: minK, expectSalaryMax: maxK,
      expectSalaryMinYuan: minYuan, expectSalaryMaxYuan: maxYuan, salaryNeedsReview: review });
    expect(row.expectSalaryMin).toBe(min); expect(row.expectSalaryMax).toBe(max);
  });

  it('writes exact integer yuan, legacy K, and explicit nulls with an unambiguous marker', () => {
    expect(salaryWrite({ expectSalaryMinYuan: 5500, expectSalaryMaxYuan: 5501 })).toEqual({ expectSalaryMin: 5500, expectSalaryMax: 5501, expectSalaryUnit: 'yuan' });
    expect(salaryWrite({ expectSalaryMinYuan: null, expectSalaryMaxYuan: null })).toEqual({ expectSalaryMin: null, expectSalaryMax: null, expectSalaryUnit: 'yuan' });
    expect(salaryWrite({ expectSalaryMin: 5, expectSalaryMax: 8 })).toEqual({ expectSalaryMin: 5, expectSalaryMax: 8, expectSalaryUnit: 'legacy_k' });
  });

  it('preserves untouched raw salary, including historical 999', () => {
    expect(salaryWrite({}, { expectSalaryMin: 999, expectSalaryMax: 5, expectSalaryUnit: 'legacy_k' })).toEqual({});
  });

  it('merges a yuan update with valid legacy bound and refuses an unresolved 999', () => {
    expect(salaryWrite({ expectSalaryMinYuan: 5500 }, { expectSalaryMin: 5, expectSalaryMax: 8, expectSalaryUnit: 'legacy_k' }))
      .toEqual({ expectSalaryMin: 5500, expectSalaryMax: 8000, expectSalaryUnit: 'yuan' });
    expect(() => salaryWrite({ expectSalaryMinYuan: 5500 }, { expectSalaryMin: 5, expectSalaryMax: 999, expectSalaryUnit: 'legacy_k' })).toThrow('核对');
    expect(salaryWrite({ expectSalaryMinYuan: 5500, expectSalaryMaxYuan: null }, { expectSalaryMin: 5, expectSalaryMax: 999, expectSalaryUnit: 'legacy_k' }))
      .toEqual({ expectSalaryMin: 5500, expectSalaryMax: null, expectSalaryUnit: 'yuan' });
  });

  it('preserves an exact yuan bound when an old client changes only the K bound', () => {
    expect(salaryWrite({ expectSalaryMin: 6 }, { expectSalaryMin: 5501, expectSalaryMax: 10001, expectSalaryUnit: 'yuan' }))
      .toEqual({ expectSalaryMin: 6000, expectSalaryMax: 10001, expectSalaryUnit: 'yuan' });
  });

  it('rejects mixed units, invalid amounts, overflowing conversion and reversed range', () => {
    expect(() => salaryWrite({ expectSalaryMin: null, expectSalaryMaxYuan: 5500 })).toThrow('同时');
    for (const amount of [-1, 5500.5, 2147483648]) expect(() => salaryWrite({ expectSalaryMinYuan: amount })).toThrow();
    expect(() => salaryWrite({ expectSalaryMin: 2147483647 }, { expectSalaryMin: 1, expectSalaryMax: null, expectSalaryUnit: 'yuan' })).toThrow();
    expect(() => salaryWrite({ expectSalaryMinYuan: 5501, expectSalaryMaxYuan: 5500 })).toThrow('期望薪资下限不能高于上限');
  });

  it('builds unit-aware overlap filters with exact ceil/floor legacy boundaries and excludes 999', () => {
    expect(talentSalaryWhere({ salaryMinYuan: 5501, salaryMaxYuan: 7999 })).toEqual({ OR: [
      { expectSalaryUnit: 'yuan', expectSalaryMax: { gte: 5501 }, expectSalaryMin: { lte: 7999 } },
      { expectSalaryUnit: 'legacy_k', AND: [
        { OR: [{ expectSalaryMin: null }, { expectSalaryMin: { not: 999 } }] },
        { OR: [{ expectSalaryMax: null }, { expectSalaryMax: { not: 999 } }] },
        { expectSalaryMax: { gte: 6 } }, { expectSalaryMin: { lte: 7 } },
      ] },
    ] });
    expect(talentSalaryWhere({ salaryMin: 5, salaryMax: 8 })).toEqual(talentSalaryWhere({ salaryMinYuan: 5000, salaryMaxYuan: 8000 }));
    expect(talentSalaryWhere({})).toBeUndefined();
    expect(() => talentSalaryWhere({ salaryMin: 5, salaryMaxYuan: 8000 })).toThrow('同时');
  });

  it('keeps huge old-client K filters within the stored yuan integer range', () => {
    expect(talentSalaryWhere({ salaryMin: 2147483647 })?.OR?.[0]).toEqual({ expectSalaryUnit: 'yuan', id: { in: [] } });
    expect(talentSalaryWhere({ salaryMax: 2147483647 })?.OR?.[0]).toEqual({ expectSalaryUnit: 'yuan', expectSalaryMin: { not: null } });
  });
});

describe('talent yuan DTO contract', () => {
  it.each(['expectSalaryMinYuan', 'expectSalaryMaxYuan'])('allows precise integer %s and rejects fractions or int overflow', async field => {
    for (const value of [0, 5500, 5501, 2147483647, null]) {
      expect(await validate(plainToInstance(UpdateTalentDto, { [field]: value }), { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    }
    for (const value of [-1, 5.5, 2147483648]) {
      const errors = await validate(plainToInstance(CreateTalentDto, { name: '虚构人才', phone: '17000000000', sourceChannel: 'referral', [field]: value }));
      expect(errors.some(error => error.property === field)).toBe(true);
    }
  });

  it('accepts exact yuan filters and rejects fractions or overflow', async () => {
    expect(await validate(plainToInstance(TalentQueryDto, { salaryMinYuan: '5501', salaryMaxYuan: '7999' }), { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    for (const salaryMinYuan of ['5500.5', '-1', '2147483648']) {
      expect((await validate(plainToInstance(TalentQueryDto, { salaryMinYuan }))).some(error => error.property === 'salaryMinYuan')).toBe(true);
    }
  });
});

describe('TalentsService yuan salary wiring', () => {
  const operator = { id: 'hr-one', sysRole: 'hr' } as never;
  function fixture(patch = {}) {
    let row = { id: 'candidate-one', name: '虚构人才', phone: '17000000000', sourceChannel: 'referral', status: 'new',
      deletedAt: null, expectSalaryMin: 5, expectSalaryMax: 8, expectSalaryUnit: 'legacy_k', education: null, educationReferenceDataId: null,
      createdById: 'hr-one', updatedAt: new Date('2026-11-20T00:00:00Z'), files: [], followUps: [], shares: [], _count: { files: 0 }, ...patch };
    const prisma: any = { talentCandidate: {
      findFirst: jest.fn(async ({ where }) => where.phone ? null : row),
      create: jest.fn(async ({ data }) => { row = { ...row, ...data }; return row; }),
      update: jest.fn(async ({ data }) => { row = { ...row, ...data }; return row; }),
      findMany: jest.fn(async () => [row]), count: jest.fn(async () => 1),
    }, user: { findFirst: jest.fn(async () => ({ id: 'hr-one' })), findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => ({ id: 'hr-one', sysRole: 'hr', status: 'active', archivedAt: null, deletedAt: null, isAssessorOnly: false })) },
      $queryRaw: jest.fn(async () => []), auditLog: { create: jest.fn() } };
    prisma.$transaction = jest.fn(async ops => typeof ops === 'function' ? ops(prisma) : Promise.all(ops));
    return { prisma, service: new TalentsService(prisma), row: () => row };
  }

  it('creates, reads, lists and updates exact yuan with raw-row edit versions', async () => {
    const f = fixture();
    const created = await f.service.create({ name: '虚构人才', phone: '17000000000', sourceChannel: 'referral', expectSalaryMinYuan: 5500, expectSalaryMaxYuan: 5501 } as never, operator);
    expect(f.row()).toMatchObject({ expectSalaryMin: 5500, expectSalaryMax: 5501, expectSalaryUnit: 'yuan' });
    expect(created).toMatchObject({ expectSalaryMin: 5.5, expectSalaryMax: 5.501, expectSalaryMinYuan: 5500, expectSalaryMaxYuan: 5501, salaryNeedsReview: false });
    expect(created.editVersion).toBe(talentEditVersion(f.row() as never));
    expect(await f.service.detail(f.row().id)).toMatchObject({ expectSalaryMinYuan: 5500, expectSalaryMaxYuan: 5501 });
    expect((await f.service.list({ skip: 0, take: 20, salaryMinYuan: 5501 } as never)).items[0]).toMatchObject({ expectSalaryMinYuan: 5500, expectSalaryMaxYuan: 5501 });
    expect(f.prisma.talentCandidate.findMany.mock.calls[0][0].where.AND[0].OR[0]).toEqual({ expectSalaryUnit: 'yuan', expectSalaryMax: { gte: 5501 } });
    const updated = await f.service.update(f.row().id, { expectSalaryMaxYuan: 5502, editVersion: created.editVersion } as never, operator);
    expect(updated).toMatchObject({ expectSalaryMinYuan: 5500, expectSalaryMaxYuan: 5502 });
  });

  it('editing unrelated fields preserves suspicious legacy raw data and review state', async () => {
    const f = fixture({ expectSalaryMin: 999 });
    const result = await f.service.update(f.row().id, { note: '仅补充备注', editVersion: talentEditVersion(f.row() as never) } as never, operator);
    expect(f.row()).toMatchObject({ expectSalaryMin: 999, expectSalaryMax: 8, expectSalaryUnit: 'legacy_k' });
    expect(result).toMatchObject({ expectSalaryMinYuan: null, expectSalaryMaxYuan: null, salaryNeedsReview: true });
  });
});
