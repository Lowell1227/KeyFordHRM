import { formatEmployeeContractDate } from '@/utils/employee-contract-status';

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
