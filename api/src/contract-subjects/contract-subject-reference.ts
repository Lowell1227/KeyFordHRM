import { isUUID } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { CompanyCode, type Prisma } from '@prisma/client';
import { ERROR_CODE } from '@/common/constants/error-codes';

type RecordValue = Record<string, unknown>;
type Client = Pick<Prisma.TransactionClient, 'contractSubject'>;

const subjectError = (message: string, field?: string) => new BadRequestException(field
  ? { code: ERROR_CODE.PARAM_INVALID, message, data: { fieldErrors: { [field]: message } } }
  : message);

/** New intake requires a selected company; draft text alone is not an established company. */
export function assertSubmittedEmployeeCompany(
  value: RecordValue, formalBase: RecordValue = {}, field = 'employee.contractSubjectId',
): void {
  if (value.contractSubjectId || Object.values(CompanyCode).includes(value.company as CompanyCode)) return;
  const historicalName = typeof formalBase.companyText === 'string' ? formalBase.companyText.trim() : '';
  if (!formalBase.contractSubjectId && historicalName
    && typeof value.companyText === 'string' && value.companyText.trim() === historicalName) return;
  throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请选择所属公司',
    data: { fieldErrors: { [field]: '请选择所属公司' } } });
}

/** Missing fields mean unchanged; a linked snapshot is never supplied by the caller. */
export async function normalizeContractSubject(
  client: Client, value: RecordValue, previous: RecordValue, nameField: string,
  companyBase: RecordValue = previous,
  field?: string,
): Promise<void> {
  if (nameField === 'companyText') {
    if (value.company === undefined && 'company' in companyBase) value.company = companyBase.company;
    const id = value.contractSubjectId === undefined ? previous.contractSubjectId : value.contractSubjectId;
    if (id == null && !previous.contractSubjectId && !companyBase.contractSubjectId) {
      if (value.company === undefined && 'company' in previous) value.company = previous.company;
      // Old records can contain a company name without a directory reference.
      const historical = nameField in previous ? previous : companyBase;
      if (value[nameField] === undefined && nameField in historical) value[nameField] = historical[nameField];
      if (value.contractSubjectId === null) return;
    }
    // Only formal employment is a company baseline; a saved draft is still a new selection.
    if (id && id === companyBase.contractSubjectId) {
      value.contractSubjectId = id;
      value[nameField] = companyBase[nameField] ?? null;
      if ('company' in companyBase) value.company = companyBase.company;
      return;
    }
    if (value.contractSubjectId === undefined && id) value.contractSubjectId = id;
  }
  if (value.contractSubjectId === undefined) {
    if (previous.contractSubjectId !== undefined) value.contractSubjectId = previous.contractSubjectId;
    if (previous.contractSubjectId) value[nameField] = previous[nameField] ?? null;
    return;
  }
  if (value.contractSubjectId === null) {
    value[nameField] = null;
    return;
  }
  if (typeof value.contractSubjectId !== 'string' || !isUUID(value.contractSubjectId)) {
    throw subjectError('合同主体信息无效，请重新选择', field);
  }
  const samePrevious = value.contractSubjectId === previous.contractSubjectId;
  if (samePrevious && nameField !== 'companyText') {
    value[nameField] = previous[nameField] ?? null;
    return;
  }
  const subject = await client.contractSubject.findUnique({ where: { id: value.contractSubjectId } });
  if (!subject?.isActive) throw subjectError('合同主体不存在或已停用，请重新选择', field);
  value[nameField] = samePrevious ? previous[nameField] ?? null : subject.name;
  // The directory reference is authoritative. Legacy organization codes are never inferred.
  if (nameField === 'companyText') value.company = null;
}

/** Approval validates new references but retains the name frozen on submission. */
export async function validateContractSubject(
  client: Client, value: RecordValue, base: RecordValue,
  nameField: 'companyText' | 'signingCompany' = 'signingCompany',
  field?: string,
): Promise<void> {
  if (nameField === 'companyText' && value.company != null
    && !Object.values(CompanyCode).includes(value.company as CompanyCode)) {
    throw new BadRequestException('所属公司资料无效，请重新选择');
  }
  const id = value.contractSubjectId;
  const selectsNewCompany = Boolean(id && id !== base.contractSubjectId);
  // Old review JSON without reference fields is reconciled against formal employment on apply.
  if (nameField === 'companyText' && !selectsNewCompany && base.company != null
    && value.company !== undefined && value.company !== base.company
    && (value.company === null || 'contractSubjectId' in base)) {
    throw new BadRequestException('请保留历史公司资料，或从公司目录重新选择所属公司');
  }
  if (id == null) return;
  if (id === base.contractSubjectId) {
    if (nameField === 'companyText' && 'company' in base && value.company !== base.company) {
      throw new BadRequestException('请保留历史公司资料，或从公司目录重新选择所属公司');
    }
    return;
  }
  if (typeof id !== 'string' || !isUUID(id)) throw subjectError('合同主体信息无效，请重新选择', field);
  const subject = await client.contractSubject.findUnique({ where: { id } });
  if (!subject?.isActive) throw subjectError('合同主体不存在或已停用，请重新选择', field);
}
