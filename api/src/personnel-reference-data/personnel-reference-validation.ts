import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { PERSONNEL_REFERENCE_RULES } from './personnel-reference-data.rules';

type Client = Pick<Prisma.TransactionClient, 'personnelReferenceData'>;
type Payload = { employee?: Record<string, unknown>; profile?: Record<string, unknown> };
const fields = [
  ['employee', 'jobGrade', 'job_grade'],
  ['profile', 'education', 'education'],
  ['profile', 'maritalStatus', 'marital_status'],
  ['profile', 'politicalStatus', 'political_status'],
  ['profile', 'householdType', 'household_type'],
  ['profile', 'emergencyContactRelation', 'contact_relation'],
] as const;
const comparable = (value: unknown) => typeof value === 'string' ? value.trim() || null : value ?? null;

/** Base must be formal data, never a saved draft. Empty fields keep their existing requiredness. */
export async function personnelReferenceFieldErrors(client: Client, value: Payload, base: Payload = {}) {
  const errors: Record<string, string> = {};
  const selections: { kind: typeof fields[number][2]; name: string; path: string }[] = [];
  for (const [section, field, kind] of fields) {
    const next = comparable(value[section]?.[field]);
    if (next == null || next === comparable(base[section]?.[field])) continue;
    const path = `${section}.${field}`;
    const { label, maxLength } = PERSONNEL_REFERENCE_RULES[kind];
    if (typeof next !== 'string' || [...next].length > maxLength) {
      errors[path] = `${label}须为不超过${maxLength}字的文字`;
    } else {
      selections.push({ kind, name: next, path });
    }
  }
  if (selections.length) {
    const enabled = await client.personnelReferenceData.findMany({
      where: { isActive: true, OR: selections.map(({ kind, name }) => ({ kind, name })) },
      select: { kind: true, name: true },
    });
    for (const { kind, name, path } of selections) {
      if (!enabled.some(option => option.kind === kind && option.name === name)) {
        errors[path] = `${PERSONNEL_REFERENCE_RULES[kind].label}请选择启用的基础资料选项；未维护时请先维护基础资料`;
      }
    }
  }
  return errors;
}

export async function validatePersonnelReferences(client: Client, value: Payload, base: Payload = {}): Promise<void> {
  const fieldErrors = await personnelReferenceFieldErrors(client, value, base);
  if (Object.keys(fieldErrors).length) {
    throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: Object.values(fieldErrors)[0], data: { fieldErrors } });
  }
}
