import { BadRequestException } from '@nestjs/common';
import { talentDemographicsWrite } from './talent-demographics-write';

describe('explicit talent birth precision and resume age', () => {
  const at = new Date('2026-11-24T08:00:00Z');
  it('persists an explicitly provided month and age without deriving another birth fact', () => {
    expect(talentDemographicsWrite({ birthYear: 1998, birthMonth: 5, reportedAge: 28 }, undefined, at))
      .toEqual({ birthMonth: 5, reportedAge: 28, reportedAgeRecordedAt: at });
    expect(talentDemographicsWrite({ reportedAge: 28 }, undefined, at))
      .toEqual({ reportedAge: 28, reportedAgeRecordedAt: at });
  });
  it('does not overwrite omitted fields or refresh unchanged age evidence', () => {
    const recorded = new Date('2026-01-01T00:00:00Z');
    expect(talentDemographicsWrite({ reportedAge: 28 }, { reportedAge: 28, reportedAgeRecordedAt: recorded }, at))
      .toEqual({ reportedAge: 28, reportedAgeRecordedAt: recorded });
    expect(talentDemographicsWrite({}, { birthYear: 1998, birthMonth: 5, reportedAge: 28 }, at)).toEqual({});
  });
  it('rejects a month left behind by a partial birth-year clear', () => {
    expect(() => talentDemographicsWrite({ birthYear: null }, { birthYear: 1998, birthMonth: 5 }, at))
      .toThrow(BadRequestException);
    expect(talentDemographicsWrite({ birthYear: null, birthMonth: null }, { birthYear: 1998, birthMonth: 5 }, at))
      .toEqual({ birthMonth: null });
  });
  it.each([0, 13, 1.5])('rejects an invalid birth month %s', birthMonth => {
    expect(() => talentDemographicsWrite({ birthYear: 1998, birthMonth }, undefined, at)).toThrow(BadRequestException);
  });
  it('requires a year when a month is present', () => {
    expect(() => talentDemographicsWrite({ birthMonth: 5 }, undefined, at)).toThrow(BadRequestException);
  });
  it('clears age evidence together and accepts explicitly reported age zero', () => {
    expect(talentDemographicsWrite({ reportedAge: null }, { reportedAge: 28 }, at))
      .toEqual({ reportedAge: null, reportedAgeRecordedAt: null });
    expect(talentDemographicsWrite({ reportedAge: 0 }, undefined, at))
      .toEqual({ reportedAge: 0, reportedAgeRecordedAt: at });
  });
});
