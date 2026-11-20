import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthUser } from '@/common/types/auth.types';
import { TalentsService } from './talents.service';
import { talentEditVersion } from './talent-edit-version';
import { CreateTalentDto } from './dto/create-talent.dto';
import { TalentQueryDto } from './dto/talent-query.dto';

const hr = { id: '00000000-0000-4000-8000-000000000001', name: 'Synthetic HR', sysRole: 'hr' } as AuthUser;
const ownerId = '00000000-0000-4000-8000-000000000002';
const educationId = '00000000-0000-4000-8000-000000000003';

function setup() {
  const row: any = { id: 'candidate', name: 'Synthetic', phone: '17000000000', sourceChannel: 'referral',
    status: 'new', education: 'legacy degree', educationReferenceDataId: null, ownerId: null, createdById: hr.id,
    updatedAt: new Date('2026-11-18T00:00:00Z'), deletedAt: null,
    files: [], followUps: [], shares: [], applications: [], onboardingRequests: [], _count: { files: 0 } };
  const prisma: any = {
    talentCandidate: {
      findFirst: jest.fn(async ({ where }) => where.phone ? null : { ...row }),
      create: jest.fn(async ({ data }) => ({ ...row, ...data })),
      update: jest.fn(async ({ data }) => Object.assign(row, data)),
      findMany: jest.fn(async () => [{ ...row }]), count: jest.fn(async () => 1),
    },
    user: { findFirst: jest.fn(async () => ({ id: ownerId })),
      findMany: jest.fn(async () => [{ id: hr.id, name: 'Creator' }, { id: ownerId, name: 'Owner' }]) },
    personnelReferenceData: { findFirst: jest.fn(async () => ({ id: educationId, name: 'Degree from reference' })) },
    auditLog: { create: jest.fn() }, $queryRaw: jest.fn(async () => []),
  };
  prisma.$transaction = jest.fn(async ops => typeof ops === 'function' ? ops(prisma) : Promise.all(ops));
  return { row, prisma, sut: new TalentsService(prisma) };
}

describe('talent ownership and reference education', () => {
  it('defaults new ownership to the creator and resolves explicitly selected active education', async () => {
    const { sut, prisma } = setup();
    const result = await sut.create({ name: 'Synthetic', phone: '17000000000', sourceChannel: 'referral',
      educationReferenceDataId: educationId, education: 'bachelor' } as any, hr);
    expect(result).toMatchObject({ ownerId: hr.id, educationReferenceDataId: educationId, education: 'Degree from reference' });
    expect(prisma.personnelReferenceData.findFirst).toHaveBeenCalledWith({
      where: { id: educationId, kind: 'education', isActive: true }, select: { id: true, name: true },
    });
    expect(prisma.user.findFirst.mock.calls[0][0].where).toMatchObject({ id: hr.id,
      deletedAt: null, archivedAt: null, status: { in: ['active', 'probation'] }, isAssessorOnly: false,
      OR: [{ sysRole: { in: ['hr', 'system_admin'] } }, { sysRole: 'hr_user', hrCapabilities: { has: 'employee_archive_edit' } }],
    });
  });

  it('uses an explicit owner rather than silently using the creator', async () => {
    const { sut } = setup();
    await expect(sut.create({ name: 'Synthetic', phone: '17000000000', sourceChannel: 'referral', ownerId } as any, hr))
      .resolves.toMatchObject({ ownerId });
  });

  it('rejects an owner outside current HR editors', async () => {
    const { sut, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(sut.create({ name: 'Synthetic', phone: '17000000000', sourceChannel: 'referral', ownerId } as any, hr))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.talentCandidate.create).not.toHaveBeenCalled();
  });

  it('rejects wrong-kind, inactive or missing education without changing the candidate', async () => {
    const { sut, prisma, row } = setup();
    prisma.personnelReferenceData.findFirst.mockResolvedValue(null);
    await expect(sut.update(row.id, { educationReferenceDataId: educationId, editVersion: talentEditVersion(row) } as any, hr))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.talentCandidate.update).not.toHaveBeenCalled();
  });

  it('updates both scalar IDs and education name inside the locked transaction', async () => {
    const { sut, row } = setup();
    await expect(sut.update(row.id, { ownerId, educationReferenceDataId: educationId, editVersion: talentEditVersion(row) } as any, hr))
      .resolves.toMatchObject({ ownerId, educationReferenceDataId: educationId, education: 'Degree from reference' });
  });

  it('preserves old education and an unchanged inactive owner/reference on unrelated edits', async () => {
    const { sut, prisma, row } = setup();
    Object.assign(row, { ownerId, educationReferenceDataId: educationId });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.personnelReferenceData.findFirst.mockResolvedValue(null);
    await expect(sut.update(row.id, { note: 'Only this field', ownerId, educationReferenceDataId: educationId,
      education: row.education, editVersion: talentEditVersion(row) } as any, hr))
      .resolves.toMatchObject({ education: 'legacy degree', ownerId, educationReferenceDataId: educationId });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.personnelReferenceData.findFirst).not.toHaveBeenCalled();
  });

  it('preserves a legacy creator fallback without persisting or revalidating it on an unrelated edit', async () => {
    const { sut, prisma, row } = setup();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(sut.update(row.id, { ownerId: hr.id, note: 'Only a note', editVersion: talentEditVersion(row) } as any, hr))
      .resolves.toMatchObject({ ownerId: null, note: 'Only a note' });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('links new unlinked education by exact active name, not by an enum translation', async () => {
    const { sut, prisma } = setup();
    await expect(sut.create({ name: 'Synthetic', phone: '17000000000', sourceChannel: 'referral',
      education: 'Degree from reference', educationReferenceDataId: null } as any, hr))
      .resolves.toMatchObject({ educationReferenceDataId: educationId, education: 'Degree from reference' });
    expect(prisma.personnelReferenceData.findFirst).toHaveBeenCalledWith({
      where: { kind: 'education', isActive: true, name: 'Degree from reference' }, select: { id: true, name: true },
    });
  });

  it.each(['create', 'update'])('rejects unmatched new education text on %s with a field error', async action => {
    const { sut, prisma, row } = setup();
    prisma.personnelReferenceData.findFirst.mockResolvedValue(null);
    const input = { name: 'Synthetic', phone: '17000000000', sourceChannel: 'referral',
      education: 'Unmatched degree', educationReferenceDataId: null, editVersion: talentEditVersion(row) };
    await expect(action === 'create' ? sut.create(input, hr) : sut.update(row.id, input, hr))
      .rejects.toMatchObject({ response: { data: { fieldErrors: { educationReferenceDataId: expect.any(String) } } } });
  });

  it('keeps unchanged unlinked legacy text/null and permits an explicit clear without inventing reference data', async () => {
    const { sut, prisma, row } = setup();
    await sut.update(row.id, { education: row.education, educationReferenceDataId: null, editVersion: talentEditVersion(row) }, hr);
    expect(prisma.personnelReferenceData.findFirst).not.toHaveBeenCalled();
    await expect(sut.update(row.id, { education: '', educationReferenceDataId: null, editVersion: talentEditVersion(row) }, hr))
      .resolves.toMatchObject({ education: null, educationReferenceDataId: null });
    expect(prisma.personnelReferenceData.findFirst).not.toHaveBeenCalled();
  });

  it.each(['ownerId', 'educationReferenceDataId'])('invalidates stale forms after a %s scalar change', async key => {
    const { sut, row } = setup();
    const editVersion = talentEditVersion(row);
    row[key] = ownerId;
    await expect(sut.update(row.id, { note: 'Stale', editVersion }, hr)).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepts legacy education text and UUID fields, rejects overlong names and invalid IDs', async () => {
    const input = { name: 'Synthetic', phone: '17000000000', sourceChannel: 'referral', education: 'Legacy custom degree', ownerId, educationReferenceDataId: educationId };
    expect(await validate(plainToInstance(CreateTalentDto, input))).toEqual([]);
    const errors = await validate(plainToInstance(CreateTalentDto, { ...input, education: 'x'.repeat(101), ownerId: 'invalid' }));
    expect(errors.map(e => e.property)).toEqual(expect.arrayContaining(['education', 'ownerId']));
  });
});

describe('talent list recruitment summaries and current follow-up scope', () => {
  it('mineOnly uses the operator and creator fallback, not a client-supplied owner', async () => {
    const { sut, prisma } = setup();
    await (sut.list as any)(plainToInstance(TalentQueryDto, { mineOnly: true, keyword: 'Synthetic' }), hr);
    expect(prisma.talentCandidate.findMany.mock.calls[0][0].where.AND).toContainEqual({
      OR: [{ ownerId: hr.id }, { ownerId: null, createdById: hr.id }],
    });
    await expect((sut.list as any)(plainToInstance(TalentQueryDto, { mineOnly: true }))).rejects.toBeInstanceOf(BadRequestException);
    expect(await validate(plainToInstance(TalentQueryDto, { mineOnly: 'false' }))).toEqual([]);
    expect((plainToInstance(TalentQueryDto, { mineOnly: 'false' }) as any).mineOnly).toBe(false);
  });

  it('dueOnly keeps recruitment-stage filtering independent from follow-up work', async () => {
    const { sut, prisma } = setup();
    await sut.list(plainToInstance(TalentQueryDto, { dueOnly: true }));
    expect(prisma.talentCandidate.findMany.mock.calls[0][0].where.AND).toEqual([{ OR: [
      { followUps: { none: {} } }, { followUps: { some: { nextFollowUpAt: { not: null } } } },
    ] }]);
  });

  it('staleOnly excludes terminal candidates and candidates with only closed applications', async () => {
    const { sut, prisma } = setup();
    await sut.list(plainToInstance(TalentQueryDto, { staleOnly: true }));
    const where = prisma.talentCandidate.findMany.mock.calls[0][0].where;
    expect(where.AND).toContainEqual({ status: { notIn: ['hired', 'rejected'] } });
    expect(where.AND).toContainEqual({ OR: [
      { applications: { none: {} } },
      { applications: { some: { stage: { notIn: ['hired', 'rejected', 'declined', 'withdrawn'] } } } },
    ] });
  });

  it('does not hide closed records from the general list or project candidate status from applications', async () => {
    const { sut, row, prisma } = setup();
    Object.assign(row, { status: 'rejected', applications: [{ id: 'app', stage: 'hired' }] });
    const result = await sut.list(new TalentQueryDto());
    expect(prisma.talentCandidate.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
    expect(result.items[0].status).toBe('rejected');
  });

  it('adds effective owner and minimal application/onboarding summaries to list and detail', async () => {
    const { sut, row, prisma } = setup();
    const request = { id: 'request', onboardingStatus: 'pending_entry', recordStatus: 'pending', cancelledAt: null };
    row.applications = [{ id: 'app', stage: 'accepted', positionName: 'Engineer', ownerId }];
    row.onboardingRequests = [request];
    const list = await sut.list(new TalentQueryDto());
    expect(list.items[0]).toMatchObject({ ownerId: hr.id, ownerName: 'Creator', latestApplication: { id: 'app', stage: 'accepted', ownerName: 'Owner' }, onboardingRequest: request });
    expect(list.items[0].editVersion).toBe(talentEditVersion(row));
    const detail = await sut.detail(row.id);
    expect(detail).toMatchObject({ ownerId: hr.id, ownerName: 'Creator', applications: [{ id: 'app' }], onboardingRequest: request });
    const includes = prisma.talentCandidate.findMany.mock.calls[0][0].include;
    expect(includes.applications.take).toBe(1);
    expect(includes.applications.select).not.toHaveProperty('hiringReason');
    expect(includes.onboardingRequests.select).toEqual({ id: true, onboardingStatus: true, recordStatus: true, cancelledAt: true });
  });
});
