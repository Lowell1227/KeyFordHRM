import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { selectEmploymentAt } from './employment-timeline';

@Injectable()
export class EmployeeEffectiveDateService {
  constructor(private readonly prisma: PrismaService) {}

  async refreshEffectiveProjections(at = new Date()) {
    const effectiveAt = this.shanghaiDate(at);
    const [users, records, positions] = await Promise.all([
      this.prisma.user.findMany({
        where: { deletedAt: null, accountType: 'employee' },
        select: { id: true },
      }),
      this.prisma.employmentRecord.findMany({
        orderBy: [{ userId: 'asc' }, { effectiveFrom: 'desc' }],
      }),
      this.prisma.position.findMany({ select: { id: true, name: true } }),
    ]);
    const recordsByUser = new Map<string, typeof records>();
    for (const record of records) {
      const group = recordsByUser.get(record.userId) ?? [];
      group.push(record);
      recordsByUser.set(record.userId, group);
    }
    const positionNames = new Map(positions.map((position) => [position.id, position.name]));
    let overlaps = 0;
    const updates: Array<ReturnType<typeof this.prisma.user.update>> = [];

    for (const user of users) {
      const selection = selectEmploymentAt(recordsByUser.get(user.id) ?? [], effectiveAt);
      if (!selection.current) continue;
      if (selection.matches.length > 1) overlaps += 1;
      const current = selection.current;
      updates.push(this.prisma.user.update({
        where: { id: user.id },
        data: {
          deptId: current.deptId,
          positionId: current.positionId,
          position: current.positionId
            ? (positionNames.get(current.positionId) ?? current.position)
            : current.position,
          entryDate: current.entryDate,
          plannedRegularDate: current.plannedRegularDate,
          actualRegularDate: current.actualRegularDate,
          leaveDate: current.leaveDate,
          employmentType: current.employmentType,
          status: current.employeeStatus,
        },
      }));
    }

    if (updates.length > 0) await this.prisma.$transaction(updates);
    return { checked: users.length, updated: updates.length, overlaps };
  }

  private shanghaiDate(at: Date): Date {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(at);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return new Date(`${value.year}-${value.month}-${value.day}T00:00:00.000Z`);
  }
}
