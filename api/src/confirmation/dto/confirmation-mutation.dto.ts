import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class ConfirmationMutationDto {
  @IsOptional()
  @Transform(({ obj, key }) => {
    const value = obj[key];
    return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : value;
  })
  @IsInt()
  @Min(0)
  submissionVersion?: number;
}
