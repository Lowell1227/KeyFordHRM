import { isUUID } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

type RecordValue = Record<string, unknown>;
type Client = Pick<Prisma.TransactionClient, 'contractSubject'>;

/** Missing fields mean unchanged; a linked snapshot is never supplied by the caller. */
export async function normalizeContractSubject(
  client: Client, value: RecordValue, previous: RecordValue, nameField: string,
): Promise<void> {
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
  if (value.contractSubjectId === previous.contractSubjectId) {
    value[nameField] = previous[nameField] ?? null;
    return;
  }
  const subject = await client.contractSubject.findUnique({ where: { id: value.contractSubjectId } });
  if (!subject?.isActive) throw new BadRequestException('合同主体不存在或已停用，请重新选择');
  value[nameField] = subject.name;
}

/** Approval validates new references but retains the name frozen on submission. */
export async function validateContractSubject(
  client: Client, value: RecordValue, base: RecordValue,
): Promise<void> {
  const id = value.contractSubjectId;
  if (id == null || id === base.contractSubjectId) return;
  if (typeof id !== 'string' || !isUUID(id)) throw new BadRequestException('合同主体信息无效，请重新选择');
  const subject = await client.contractSubject.findUnique({ where: { id } });
  if (!subject?.isActive) throw new BadRequestException('合同主体不存在或已停用，请重新选择');
}
