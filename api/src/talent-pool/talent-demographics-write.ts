import { BadRequestException } from '@nestjs/common';

interface TalentDemographics {
  birthYear?: number | null;
  birthMonth?: number | null;
  reportedAge?: number | null;
  reportedAgeRecordedAt?: Date | null;
}

export function talentDemographicsWrite(input: TalentDemographics, before?: TalentDemographics, at = new Date()): {
  birthMonth?: number | null;
  reportedAge?: number | null;
  reportedAgeRecordedAt?: Date | null;
} {
  const year = input.birthYear === undefined ? before?.birthYear : input.birthYear;
  const month = input.birthMonth === undefined ? before?.birthMonth : input.birthMonth;
  if ((input.birthYear !== undefined || input.birthMonth !== undefined) && month != null
    && (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12)) {
    throw new BadRequestException('出生月份须为1至12，且须同时保留出生年份');
  }
  if (input.reportedAge != null && (!Number.isInteger(input.reportedAge) || input.reportedAge < 0 || input.reportedAge > 150)) {
    throw new BadRequestException('简历年龄须为0至150的整数');
  }
  return {
    ...(input.birthMonth !== undefined ? { birthMonth: input.birthMonth } : {}),
    ...(input.reportedAge !== undefined ? {
      reportedAge: input.reportedAge,
      reportedAgeRecordedAt: input.reportedAge === null ? null
        : before?.reportedAge === input.reportedAge ? before.reportedAgeRecordedAt ?? null : at,
    } : {}),
  };
}
