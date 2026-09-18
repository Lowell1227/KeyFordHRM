import { Injectable } from '@nestjs/common';
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
}
