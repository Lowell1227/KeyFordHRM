import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RecruitmentIntakesService } from './recruitment-intakes.service';
import { RecruitmentPostingsService } from './recruitment-postings.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRecruitmentPostingDto } from './recruitment-postings.dto';

describe('resume intake trust boundaries', () => {
  it('rejects string booleans rather than treating false text as verified identity', async () => {
    const dto = plainToInstance(CreateRecruitmentPostingDto, { requestId: '11111111-1111-4111-8111-111111111111',
      demandId: '11111111-1111-4111-8111-111111111112', channel: 'fictional', name: 'Synthetic job',
      url: 'https://example.invalid/job', verifiedIdentity: 'false', active: 'false' }, { enableImplicitConversion: true });
    const errors = await validate(dto);
    expect(errors.map(error => error.property)).toEqual(expect.arrayContaining(['verifiedIdentity', 'active']));
  });
  it('denies raw intake and posting readers without current editor capability', async () => {
    const db = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'viewer', status: 'active', sysRole: 'employee', hrCapabilities: ['recruitment_view'] }) } };
    const intake = new RecruitmentIntakesService(db as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const posting = new RecruitmentPostingsService(db as never, {} as never);
    await expect(intake.list({ page: 1, pageSize: 20 } as never, { id: 'viewer' } as never)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(posting.list({ page: 1, pageSize: 20 } as never, { id: 'viewer' } as never)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('does not fetch posting URLs and rejects non-https identities', () => {
    expect(() => RecruitmentPostingsService.normalizeUrl('http://example.invalid/job')).toThrow(BadRequestException);
    expect(() => RecruitmentPostingsService.normalizeUrl('https://user:password@example.invalid/job')).toThrow(BadRequestException);
    expect(RecruitmentPostingsService.normalizeUrl('https://example.invalid/job#hint')).toBe('https://example.invalid/job');
  });
  it('rejects clearing the required intake owner before attempting a database write', async () => {
    const service = new RecruitmentIntakesService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await expect((service as any).context({}, { ownerId: null })).rejects.toBeInstanceOf(BadRequestException);
  });
});
