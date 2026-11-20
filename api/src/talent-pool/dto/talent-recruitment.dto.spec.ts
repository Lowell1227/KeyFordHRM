import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateTalentApplicationDto, ReturnTalentInterviewFeedbackDto, SaveTalentInterviewFeedbackDto, TalentApplicationActionDto, TalentOwnerQueryDto, UpdateTalentApplicationDto } from './talent-recruitment.dto';

describe('recruitment DTO contract', () => {
  it('allows optional standard reserve reasons and rejects unknown, duplicate, non-array and oversized inputs', () => {
    const options = { whitelist: true, forbidNonWhitelisted: true };
    const body = { expectedRevision: 0, action: 'reserve' };
    for (const reserveReasons of [undefined, [], ['other'], ['commute_distance', 'salary_expectation', 'work_schedule', 'other']]) {
      expect(validateSync(plainToInstance(TalentApplicationActionDto, { ...body, ...(reserveReasons === undefined ? {} : { reserveReasons }) }), options)).toEqual([]);
    }
    for (const reserveReasons of [['unknown'], ['other', 'other'], 'other', ['other', 'other', 'other', 'other', 'other']]) {
      expect(validateSync(plainToInstance(TalentApplicationActionDto, { ...body, reserveReasons }), options).some(error => error.property === 'reserveReasons')).toBe(true);
    }
  });
  it('accepts initial application revision zero and forbids manual hired/onboarding actions', () => {
    expect(validateSync(plainToInstance(TalentApplicationActionDto, { expectedRevision: 0, action: 'start_interview' }))).toEqual([]);
    for (const action of ['hired', 'onboarding', 'other']) expect(validateSync(plainToInstance(TalentApplicationActionDto, { expectedRevision: 0, action }))).not.toEqual([]);
    expect(validateSync(plainToInstance(UpdateTalentApplicationDto, { expectedRevision: 0, recruitmentBatch: null, expectedEntryDate: null }))).toEqual([]);
  });
  it('accepts partial drafts but requires explicit boolean submit and valid outcome', () => {
    expect(validateSync(plainToInstance(SaveTalentInterviewFeedbackDto, { interviewVersion: 1, expectedRevision: 0, submit: false }))).toEqual([]);
    expect(validateSync(plainToInstance(SaveTalentInterviewFeedbackDto, { interviewVersion: 1, expectedRevision: 0, submit: 'false' }))).not.toEqual([]);
    expect(validateSync(plainToInstance(SaveTalentInterviewFeedbackDto, { interviewVersion: 1, expectedRevision: 0, submit: true, outcome: 'approved' }))).not.toEqual([]);
  });
  it('validates date-only input, lengths, mandatory return note, and bounded pagination', () => {
    expect(validateSync(plainToInstance(CreateTalentApplicationDto, { positionName: 'Synthetic position', expectedEntryDate: '2026-02-30' }))).not.toEqual([]);
    expect(validateSync(plainToInstance(CreateTalentApplicationDto, { positionName: 'Synthetic position', expectedEntryDate: '2026-12-01T10:00:00Z' }))).not.toEqual([]);
    expect(validateSync(plainToInstance(ReturnTalentInterviewFeedbackDto, { interviewVersion: 1, expectedRevision: 1, note: '' }))).not.toEqual([]);
    const query = plainToInstance(TalentOwnerQueryDto, { page: '2', pageSize: '10', keyword: '  Synthetic  ' });
    expect(validateSync(query)).toEqual([]);
    expect(query).toMatchObject({ page: 2, pageSize: 10, keyword: 'Synthetic' });
    expect(validateSync(plainToInstance(TalentOwnerQueryDto, { pageSize: 101 }))).not.toEqual([]);
  });
});
