import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { approvedEmploymentSourceWhere, selectEmploymentAt, shanghaiBusinessDate } from '@/employee-archives/employment-timeline';
import { TALENT_APPLICATION_STAGES } from './talent-application-filter';
import { canReadRecruitment, canWriteRecruitment, hasTalentHiringConfirm, isCurrentRecruitmentActor, isFeedbackOpen } from './talent-recruitment-policy';

export interface TalentWorkbenchItem {
  id: string;
  title: string;
  subtitle: string;
  date: string | null;
  candidateId?: string;
  applicationId?: string;
}

export interface TalentWorkbenchGroup {
  key: 'follow_up' | 'interview' | 'feedback' | 'hiring_review' | 'onboarding';
  total: number;
  items: TalentWorkbenchItem[];
}

@Injectable()
export class TalentWorkbenchService {
  constructor(private readonly prisma: PrismaService) {}

  async getWorkbench(user: AuthUser): Promise<{ groups: TalentWorkbenchGroup[] }> {
    return this.prisma.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: user.id }, select: {
        id: true, sysRole: true, hrCapabilities: true, status: true,
        archivedAt: true, deletedAt: true, isAssessorOnly: true,
      } });
      if (!actor || !isCurrentRecruitmentActor(actor)) throw new ForbiddenException('当前账号不具备办理资格');
      const now = new Date();
      const groups: Array<Promise<TalentWorkbenchGroup>> = [];
      if (canWriteRecruitment(actor)) groups.push(this.followUps(tx, actor.id));
      const participation = { participants: { some: { userId: actor.id } } };
      const reader = canReadRecruitment(actor);
      groups.push(this.interviews(tx, 'interview', {
        ...participation, status: 'scheduled', endsAt: { gte: now },
      }, reader));
      groups.push(this.interviews(tx, 'feedback', {
        ...participation, status: { not: 'cancelled' },
        OR: [{ application: null }, { application: { stage: {
          in: TALENT_APPLICATION_STAGES.filter(stage => isFeedbackOpen(stage, 'completed')),
        } } }],
        AND: [{ OR: [{ status: 'completed' }, { endsAt: { lte: now } }] }],
        feedback: { none: { userId: actor.id, status: 'submitted' } },
      }, reader));
      if (hasTalentHiringConfirm(actor)) groups.push(this.applications(tx, 'hiring_review', {
        stage: 'hiring_review', hiringRequestedById: { not: actor.id },
      }));
      if (canWriteRecruitment(actor)) groups.push(this.onboarding(tx, actor.id, now));
      return { groups: await Promise.all(groups) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private async followUps(tx: Prisma.TransactionClient, actorId: string): Promise<TalentWorkbenchGroup> {
    // Match the talent list's dueOnly + personal talent scope, including first contact and future plans.
    const where: Prisma.TalentCandidateWhereInput = { deletedAt: null, AND: [
      { OR: [{ ownerId: actorId }, { ownerId: null, createdById: actorId }] },
      { OR: [{ followUps: { none: {} } }, { followUps: { some: { planStatus: 'pending' } } }] },
    ] };
    const [total, rows] = await Promise.all([
      tx.talentCandidate.count({ where }),
      tx.talentCandidate.findMany({ where, take: 5, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, followUps: { where: { planStatus: 'pending' }, take: 1,
          orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], select: { nextFollowUpAt: true } } } }),
    ]);
    return { key: 'follow_up', total, items: rows.map(row => ({
      id: row.id, candidateId: row.id, title: row.name, subtitle: '待跟进',
      date: row.followUps[0]?.nextFollowUpAt?.toISOString().slice(0, 10) ?? null,
    })) };
  }

  private async interviews(tx: Prisma.TransactionClient, key: 'interview' | 'feedback',
    where: Prisma.TalentInterviewWhereInput, reader: boolean): Promise<TalentWorkbenchGroup> {
    const select = { id: true, candidateNameSnapshot: true, startsAt: true,
      ...(reader ? { candidateId: true, applicationId: true, application: { select: { positionName: true } } } as const : {}),
    } satisfies Prisma.TalentInterviewSelect;
    const [total, rows] = await Promise.all([
      tx.talentInterview.count({ where }),
      tx.talentInterview.findMany({ where, take: 5, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], select }),
    ]);
    return { key, total, items: rows.map(row => ({
      id: row.id, title: row.candidateNameSnapshot,
      subtitle: (reader ? row.application?.positionName : null) ?? (key === 'interview' ? '待参加面试' : '待本人反馈'),
      date: row.startsAt.toISOString(),
      ...(reader ? { candidateId: row.candidateId, ...(row.applicationId ? { applicationId: row.applicationId } : {}) } : {}),
    })) };
  }

  private async onboarding(tx: Prisma.TransactionClient, actorId: string, now: Date): Promise<TalentWorkbenchGroup> {
    const linked = await tx.talentCandidate.findMany({ where: { deletedAt: null, convertedUserId: { not: null },
      applications: { some: { stage: 'accepted', ownerId: actorId } } }, select: { convertedUserId: true } });
    const ids = linked.map(row => row.convertedUserId).filter((id): id is string => id !== null);
    const today = shanghaiBusinessDate(now);
    // Exclude clear conflicts only; the existing intake guards decide recovery and reentry eligibility.
    const employees = ids.length ? await tx.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, deletedAt: true, employmentHistory: {
        where: { AND: [approvedEmploymentSourceWhere, { effectiveFrom: { lte: today },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] }] },
        select: { id: true, effectiveFrom: true, effectiveTo: true, createdAt: true, employeeStatus: true },
      } },
    }) : [];
    const byId = new Map(employees.map(row => [row.id, row]));
    const blocked = ids.filter(id => {
      const employee = byId.get(id);
      if (!employee || employee.deletedAt || ['active', 'probation', 'disabled'].includes(employee.status)) return true;
      const current = selectEmploymentAt(employee.employmentHistory, today).current;
      return current !== null && ['active', 'probation'].includes(current.employeeStatus);
    });
    return this.applications(tx, 'onboarding', {
      stage: 'accepted', ownerId: actorId,
      candidate: { deletedAt: null, OR: [{ convertedUserId: null }, { convertedUserId: { notIn: blocked } }],
        onboardingRequests: { none: { archivedAt: null, cancelledAt: null,
          onboardingStatus: { in: ['draft', 'submitted', 'pending_entry'] } } } },
    });
  }

  private async applications(tx: Prisma.TransactionClient, key: 'hiring_review' | 'onboarding',
    where: Prisma.TalentApplicationWhereInput): Promise<TalentWorkbenchGroup> {
    const orderBy: Prisma.TalentApplicationOrderByWithRelationInput[] = key === 'hiring_review'
      ? [{ hiringRequestedAt: 'asc' }, { id: 'asc' }]
      : [{ expectedEntryDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }, { id: 'asc' }];
    const [total, rows] = await Promise.all([
      tx.talentApplication.count({ where }),
      tx.talentApplication.findMany({ where, take: 5, orderBy, select: {
        id: true, candidateId: true, positionName: true, candidate: { select: { name: true } },
        hiringRequestedAt: true, expectedEntryDate: true,
      } }),
    ]);
    return { key, total, items: rows.map(row => ({
      id: row.id, applicationId: row.id, candidateId: row.candidateId,
      title: row.candidate.name, subtitle: row.positionName,
      date: key === 'hiring_review' ? row.hiringRequestedAt?.toISOString() ?? null
        : row.expectedEntryDate?.toISOString().slice(0, 10) ?? null,
    })) };
  }
}
