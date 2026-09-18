import { Prisma, UserStatus } from '@prisma/client';

export const CURRENT_WORKER_STATUSES: UserStatus[] = [UserStatus.active, UserStatus.probation];

export const currentWorkerWhere: Prisma.UserWhereInput = {
  deletedAt: null,
  archivedAt: null,
  status: { in: CURRENT_WORKER_STATUSES },
};
