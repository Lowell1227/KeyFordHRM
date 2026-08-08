import { ConflictException } from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';
import { ERROR_CODE } from '@/common/constants/error-codes';

export function assertTaskVersion(updatedAt: Date, expectedUpdatedAt: string): void {
  const expected = new Date(expectedUpdatedAt);
  if (Number.isNaN(expected.getTime()) || updatedAt.toISOString() !== expected.toISOString()) {
    throw taskVersionConflict();
  }
}

export function taskVersionConflict(): ConflictException {
  return new ConflictException({
    code: ERROR_CODE.CONFLICT,
    message: '任务已被其他操作更新，请刷新后重试',
  });
}

export async function claimTaskVersion(
  tx: Prisma.TransactionClient,
  taskId: string,
  expectedUpdatedAt: string,
  expectedStatus?: TaskStatus,
): Promise<Date> {
  const expected = new Date(expectedUpdatedAt);
  const claimedUpdatedAt = new Date(Math.max(Date.now(), expected.getTime() + 1));
  const claimed = await tx.assessmentTask.updateMany({
    where: { id: taskId, updatedAt: expected, ...(expectedStatus ? { status: expectedStatus } : {}) },
    data: { updatedAt: claimedUpdatedAt },
  });

  if (claimed.count !== 1) throw taskVersionConflict();
  return claimedUpdatedAt;
}
