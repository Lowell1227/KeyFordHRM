type JsonRecord = Record<string, unknown>;
type ContractRecord = { id: string; isActive?: boolean; endedAt?: Date | string | null };
export type ContractRecordMetadata = {
  recordState: 'active' | 'removed' | 'retained';
  recordStateAt?: string;
  recordStateLabel?: string;
};

const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value)
  ? value as JsonRecord : {};
const timestamp = (value: unknown): number | null => {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};
function contractIds(value: unknown): Set<string> | null {
  const contracts = record(value).contracts;
  if (!Array.isArray(contracts) || contracts.some(item => !item || typeof item !== 'object' || Array.isArray(item))) return null;
  return new Set(contracts.flatMap(item => typeof item.id === 'string' && item.id ? [item.id] : []));
}

/** Record provenance is separate from contract dates. Unknown inactive rows are not terminations. */
export function withContractRecordStates<T extends ContractRecord>(contracts: readonly T[], changes: readonly unknown[]): Array<T & ContractRecordMetadata> {
  const snapshots = changes.flatMap(value => {
    const change = record(value);
    const at = timestamp(change.appliedAt);
    if (change.sourceType !== 'manual_archive_change' || change.sourceSystem === 'archive_assistant_pilot'
      || !['submitted', 'archived'].includes(String(change.recordStatus))
      || change.profileReviewStatus !== 'approved' || change.cancelledAt || at === null) return [];
    const before = contractIds(change.baseValue), after = contractIds(change.proposedValue);
    return before && after ? [{ at, before, after }] : [];
  }).sort((left, right) => right.at - left.at);

  return contracts.map(contract => {
    if (contract.isActive !== false) return { ...contract, recordState: 'active' };
    const snapshot = snapshots.find(item => item.before.has(contract.id) || item.after.has(contract.id));
    const stoppedAt = timestamp(contract.endedAt);
    if (snapshot && snapshot.before.has(contract.id) && !snapshot.after.has(contract.id)
      && !snapshots.some(item => item.at === snapshot.at && item.after.has(contract.id))
      && (stoppedAt === null || stoppedAt <= snapshot.at)) {
      return { ...contract, recordState: 'removed', recordStateLabel: '已移除', recordStateAt: new Date(snapshot.at).toISOString() };
    }
    return { ...contract, recordState: 'retained', recordStateLabel: '历史留存' };
  });
}
