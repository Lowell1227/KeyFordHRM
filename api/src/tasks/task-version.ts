import { ConflictException } from '@nestjs/common';
import { ERROR_CODE } from '@/common/constants/error-codes';

export function assertTaskVersion(updatedAt: Date, expectedUpdatedAt: string): void {
  const expected = new Date(expectedUpdatedAt);
  if (Number.isNaN(expected.getTime()) || updatedAt.toISOString() !== expected.toISOString()) {
    throw new ConflictException({
      code: ERROR_CODE.CONFLICT,
      message: '任务已被其他操作更新，请刷新后重试',
    });
  }
}
