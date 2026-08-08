import { ConflictException } from '@nestjs/common';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { assertTaskVersion } from './task-version';

describe('assertTaskVersion', () => {
  it('accepts the same instant after ISO normalization', () => {
    expect(() =>
      assertTaskVersion(new Date('2026-08-08T08:00:00.000Z'), '2026-08-08T16:00:00.000+08:00'),
    ).not.toThrow();
  });

  it('rejects a stale expected update time with the conflict business code', () => {
    expect(() => assertTaskVersion(new Date('2026-08-08T08:00:01.000Z'), '2026-08-08T08:00:00.000Z')).toThrow(
      '任务已被其他操作更新，请刷新后重试',
    );

    try {
      assertTaskVersion(new Date('2026-08-08T08:00:01.000Z'), '2026-08-08T08:00:00.000Z');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: ERROR_CODE.CONFLICT,
      });
    }
  });
});
