import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ERROR_CODE } from '@/common/constants/error-codes';

const text = (value: unknown) => typeof value === 'string' ? value.trim() || null : null;
export function requireEmployeePosition(value: unknown): void {
  if (text(value)) return;
  throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请选择启用的岗位',
    data: { fieldErrors: { 'employee.positionId': '请选择启用的岗位；历史岗位名称不能作为新岗位提交' } } });
}

/** Returns the formal reference baseline, including a selected position's legacy family snapshot. */
export async function normalizeEmployeePosition(client: Pick<Prisma.TransactionClient, 'position'>,
  employee: Record<string, unknown>, previous: Record<string, unknown> = {}, required = false,
  snapshot: Record<string, unknown> = {}) {
  const id = 'positionId' in employee ? text(employee.positionId) : text(previous.positionId);
  const samePosition = id === text(previous.positionId);
  const unchanged = (field: string) => employee[field] === undefined || text(employee[field]) === text(previous[field]);
  if (!id) {
    if (required || !samePosition || !unchanged('position')) requireEmployeePosition(null);
    employee.positionId = null;
    if (employee.position === undefined) employee.position = previous.position ?? null;
    if (employee.jobFamily === undefined) employee.jobFamily = previous.jobFamily ?? null;
    if (employee.jobFamilyId === undefined) employee.jobFamilyId = previous.jobFamilyId ?? null;
    return previous;
  }
  const position = await client.position.findUnique({ where: { id },
    select: { id: true, name: true, jobFamily: true, jobFamilyId: true, isActive: true } });
  if (!position || (!position.isActive && (!samePosition || !unchanged('position') || !unchanged('jobFamily') || !unchanged('jobFamilyId')))) {
    throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '岗位不存在或已停用',
      data: { fieldErrors: { 'employee.positionId': '岗位不存在或已停用，请重新选择' } } });
  }
  const submitted = id === text(snapshot.positionId);
  const keepSubmittedPosition = submitted && typeof snapshot.position === 'string'
    && (employee.position === undefined || text(employee.position) === text(snapshot.position));
  const keepSubmittedFamily = submitted && Object.prototype.hasOwnProperty.call(snapshot, 'jobFamily')
    && (employee.jobFamily === undefined || text(employee.jobFamily) === text(snapshot.jobFamily))
    && (employee.jobFamilyId === undefined || text(employee.jobFamilyId) === text(snapshot.jobFamilyId));
  employee.positionId = id;
  employee.position = samePosition && unchanged('position') ? previous.position ?? position.name : position.name;
  const keepFamily = samePosition && Object.prototype.hasOwnProperty.call(previous, 'jobFamily')
    && unchanged('jobFamily') && unchanged('jobFamilyId');
  employee.jobFamily = keepFamily ? previous.jobFamily ?? null : position.jobFamily;
  employee.jobFamilyId = keepFamily ? previous.jobFamilyId ?? null : position.jobFamilyId ?? null;
  if (keepSubmittedPosition) employee.position = snapshot.position;
  if (keepSubmittedFamily) {
    employee.jobFamily = snapshot.jobFamily;
    employee.jobFamilyId = snapshot.jobFamilyId ?? null;
  }
  // Existing directory text is authoritative history, never a guessed name-to-ID association.
  return !keepFamily && !position.jobFamilyId
    ? { ...previous, jobFamily: employee.jobFamily, jobFamilyId: null } : previous;
}
