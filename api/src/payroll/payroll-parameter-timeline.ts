import { ConflictException } from '@nestjs/common';

export interface PayrollParameterLink { parameterId: string; previousParameterId: string | null }

/** Expired successors still shadow their ancestors; a previous salary must never silently resume. */
export function effectivePayrollParameters<T extends { id: string; effectiveFrom: Date; effectiveTo: Date | null }>(
  rows: T[], releases: PayrollParameterLink[], at: Date,
): T[] {
  const links = new Map<string, string | null>();
  for (const row of releases) {
    if (links.has(row.parameterId) && links.get(row.parameterId) !== row.previousParameterId) throw new ConflictException('参数版本继承关系不一致');
    links.set(row.parameterId, row.previousParameterId);
  }
  const candidates = rows.filter(row => row.effectiveFrom <= at), shadowed = new Set<string>();
  for (const row of candidates) {
    const seen = new Set([row.id]);
    let previous = links.get(row.id);
    while (previous) {
      if (seen.has(previous)) throw new ConflictException('参数版本继承关系存在循环');
      seen.add(previous); shadowed.add(previous); previous = links.get(previous);
    }
  }
  return candidates.filter(row => !shadowed.has(row.id) && (!row.effectiveTo || row.effectiveTo >= at));
}
