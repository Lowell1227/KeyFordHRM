export interface DemandSeatValues {
  acceptedCount?: number;
  hiredCount?: number;
  remainingCount?: number | null;
  overCount?: number | null;
}

function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function describeDemandSeats(value: DemandSeatValues | null | undefined) {
  return {
    accepted: validCount(value?.acceptedCount) ? String(value.acceptedCount) : '—',
    hired: validCount(value?.hiredCount) ? String(value.hiredCount) : '—',
    remaining: value?.remainingCount === null ? '待核对' : validCount(value?.remainingCount) ? String(value.remainingCount) : '—',
    over: validCount(value?.overCount) ? value.overCount : null,
  };
}
