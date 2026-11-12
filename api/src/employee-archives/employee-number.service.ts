import { ConflictException, Injectable } from '@nestjs/common';
import { EmployeeNumberStatus, Prisma } from '@prisma/client';

@Injectable()
export class EmployeeNumberService {
  async reserveNext(
    tx: Prisma.TransactionClient,
    sourceRequestId: string,
    userId?: string,
  ): Promise<string> {
    const [row] = await tx.$queryRaw<Array<{ value: bigint }>>`
      SELECT nextval('employee_number_seq') AS value
    `;
    const employeeNo = String(row.value);
    await tx.employeeNumberAssignment.create({
      data: {
        userId: userId ?? null,
        employeeNo,
        status: EmployeeNumberStatus.reserved,
        sourceRequestId,
      },
    });
    return employeeNo;
  }

  async releaseReservation(
    tx: Prisma.TransactionClient,
    sourceRequestId: string,
    releasedAt = new Date(),
  ) {
    return tx.employeeNumberAssignment.updateMany({
      where: { sourceRequestId, status: EmployeeNumberStatus.reserved },
      data: { status: EmployeeNumberStatus.released, releasedAt },
    });
  }

  async renewReleasedReservation(tx: Prisma.TransactionClient, sourceRequestId: string, userId: string) {
    const previous = await tx.employeeNumberAssignment.findFirst({ where: { sourceRequestId, userId } });
    if (!previous || previous.status !== EmployeeNumberStatus.released) {
      throw new ConflictException('原预留工号尚未释放或已变化，请刷新后核对');
    }
    const previousAssignment = { ...previous };
    const [row] = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('employee_number_seq') AS value`;
    const employeeNo = String(row.value);
    // One assignment per source request; the caller saves the released snapshot in revision history.
    const updated = await tx.employeeNumberAssignment.updateMany({
      where: { id: previous.id, sourceRequestId, userId, employeeNo: previous.employeeNo, status: EmployeeNumberStatus.released },
      data: { employeeNo, status: EmployeeNumberStatus.reserved, releasedAt: null, effectiveFrom: null, effectiveTo: null },
    });
    if (updated.count !== 1) throw new ConflictException('原预留工号已变化，请刷新后重试');
    return { employeeNo, previousAssignment };
  }
}
