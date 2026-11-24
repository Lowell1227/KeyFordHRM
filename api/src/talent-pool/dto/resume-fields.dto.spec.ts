import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateTalentDto } from './create-talent.dto';
import { UpdateTalentDto } from './update-talent.dto';

const options = { whitelist: true, forbidNonWhitelisted: true };
const base = { name: '虚构候选人', phone: '17000000000', sourceChannel: 'referral' };

describe('resume personal fields DTO', () => {
  it.each([
    { birthYear: 1998, birthMonth: 5, reportedAge: 28, gender: 'female' },
    { birthYear: 1998 }, { reportedAge: 28 },
    { birthYear: null, birthMonth: null, reportedAge: null },
  ])('allows optional explicit personal fields and clearing them: %j', fields => {
    expect(validateSync(plainToInstance(CreateTalentDto, { ...base, ...fields }), options)).toEqual([]);
    expect(validateSync(plainToInstance(UpdateTalentDto, fields), options)).toEqual([]);
  });

  it.each([
    { birthMonth: 5 }, { birthYear: null, birthMonth: 5 },
    { birthYear: 1998, birthMonth: 0 }, { birthYear: 1998, birthMonth: 13 },
    { birthYear: 1998, birthMonth: 2.5 }, { reportedAge: -1 }, { reportedAge: 151 },
    { reportedAge: 28.5 }, { reportedAgeRecordedAt: '2026-11-24T00:00:00Z' },
  ])('rejects unpaired months, invalid numbers and client-provided recording time: %j', fields => {
    expect(validateSync(plainToInstance(CreateTalentDto, { ...base, ...fields }), options).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(UpdateTalentDto, fields), options).length).toBeGreaterThan(0);
  });
});
