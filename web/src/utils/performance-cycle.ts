import type { AssessmentCycle } from '@/types/api.types';

export interface PerformanceCycleResolution {
  orderedCycles: AssessmentCycle[];
  selectedCycle: AssessmentCycle | null;
  requestedCycleIsValid: boolean;
}

export function localDateKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year
    && parsed.getMonth() === month - 1
    && parsed.getDate() === day
    ? value
    : null;
}

function cycleGroup(
  startDate: string | null,
  endDate: string | null,
  today: string,
): number {
  if (startDate && endDate && startDate <= today && today <= endDate) return 0;
  if (endDate && endDate < today) return 1;
  if (startDate && startDate > today) return 2;
  return 3;
}

export function orderPerformanceCycles(
  cycles: AssessmentCycle[],
  today = localDateKey(),
): AssessmentCycle[] {
  const originalIndex = new Map(cycles.map((item, index) => [item.id, index]));

  return [...cycles].sort((left, right) => {
    const leftStart = validDate(left.startDate);
    const leftEnd = validDate(left.endDate);
    const rightStart = validDate(right.startDate);
    const rightEnd = validDate(right.endDate);
    const leftGroup = cycleGroup(leftStart, leftEnd, today);
    const rightGroup = cycleGroup(rightStart, rightEnd, today);

    if (leftGroup !== rightGroup) return leftGroup - rightGroup;
    if (leftGroup === 0) {
      return String(rightStart).localeCompare(String(leftStart))
        || String(rightEnd).localeCompare(String(leftEnd));
    }
    if (leftGroup === 1) return String(rightEnd).localeCompare(String(leftEnd));
    if (leftGroup === 2) return String(leftStart).localeCompare(String(rightStart));
    return (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0);
  });
}

export function resolvePerformanceCycle(
  cycles: AssessmentCycle[],
  requestedCycleId?: string,
  today = localDateKey(),
): PerformanceCycleResolution {
  const orderedCycles = orderPerformanceCycles(cycles, today);
  const requestedCycle = requestedCycleId
    ? cycles.find((item) => item.id === requestedCycleId) ?? null
    : null;

  return {
    orderedCycles,
    selectedCycle: requestedCycle ?? orderedCycles[0] ?? null,
    requestedCycleIsValid: Boolean(requestedCycle),
  };
}

function compactDate(value: string): string {
  const [, month = '', day = ''] = value.slice(0, 10).split('-');
  return `${month}/${day}`;
}

export function formatPerformanceCycleOption(cycle: AssessmentCycle): string {
  const mode = cycle.scoringFrequency === 'monthly' ? '月度自评' : '整周期自评';
  const participation = cycle.personalTask
    ? cycle.personalTask.isExempt ? '已豁免' : '正常参与'
    : '团队周期';
  return `${cycle.name}｜${compactDate(cycle.startDate)}-${compactDate(cycle.endDate)}｜${mode}｜${participation}`;
}
