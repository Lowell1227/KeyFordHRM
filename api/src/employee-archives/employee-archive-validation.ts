import { BadRequestException } from '@nestjs/common';
import { CompanyCode, EmploymentType, UserStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength, validateSync } from 'class-validator';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { EmployeeCreateContractDto, EmployeeCreateDetailsDto, EmployeeCreateProfileDto,
  SubmitEmployeeArchiveDraftDto } from './dto/employee-archive.dto';

class ArchiveEmployeeFields extends EmployeeCreateDetailsDto {
  @IsOptional() @IsString() @MaxLength(50, { message: '最多填写 50 个字符' }) name?: string;
  @IsOptional() @IsString() @MaxLength(20, { message: '最多填写 20 个字符' }) phone?: string | null;
  @IsOptional() @IsEnum(CompanyCode) company?: CompanyCode;
  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType;
  @IsOptional() @IsEnum(UserStatus) employeeStatus?: UserStatus;
  @IsOptional() @IsString() deptId?: string | null;
  @IsOptional() @IsString() positionId?: string | null;
  @IsOptional() @IsString() managerId?: string | null;
  @IsOptional() @IsDateString({ strict: true, strictSeparator: true }) @MaxLength(10) entryDate?: string | null;
}

class ArchivePerformanceFields {
  @IsOptional() @IsString() managerId?: string | null;
}

type Fields = Record<string, unknown>;
const dateFields = new Set(['entryDate', 'plannedRegularDate', 'actualRegularDate', 'leaveDate',
  'birthDate', 'graduationDate', 'socialSecurityStartDate', 'housingFundStartDate', 'signedAt', 'effectiveFrom', 'expiresAt']);
const value = (item: unknown, key: string): unknown => {
  if (item == null) return null;
  if (typeof item === 'string') item = item.trim() || null;
  if (dateFields.has(key)) {
    if (item instanceof Date) return Number.isFinite(item.getTime()) ? item.toISOString().slice(0, 10) : item;
    if (typeof item === 'string' && /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/.test(item)) return item.slice(0, 10);
  }
  return item;
};

// Validate only supplied changes, using the creation DTO rules without implicit type coercion.
// Historical missing values are not new requirements; autosave does not call this helper.
export function normalizeArchiveSubmission(input: SubmitEmployeeArchiveDraftDto,
  base: { employee: Fields; profile: Fields; contracts: Fields[] }): SubmitEmployeeArchiveDraftDto {
  const fieldErrors: Record<string, string> = {};
  const check = (source: Fields, previous: Fields, Dto: new () => object, prefix: string, normalize = true) => {
    const output: Fields = {};
    const changed: Fields = {};
    for (const [key, raw] of Object.entries(source)) {
      if (raw === undefined) continue;
      const next = value(raw, key);
      const unchanged = next === value(previous[key], key);
      output[key] = normalize ? next : raw;
      // Keep untouched historical text and equivalent stored dates out of new changes.
      if (normalize && unchanged && previous[key] !== undefined
        && (raw === previous[key] || dateFields.has(key))) output[key] = previous[key];
      if (prefix.startsWith('contracts.') && ['images', 'attachments'].includes(key)) continue;
      if (!unchanged) changed[key] = next;
    }
    const dto = Object.assign(new Dto(), changed);
    for (const error of validateSync(dto, { whitelist: true, forbidUnknownValues: false })) {
      const constraints = error.constraints ?? {};
      fieldErrors[`${prefix}.${error.property}`] = constraints.isDateString ? '请填写有效的 YYYY-MM-DD 日历日期'
        : constraints.isString ? '请填写文字，不能使用数字或其他类型'
        : constraints.maxLength ? constraints.maxLength
        : constraints.isInt || constraints.min || constraints.max ? '请填写允许范围内的整数'
        : constraints.isUuid && error.property === 'contractSubjectId' ? '合同主体信息无效，请重新选择'
        : '字段格式无效，请核对后重新填写';
    }
    for (const key of Object.keys(changed)) {
      if (dateFields.has(key) && changed[key] != null
        && (typeof changed[key] !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(String(changed[key])))) {
        fieldErrors[`${prefix}.${key}`] = '请填写有效的 YYYY-MM-DD 日历日期';
      }
    }
    return output;
  };
  const employee = check(input.employee, base.employee, ArchiveEmployeeFields, 'employee');
  const profile = check(input.profile, base.profile, EmployeeCreateProfileDto, 'profile');
  const performance = input.performance ? check(input.performance, {}, ArchivePerformanceFields, 'performance') : undefined;
  for (const key of ['name', 'deptId', 'employmentType', 'employeeStatus', 'entryDate']) {
    if (key in employee && employee[key] == null && value(base.employee[key], key) != null) {
      fieldErrors[`employee.${key}`] = '此项已有资料，不能清空';
    }
  }
  input.contracts?.forEach((contract, index) => {
    // Contract row shape, date ranges and duplicate semantics remain in the contract validator.
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return;
    const previous = base.contracts.find(item => item.id && item.id === contract.id) ?? {};
    check(contract, previous, EmployeeCreateContractDto, `contracts.${index}`, false);
  });
  if (Object.keys(fieldErrors).length) {
    throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: Object.values(fieldErrors)[0], data: { fieldErrors } });
  }
  return { ...input, employee, profile, ...(performance ? { performance } : {}) };
}
