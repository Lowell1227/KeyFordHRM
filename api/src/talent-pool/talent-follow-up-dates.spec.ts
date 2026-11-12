import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateFollowUpDto, parseTalentDate } from './dto/create-follow-up.dto';
import { TalentFollowUpsService } from './talent-follow-ups.service';
import type { AuthUser } from '@/common/types/auth.types';

const operator = { id: 'fictional-followup-hr' } as AuthUser;
const invalidDates = [
  '2026-02-31', '2026-02-29', '1900-02-29', '2100-02-29', '2026-04-31',
  '2026-00-10', '2026-13-10', '2026-01-00', '2026-01-32', '0000-01-01',
  '10000-01-01', '-2026-01-01', '2026-2-01', '2026-01-01T00:00:00Z', '', 'invalid',
];

function setup() {
  const tx = {
    talentFollowUp: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)) },
    talentCandidate: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = { $transaction: jest.fn().mockImplementation((run) => run(tx)) };
  const service = new TalentFollowUpsService(prisma as never, {
    findActive: jest.fn().mockResolvedValue({ id: 'fictional-candidate' }),
  } as never);
  return { service, prisma, tx };
}

describe('follow-up Beijing date and calendar regression (F3/F4)', () => {
  afterEach(() => jest.useRealTimers());

  it.each([
    ['2026-11-12T15:59:59.999Z', '2026-11-12'],
    ['2026-11-12T16:00:00.000Z', '2026-11-13'],
    ['2026-11-12T17:00:00.000Z', '2026-11-13'],
    ['2026-11-12T23:59:59.999Z', '2026-11-13'],
    ['2026-12-31T16:00:00.000Z', '2027-01-01'],
    ['2028-02-28T16:00:00.000Z', '2028-02-29'],
  ])('omitted occurredAt at %s saves Beijing day %s as a date-only value', async (now, expected) => {
    jest.useFakeTimers().setSystemTime(new Date(now));
    const { service, tx } = setup();
    const saved = await service.create('fictional-candidate', { channel: 'phone', summary: 'F3 fixture' }, operator);
    expect(saved.occurredAt.toISOString()).toBe(`${expected}T00:00:00.000Z`);
    expect(tx.talentCandidate.updateMany.mock.calls[0][0].data.lastFollowUpAt).toEqual(saved.occurredAt);
    expect(saved.nextFollowUpAt).toBeNull();
  });

  describe.each(['occurredAt', 'nextFollowUpAt'] as const)('%s', (field) => {
    it.each(invalidDates)('DTO and service reject %j before transaction', async (date) => {
      const input = { channel: 'phone', summary: 'F4 fixture', [field]: date };
      const pipe = new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true }, whitelist: true });
      await expect(pipe.transform(input, { type: 'body', metatype: CreateFollowUpDto })).rejects.toBeInstanceOf(BadRequestException);
      const { service, prisma } = setup();
      await expect(service.create('fictional-candidate', input, operator)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each(['0001-01-01', '0099-12-31', '2000-02-29', '2028-02-29', '2026-04-30', '9999-12-31'])('accepts real calendar day %s without shifting', async (date) => {
      const input = { channel: 'phone', summary: 'valid fixture', [field]: date };
      const pipe = new ValidationPipe({ transform: true });
      await expect(pipe.transform(input, { type: 'body', metatype: CreateFollowUpDto })).resolves.toMatchObject(input);
      const { service } = setup();
      const saved = await service.create('fictional-candidate', input, operator);
      expect(saved[field]?.toISOString()).toBe(`${date}T00:00:00.000Z`);
    });
  });

  it('date parser itself never silently rolls a non-calendar date forward', () => {
    expect(() => parseTalentDate('2026-02-31')).toThrow(BadRequestException);
  });

  it('preserves the optional null/omitted next date contract', async () => {
    const pipe = new ValidationPipe({ transform: true });
    const input = await pipe.transform({ channel: 'phone', summary: 'optional fixture', nextFollowUpAt: null }, { type: 'body', metatype: CreateFollowUpDto });
    const { service } = setup();
    expect((await service.create('fictional-candidate', input, operator)).nextFollowUpAt).toBeNull();
  });
});
