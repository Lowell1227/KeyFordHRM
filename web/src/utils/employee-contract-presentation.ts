import { contractCalendarDate, employeeContractStatus, formatEmployeeContractDate } from '@/utils/employee-contract-status';

type ContractPresentation = Record<string, unknown>;

const typeLabels: Record<string, string> = {
  contract: '劳动合同', renewal: '续签合同', transfer: '转签合同',
  attachment: '附件', unclassified: '待分类合同', confidentiality: '保密协议',
};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const date = (value: unknown) => formatEmployeeContractDate(text(value));

export function contractTitle(contract: ContractPresentation): string {
  const type = text(contract.contractType) || text(contract.kind);
  const title = text(contract.name) || typeLabels[type] || type || '合同';
  const signed = date(contract.signedAt);
  const effective = date(contract.effectiveFrom);
  return `${title} · ${signed !== '-' ? `${signed} 签订` : effective !== '-' ? `${effective} 生效` : '日期待补充'}`;
}

export function sortContractsLatestFirst<T extends ContractPresentation>(contracts: readonly T[]): T[] {
  const businessDate = (contract: T) => date(contract.effectiveFrom) !== '-' ? date(contract.effectiveFrom) : date(contract.signedAt);
  const createdAt = (contract: T) => Date.parse(text(contract.createdAt)) || 0;
  return [...contracts].sort((left, right) => Number(date(right.effectiveFrom) !== '-') - Number(date(left.effectiveFrom) !== '-')
    || businessDate(right).localeCompare(businessDate(left))
    || createdAt(right) - createdAt(left) || text(right.id).localeCompare(text(left.id)));
}

export function selectEmployeeContracts<T extends ContractPresentation>(contracts: readonly T[]) {
  const sorted = sortContractsLatestFirst(contracts);
  const current = sorted.find(contract => contract.isActive !== false
    && ['contract', 'renewal', 'transfer'].includes(text(contract.contractType) || text(contract.kind))) ?? null;
  return { current, history: sorted.filter(contract => contract !== current) };
}

/** Display every record by its dates; latest-record export selection remains a separate concept. */
export function groupEmployeeContracts<T extends ContractPresentation>(contracts: readonly T[], now = new Date()) {
  const groups: { withinTerm: T[]; upcoming: T[]; needsReview: T[]; history: T[]; retained: T[] } = {
    withinTerm: [], upcoming: [], needsReview: [], history: [], retained: [],
  };
  const keys = { within_term: 'withinTerm', upcoming: 'upcoming', needs_review: 'needsReview', expired: 'history', retained: 'retained' } as const;
  for (const contract of sortContractsLatestFirst(contracts)) {
    const status = employeeContractStatus({
      isActive: contract.isActive === false ? false : true,
      recordState: text(contract.recordState), contractType: text(contract.contractType) || text(contract.kind),
      effectiveFrom: text(contract.effectiveFrom), expiresAt: text(contract.expiresAt), termType: text(contract.termType),
    }, now);
    groups[keys[status.key]].push(contract);
  }
  return groups;
}

/** A date-range overlap is advisory. It never ends or replaces either stored contract. */
export function overlappingContractIds<T extends ContractPresentation>(contracts: readonly T[]): Set<string> {
  const intervals = contracts.flatMap(contract => {
    const id = text(contract.id) || text(contract.__key);
    const kind = text(contract.contractType) || text(contract.kind);
    const start = contractCalendarDate(text(contract.effectiveFrom));
    const end = contractCalendarDate(text(contract.expiresAt));
    const openEnded = text(contract.termType).includes('无固定期限');
    if (!id || contract.isActive === false || contract.__removed === true || !start
      || (kind && !['contract', 'renewal', 'transfer'].includes(kind))
      || (contract.expiresAt && !end) || (end && (end < start || openEnded)) || (!end && !openEnded)) return [];
    return [{ id, start, end: end ?? '9999-12-31' }];
  });
  const overlapping = new Set<string>();
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const a = intervals[i]!, b = intervals[j]!;
      if (a.start <= b.end && b.start <= a.end) { overlapping.add(a.id); overlapping.add(b.id); }
    }
  }
  return overlapping;
}
