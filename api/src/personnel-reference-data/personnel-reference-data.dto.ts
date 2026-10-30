import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export enum PersonnelReferenceDataKind {
  work_location = 'work_location',
  job_family = 'job_family',
}

export class PersonnelReferenceDataQueryDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ obj, key }) =>
    obj[key] === 'true' ? true : obj[key] === 'false' ? false : obj[key],
  )
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreatePersonnelReferenceDataDto {
  @Transform(({ obj, key }) =>
    typeof obj[key] === 'string' ? obj[key].trim() : obj[key],
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
}

export class UpdatePersonnelReferenceDataDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ obj, key }) =>
    typeof obj[key] === 'string' ? obj[key].trim() : obj[key],
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  isActive?: boolean;
}
