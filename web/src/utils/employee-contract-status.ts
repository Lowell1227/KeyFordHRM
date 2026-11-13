type ContractDates = {
  isActive?: boolean;
  effectiveFrom?: string | null;
  expiresAt?: string | null;
  termType?: string | null;
};
type ContractStatus = { label: string; type: 'info' | 'success' | 'warning' | 'danger' };

function calendarDate(value?: string | null): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
  const date = value.slice(0, 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date && Number.isFinite(Date.parse(value)) ? date : null;
}

export function formatEmployeeContractDate(value?: string | null): string {
  return calendarDate(value) ?? '-';
}

export function employeeContractStatus(contract: ContractDates, now = new Date()): ContractStatus {
  if (contract.isActive === false) return { label: '旧版本/已移除', type: 'info' };
  const start = calendarDate(contract.effectiveFrom), end = calendarDate(contract.expiresAt);
  if ((contract.effectiveFrom && !start) || (contract.expiresAt && !end) || (start && end && start > end)) {
    return { label: '日期待核', type: 'warning' };
  }
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  if (end && end < today) return { label: '已到期', type: 'danger' };
  if (start && start > today) return { label: '待生效', type: 'info' };
  if (!start) return { label: '期限待补', type: 'warning' };
  if (end) return { label: '正常', type: 'success' };
  if (contract.termType?.includes('无固定期限')) return { label: '无固定期限', type: 'info' };
  return { label: '期限待补', type: 'warning' };
}
