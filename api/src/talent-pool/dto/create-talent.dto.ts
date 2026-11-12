import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional,
  IsString, IsUUID, Matches, Max, MaxLength, Min,
} from 'class-validator';
import {
  EDUCATION_OPTIONS, TALENT_GENDERS, TALENT_SOURCE_CHANNELS, TALENT_STATUSES, TALENT_TAGS,
} from '../talent.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTalentDto {
  @Transform(trim)
  @IsString() @IsNotEmpty({ message: '请填写姓名' }) @MaxLength(50)
  name!: string;

  @Transform(trim)
  @Matches(/^1\d{10}$/, { message: '手机号须为 11 位数字' })
  phone!: string;

  @IsOptional()
  @Transform(trim)
  @IsEmail({}, { message: '邮箱格式不正确' })
  @MaxLength(100)
  email?: string;

  @IsOptional()
  @IsIn(TALENT_GENDERS as readonly string[])
  gender?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900) @Max(2100)
  birthYear?: number;

  @IsOptional()
  @Transform(trim)
  @IsString() @MaxLength(150)
  currentCompany?: string;

  @IsOptional()
  @Transform(trim)
  @IsString() @MaxLength(100)
  currentPosition?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt() @Min(0) @Max(60)
  yearsOfExperience?: number;

  @IsOptional()
  @IsIn(EDUCATION_OPTIONS as readonly string[])
  education?: string;

  @IsOptional()
  @Transform(trim)
  @IsString() @MaxLength(200)
  school?: string;

  @IsOptional()
  @Transform(trim)
  @IsString() @MaxLength(150)
  major?: string;

  @IsOptional()
  @Transform(trim)
  @IsString() @MaxLength(100)
  expectCity?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt() @Min(0)
  expectSalaryMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt() @Min(0)
  expectSalaryMax?: number;

  @IsIn(TALENT_SOURCE_CHANNELS as readonly string[], { message: '来源渠道无效' })
  sourceChannel!: string;

  @IsOptional()
  @Transform(trim)
  @IsString() @MaxLength(100)
  appliedPosition?: string;

  @IsOptional()
  @IsIn(TALENT_STATUSES as readonly string[], { message: '状态无效' })
  status?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5, { message: '标签最多 5 个' })
  @IsString({ each: true })
  @IsIn(TALENT_TAGS as readonly string[], { each: true, message: '存在无效标签' })
  tags?: string[];

  @IsOptional()
  @Transform(trim)
  @IsString() @MaxLength(500, { message: '备注不能超过 500 字' })
  note?: string;

  /** 编辑时标记「已入职」必填：对应员工 ID（新建时不允许直接传入）。 */
  @IsOptional()
  @IsUUID('all')
  userId?: string;
}
