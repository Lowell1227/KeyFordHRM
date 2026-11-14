import { BadRequestException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { shanghaiBusinessDate } from './employment-timeline';

export function assertManualEmploymentBoundary(input: {
  employeeStatus: UserStatus;
  currentStatus?: UserStatus;
  changeType: unknown;
  leaveDate?: Date | null;
  effectiveTo?: Date | null;
}) {
  // Ended historical supplements never project onto the current account.
  if (input.effectiveTo && input.effectiveTo < shanghaiBusinessDate()) return;
  if (input.currentStatus === UserStatus.pending_entry || input.employeeStatus === UserStatus.pending_entry) {
    throw new BadRequestException('待到岗员工请通过入职申请处理，不能通过普通任职变更启用或停用');
  }
  if (input.currentStatus === UserStatus.resigned && input.employeeStatus !== UserStatus.resigned) {
    throw new BadRequestException('已离职员工请办理再入职，不能通过普通任职变更恢复历史工号');
  }
  if (input.employeeStatus !== UserStatus.resigned) return;
  if (input.changeType !== 'resignation') {
    throw new BadRequestException('离职请通过“办理离职”提交，不能通过普通任职变更停用员工');
  }
  if (!input.leaveDate || !Number.isFinite(input.leaveDate.getTime())) {
    throw new BadRequestException('离职申请缺少有效的最后工作日，请修改后重新提交');
  }
}
