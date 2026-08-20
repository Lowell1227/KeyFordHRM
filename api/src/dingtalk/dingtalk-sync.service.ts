import { GoneException, Injectable } from '@nestjs/common';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { PrismaService } from '@/prisma/prisma.service';
import { DingtalkService } from './dingtalk.service';

/**
 * 兼容保护壳：钉钉组织同步已永久停用。
 *
 * 员工、部门、岗位、直属上级和在离职状态只允许由 HRM 员工主数据写入。
 * 该类暂时保留是为了让旧调用收到明确错误，而不是意外恢复旧同步逻辑。
 */
@Injectable()
export class DingtalkSyncService {
  constructor(
    private readonly dingtalk: DingtalkService,
    private readonly prisma: PrismaService,
  ) {}

  runSync(_operatorId?: string): never {
    throw new GoneException({
      code: ERROR_CODE.PARAM_INVALID,
      message: '钉钉组织同步已停用，组织与人员请通过员工档案维护',
    });
  }
}
