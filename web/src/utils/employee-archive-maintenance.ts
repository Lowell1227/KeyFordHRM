import type { EmployeeArchiveIssue } from '@/api/employee-archives.api';

export function archiveMaintenanceHint(issues: EmployeeArchiveIssue[], field: string, contractId?: string): string {
  const messages = issues.filter(i => i.origin === 'current' && (i.fields ?? [i.field]).includes(field)
    && (field !== 'contracts' || !contractId || i.contractIds?.includes(contractId))).map(i => i.message);
  return [...new Set(messages)].join('；');
}
