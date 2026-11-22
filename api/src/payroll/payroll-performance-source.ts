import { createHash } from 'node:crypto';
import type { PerfGrade, TaskStatus } from '@prisma/client';
import type { PrismaService } from '@/prisma/prisma.service';
import { isResultPublished } from '@/tasks/result-publication';

export type PayrollPerformanceSource =
  | Readonly<{ status: 'ready'; snapshot: Readonly<{
      employeeId: string; taskId: string; cycleId: string; grade: PerfGrade; publishedAt: string; version: string;
    }> }>
  | Readonly<{ status: 'unregistered' | 'not_applicable' | 'pending_publication' | 'in_review' | 'fact_conflict' | 'not_found' }>;

/** The caller enforces salary access and approved employment/month scope, including historical dues. */
export async function readPayrollPerformance(
  prisma: Pick<PrismaService, 'assessmentTask'>,
  input: { employeeId: string; cycleId: string; registeredCycleIds: string[] },
): Promise<PayrollPerformanceSource> {
  if (!input.registeredCycleIds.includes(input.cycleId)) return Object.freeze({ status: 'unregistered' });

  const task = await prisma.assessmentTask.findUnique({
    where: { cycleId_employeeId: { employeeId: input.employeeId, cycleId: input.cycleId } },
    select: {
      id: true, employeeId: true, cycleId: true, status: true,
      isExempt: true, participantDisposition: true, publishedAt: true,
      cycle: { select: { type: true } },
      gradeResult: { select: {
        id: true, calibratedGrade: true, rawGrade: true,
        isPublished: true, publishedAt: true, hrCalibratedAt: true, approvedAt: true,
      } },
      appeals: { select: { id: true, status: true, finalResult: true, updatedAt: true }, orderBy: { id: 'asc' } },
    },
  });
  if (!task) return Object.freeze({ status: 'not_found' });
  if (task.cycle.type === 'probation' || task.isExempt || task.status === 'exempted'
    || task.participantDisposition !== 'active') {
    return Object.freeze({ status: 'not_applicable' });
  }
  // Workflow appeals block pay; the independent HR appeal ledger does not alter result facts.
  if (task.status === 'appealing' || task.appeals.some(appeal => appeal.status !== 'resolved')) {
    return Object.freeze({ status: 'in_review' });
  }
  if (!isResultPublished(task)) {
    const reviewing: TaskStatus[] = ['manager_scoring', 'dept_review', 'hr_calibration', 'approval'];
    return Object.freeze({ status: reviewing.includes(task.status) ? 'in_review' : 'pending_publication' });
  }

  const result = task.gradeResult;
  const grade = result?.calibratedGrade ?? result?.rawGrade;
  const publishedStatuses: TaskStatus[] = ['published', 'confirmed', 'closed'];
  // Salary requires corroborating individual facts, not the UI's permissive legacy visibility rule.
  if (!publishedStatuses.includes(task.status) || !result?.isPublished || !grade
    || !task.publishedAt || !result.publishedAt || task.publishedAt.getTime() !== result.publishedAt.getTime()) {
    return Object.freeze({ status: 'fact_conflict' });
  }

  const snapshot = {
    employeeId: task.employeeId, taskId: task.id, cycleId: task.cycleId,
    grade, publishedAt: result.publishedAt.toISOString(),
  };
  const version = createHash('sha256').update(JSON.stringify({
    ...snapshot,
    taskPublishedAt: task.publishedAt.toISOString(),
    gradeResult: {
      id: result.id, calibratedGrade: result.calibratedGrade, rawGrade: result.rawGrade,
      isPublished: result.isPublished, publishedAt: result.publishedAt.toISOString(),
      // Confirmation/closure and the generic updatedAt do not revise the payable result.
      hrCalibratedAt: result.hrCalibratedAt?.toISOString() ?? null,
      approvedAt: result.approvedAt?.toISOString() ?? null,
    },
    appeals: [...task.appeals].sort((a, b) => a.id.localeCompare(b.id)).map(appeal => ({
      id: appeal.id, status: appeal.status, finalResult: appeal.finalResult, updatedAt: appeal.updatedAt.toISOString(),
    })),
  })).digest('hex');
  return Object.freeze({ status: 'ready', snapshot: Object.freeze({ ...snapshot, version }) });
}
