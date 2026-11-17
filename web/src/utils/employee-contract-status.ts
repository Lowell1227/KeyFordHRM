export type ContractDates = {
  isActive?: boolean;
  recordState?: string;
  contractType?: string | null;
  effectiveFrom?: string | null;
  expiresAt?: string | null;
  termType?: string | null;
};
export type ContractStatus = {
  key: 'upcoming' | 'within_term' | 'expired' | 'needs_review' | 'retained';
  label: string;
  type: 'info' | 'success' | 'warning' | 'danger';
  reason?: string;
};

export function contractCalendarDate(value?: string | null): string | null {
  if (!value) return null;
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
  const date = value.slice(0, 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date && Number.isFinite(Date.parse(value)) ? date : null;
}

export function formatEmployeeContractDate(value?: string | null): string {
  return contractCalendarDate(value) ?? '-';
}

export function employeeContractStatus(contract: ContractDates, now = new Date()): ContractStatus {
  if (contract.isActive === false) return {
    key: 'retained', label: contract.recordState === 'removed' ? '已删除' : '历史保留记录', type: 'info',
  };
  const review = (reason: string): ContractStatus => ({ key: 'needs_review', label: '待核实', type: 'warning', reason });
  const start = contractCalendarDate(contract.effectiveFrom), end = contractCalendarDate(contract.expiresAt);
  if ((contract.effectiveFrom && !start) || (contract.expiresAt && !end)) return review('日期格式或日历日期有误，请核对');
  if (start && end && start > end) return review('到期日期早于生效日期，请核对');
  if (!start) return review('生效日期待补充');
  const openEnded = Boolean(contract.termType?.includes('无固定期限'));
  if (openEnded && end) return review('无固定期限合同填写了到期日期，请核对');
  if (!end && !openEnded) return review('到期日期待补充，或选择无固定期限');
  if (contract.contractType === 'unclassified') return review('合同类型待核实');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  if (end && end < today) return { key: 'expired', label: '已到期', type: 'info' };
  if (start > today) return { key: 'upcoming', label: '待生效', type: 'info' };
  return { key: 'within_term', label: '期限内', type: 'success' };
}
