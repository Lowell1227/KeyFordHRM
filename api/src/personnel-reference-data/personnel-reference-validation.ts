import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { PERSONNEL_REFERENCE_RULES } from './personnel-reference-data.rules';

type Client = Pick<Prisma.TransactionClient, 'personnelReferenceData'>;
type Payload = { employee?: Record<string, unknown>; profile?: Record<string, unknown> };
export const PERSONNEL_REFERENCE_FIELDS = [
  ['employee', 'jobGrade', 'job_grade'],
  ['employee', 'jobFamily', 'job_family'],
  ['employee', 'workLocation', 'work_location'],
  ['profile', 'education', 'education'],
  ['profile', 'maritalStatus', 'marital_status'],
  ['profile', 'politicalStatus', 'political_status'],
  ['profile', 'householdType', 'household_type'],
  ['profile', 'emergencyContactRelation', 'contact_relation'],
] as const;
const comparable = (value: unknown) => typeof value === 'string' ? value.trim() || null : value ?? null;

/** Base is formal data only. IDs select values; names retain historical snapshots. */
async function resolveReferences(client: Client, value: Payload, base: Payload, snapshot: Payload = {}) {
  const errors: Record<string, string> = {};
  const changes: Array<{ target: Record<string, unknown>; field: string; id: string | null; name: unknown }> = [];
  const selections: Array<{ target: Record<string, unknown>; field: string; id: string; kind: typeof PERSONNEL_REFERENCE_FIELDS[number][2]; path: string }> = [];
  for (const [section, field, kind] of PERSONNEL_REFERENCE_FIELDS) {
    const target = value[section];
    const idField = `${field}Id`;
    if (!target || (!(field in target) && !(idField in target))) continue;
    const previous = base[section] ?? {};
    const previousId = comparable(previous[idField]);
    const previousName = comparable(previous[field]);
    const name = field in target ? comparable(target[field]) : previousName;
    const id = idField in target ? comparable(target[idField]) : previousId;
    if (id === previousId && name === previousName) {
      if (previousId != null && !(idField in target)) changes.push({ target, field, id: String(previousId), name: previous[field] ?? null });
      continue;
    }
    if ((idField in target && target[idField] === null && (!(field in target) || name == null || name === previousName))
      || (field in target && name == null && !(idField in target && id != null))) {
      changes.push({ target, field, id: null, name: null });
      continue;
    }
    const path = `${section}.${field}`;
    if (typeof id !== 'string' || !isUUID(id)) {
      errors[path] = `${PERSONNEL_REFERENCE_RULES[kind].label}请选择启用的基础资料选项；历史名称不会自动匹配`;
      continue;
    }
    selections.push({ target, field, id, kind, path });
  }
  if (selections.length) {
    const rows = await client.personnelReferenceData.findMany({
      where: { id: { in: [...new Set(selections.map(item => item.id))] } },
      select: { id: true, kind: true, name: true, isActive: true },
    });
    for (const { target, field, id, kind, path } of selections) {
      const row = rows.find(option => option.id === id && option.kind === kind && option.isActive);
      if (!row) errors[path] = `${PERSONNEL_REFERENCE_RULES[kind].label}不存在、类型不符或已停用，请重新选择`;
      else {
        const section = value.employee === target ? 'employee' : 'profile';
        const saved = snapshot[section];
        const keepName = saved?.[`${field}Id`] === id && typeof saved[field] === 'string'
          && (target[field] === undefined || comparable(target[field]) === comparable(saved[field]));
        changes.push({ target, field, id, name: keepName ? saved[field] : row.name });
      }
    }
  }
  return { errors, changes };
}

export async function personnelReferenceFieldErrors(client: Client, value: Payload, base: Payload = {}) {
  return (await resolveReferences(client, value, base)).errors;
}

export async function validatePersonnelReferences(client: Client, value: Payload, base: Payload = {}, snapshot: Payload = {}): Promise<void> {
  const { errors: fieldErrors, changes } = await resolveReferences(client, value, base, snapshot);
  if (Object.keys(fieldErrors).length) {
    throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: Object.values(fieldErrors)[0], data: { fieldErrors } });
  }
  for (const { target, field, id, name } of changes) Object.assign(target, { [`${field}Id`]: id, [field]: name });
}
