import { isUUID } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

type RecordValue = Record<string, unknown>;
type Client = Pick<Prisma.TransactionClient, 'contractSubject'>;

/** Missing fields mean unchanged; a linked snapshot is never supplied by the caller. */
export async function normalizeContractSubject(
  client: Client, value: RecordValue, previous: RecordValue, nameField: string,
  companyBase: RecordValue = previous,
): Promise<void> {
  if (nameField === 'companyText') {
    const id = value.contractSubjectId === undefined ? previous.contractSubjectId : value.contractSubjectId;
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
    throw new BadRequestException('合同主体信息无效，请重新选择');
  }
  const samePrevious = value.contractSubjectId === previous.contractSubjectId;
  if (samePrevious && nameField !== 'companyText') {
    value[nameField] = previous[nameField] ?? null;
    return;
  }
  const subject = await client.contractSubject.findUnique({ where: { id: value.contractSubjectId } });
  if (!subject?.isActive) throw new BadRequestException('合同主体不存在或已停用，请重新选择');
  value[nameField] = samePrevious ? previous[nameField] ?? null : subject.name;
  if (nameField === 'companyText') value.company = subject.internalCompany ?? null;
}

/** Approval validates new references but retains the name frozen on submission. */
export async function validateContractSubject(
  client: Client, value: RecordValue, base: RecordValue,
  nameField: 'companyText' | 'signingCompany' = 'signingCompany',
): Promise<void> {
  const id = value.contractSubjectId;
  if (id == null) return;
  if (id === base.contractSubjectId) {
    if (nameField === 'companyText' && 'company' in base && value.company !== base.company) {
      throw new BadRequestException('所属公司未变更，不能修改历史内部公司代码');
    }
    return;
  }
  if (typeof id !== 'string' || !isUUID(id)) throw new BadRequestException('合同主体信息无效，请重新选择');
  const subject = await client.contractSubject.findUnique({ where: { id } });
  if (!subject?.isActive) throw new BadRequestException('合同主体不存在或已停用，请重新选择');
  if (nameField === 'companyText') {
    if (!subject.internalCompany) throw new BadRequestException('所选公司尚未配置内部公司映射，请先维护合同主体目录');
    if (value.company !== subject.internalCompany) throw new BadRequestException('所选公司的内部公司映射已变化，请核对后重新提交');
  }
}
