import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { TalentQueryDto } from './dto/talent-query.dto';
import { TalentsService } from './talents.service';

function setup() {
  const candidates = ['candidate-1', 'candidate-2'].map((id) => ({ id, _count: { files: 0 } }));
  const prisma = {
    talentCandidate: {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue(candidates),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };
  prisma.$transaction.mockImplementation(read => read(prisma));
  const sut = new TalentsService(prisma as never);
  return { sut, prisma };
}

function statement(call: unknown[]) {
  const [strings, ...values] = call;
  const query = Prisma.sql(strings as TemplateStringsArray, ...values);
  return { sql: query.sql.replace(/\s+/g, ' ').trim(), values: query.values };
}

describe('Talent follow-up due and attachment query contracts', () => {
  afterEach(() => jest.useRealTimers());

  it('pending scope uses contact history and every scheduled date without a today cutoff', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2035-03-19T16:30:00Z'));
    const { sut, prisma } = setup();
    prisma.$queryRaw.mockResolvedValue([]);

    await sut.list(Object.assign(new TalentQueryDto(), { dueOnly: true }));

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1); // only selected-page date attachment
    expect(prisma.talentCandidate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { deletedAt: null, AND: [{ OR: [
        { followUps: { none: { recordType: 'communication' } } }, { followUps: { some: { planStatus: 'pending' } } },
      ] }] },
    }));
  });

  it('binds only the selected page IDs and attaches each pending date to the right candidate', async () => {
    const { sut, prisma } = setup();
    prisma.$queryRaw.mockResolvedValue([
      { candidate_id: 'candidate-2', next_follow_up_at: new Date('2035-03-21T00:00:00Z') },
      { candidate_id: 'candidate-1', next_follow_up_at: new Date('2035-03-19T00:00:00Z') },
    ]);

    const result = await sut.list(new TalentQueryDto());

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const attach = statement(prisma.$queryRaw.mock.calls[0]);
    expect(attach.sql).toContain('SELECT candidate_id, next_follow_up_at');
    expect(attach.sql).toContain("WHERE plan_status = 'pending' AND candidate_id IN (?::uuid,?::uuid)");
    expect(attach.values).toEqual(['candidate-1', 'candidate-2']);
    expect(result.items.map(({ id, nextFollowUpAt }) => ({ id, nextFollowUpAt }))).toEqual([
      { id: 'candidate-1', nextFollowUpAt: new Date('2035-03-19T00:00:00Z') },
      { id: 'candidate-2', nextFollowUpAt: new Date('2035-03-21T00:00:00Z') },
    ]);
  });
});
