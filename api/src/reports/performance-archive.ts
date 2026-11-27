import { PerfGrade, Prisma } from '@prisma/client';

type ArchiveSource = {
  employeeId: string;
  employee?: { name: string } | null;
  dept?: { name: string } | null;
  gradeResult: { calculatedScore: Prisma.Decimal | null; rawGrade: PerfGrade | null;
    calibratedGrade: PerfGrade | null; coefficient: Prisma.Decimal | null } | null;
  indicatorInstances: Array<{ name: string; dimensionName: string | null; weight: Prisma.Decimal;
    indicatorType: string; targetValue: Prisma.Decimal | null; targetValueText: string | null;
    actualValue: Prisma.Decimal | null; selfScore: Prisma.Decimal | null;
    managerScore: Prisma.Decimal | null; finalScore: Prisma.Decimal | null }>;
};

export const ARCHIVE_INDICATORS = { where: { retiredAt: null }, select: {
  name: true, dimensionName: true, weight: true, indicatorType: true, targetValue: true, targetValueText: true,
  actualValue: true, selfScore: true, managerScore: true, finalScore: true,
} } as const;

/** One snapshot format for normal close-out and deletion of already final results. */
export function buildPerformanceArchive(task: ArchiveSource, cycleId: string, archivedAt: Date) {
  const grade = task.gradeResult?.calibratedGrade ?? task.gradeResult?.rawGrade;
  if (!grade) return null;
  return { employeeId: task.employeeId, cycleId, employeeName: task.employee?.name ?? '', deptName: task.dept?.name ?? null,
    grade, totalScore: task.gradeResult?.calculatedScore ?? new Prisma.Decimal(0), coefficient: task.gradeResult?.coefficient ?? null,
    archivedAt, summary: {
      indicators: task.indicatorInstances.map(ind => ({ name: ind.name, dimensionName: ind.dimensionName,
        weight: ind.weight.toNumber(), indicatorType: ind.indicatorType, targetValue: ind.targetValue?.toNumber() ?? null,
        targetValueText: ind.targetValueText, actualValue: ind.actualValue?.toNumber() ?? null,
        selfScore: ind.selfScore?.toNumber() ?? null, managerScore: ind.managerScore?.toNumber() ?? null, finalScore: ind.finalScore?.toNumber() ?? null })),
      calculatedScore: task.gradeResult?.calculatedScore?.toNumber() ?? null, rawGrade: task.gradeResult?.rawGrade ?? null,
      calibratedGrade: task.gradeResult?.calibratedGrade ?? null, coefficient: task.gradeResult?.coefficient?.toNumber() ?? null,
    } as Prisma.InputJsonValue };
}
