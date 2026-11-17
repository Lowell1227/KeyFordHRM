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
    $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    $queryRaw: jest.fn(),
  };
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

  it('binds the Shanghai calendar day as date and ranks only nonempty next dates deterministically', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2035-03-19T16:30:00Z'));
    const { sut, prisma } = setup();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'candidate-1' }]).mockResolvedValueOnce([]);

    await sut.list(Object.assign(new TalentQueryDto(), { dueOnly: true }));

    const due = statement(prisma.$queryRaw.mock.calls[0]);
    expect(due.sql).toContain('PARTITION BY candidate_id ORDER BY occurred_at DESC, created_at DESC, id DESC');
    expect(due.sql).toContain('FROM talent_follow_ups WHERE next_follow_up_at IS NOT NULL');
    expect(due.sql).toContain('WHERE rn = 1 AND next_follow_up_at <= ?::date');
    expect(due.sql).not.toContain('CURRENT_DATE');
    expect(due.values).toEqual(['2035-03-20']);
    expect(prisma.talentCandidate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { deletedAt: null, AND: [{ id: { in: ['candidate-1'] } }] },
    }));
  });

  it('binds only the selected page IDs and attaches each latest nonempty next date to the right candidate', async () => {
    const { sut, prisma } = setup();
    prisma.$queryRaw.mockResolvedValue([
      { candidate_id: 'candidate-2', next_follow_up_at: new Date('2035-03-21T00:00:00Z') },
      { candidate_id: 'candidate-1', next_follow_up_at: new Date('2035-03-19T00:00:00Z') },
    ]);

    const result = await sut.list(new TalentQueryDto());

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const attach = statement(prisma.$queryRaw.mock.calls[0]);
    expect(attach.sql).toContain('SELECT DISTINCT ON (candidate_id) candidate_id, next_follow_up_at');
    expect(attach.sql).toContain('WHERE next_follow_up_at IS NOT NULL AND candidate_id::text IN (?,?)');
    expect(attach.sql).toContain('ORDER BY candidate_id, occurred_at DESC, created_at DESC, id DESC');
    expect(attach.values).toEqual(['candidate-1', 'candidate-2']);
    expect(result.items.map(({ id, nextFollowUpAt }) => ({ id, nextFollowUpAt }))).toEqual([
      { id: 'candidate-1', nextFollowUpAt: new Date('2035-03-19T00:00:00Z') },
      { id: 'candidate-2', nextFollowUpAt: new Date('2035-03-21T00:00:00Z') },
    ]);
  });
});
