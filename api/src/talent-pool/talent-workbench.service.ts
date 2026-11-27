import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { PaginationDto } from '@/common/dto/pagination.dto';
import { hasHrCapability } from '@/auth/hr-capabilities';
import { approvedEmploymentSourceWhere, selectEmploymentAt, shanghaiBusinessDate } from '@/employee-archives/employment-timeline';
import { TALENT_APPLICATION_STAGES } from './talent-application-filter';
import { canEditRecruitment, canReadRecruitment, canReviewRecruitmentDemand, canWriteRecruitment, hasTalentHiringConfirm, isCurrentRecruitmentActor, isFeedbackOpen, type RecruitmentActor } from './talent-recruitment-policy';

export interface TalentWorkbenchItem {
  id: string;
  title: string;
  subtitle: string;
  date: string | null;
  candidateId?: string;
  applicationId?: string;
  intakeId?: string;
  onboardingRequestId?: string;
  demandId?: string;
  ownerName?: string | null;
  nextAction?: string;
}

export interface TalentWorkbenchGroup {
  key: 'follow_up' | 'interview' | 'feedback' | 'hiring_review' | 'onboarding_handoff' | 'intake_review' | 'intake_assignment' | 'entry_overdue' | 'demand_review' | 'demand_returned';
  total: number;
  items: TalentWorkbenchItem[];
}

export function recruitmentDemandWorkbenchWhere(key: 'review' | 'returned', actor: RecruitmentActor): Prisma.RecruitmentDemandWhereInput {
  if (key === 'review' ? !canReviewRecruitmentDemand(actor) : !canEditRecruitment(actor)) {
    throw new ForbiddenException('无权限办理该招聘需求队列');
  }
  return { sourceKind: 'local', sourceState: key === 'review' ? 'pending' : 'rejected',
    submittedById: key === 'review' ? { not: actor.id } : actor.id };
}

export function recruitmentIntakeWorkbenchWhere(key: 'intake_review' | 'intake_assignment', actorId: string): Prisma.RecruitmentIntakeWhereInput {
  return { ownerId: actorId, associatedToId: null,
    state: { in: key === 'intake_assignment' ? ['awaiting_resume', 'pending_review', 'needs_material'] : ['pending_review', 'needs_material'] },
    demandId: key === 'intake_assignment' ? null : { not: null } };
}

const activeEntryRequest = { archivedAt: null, cancelledAt: null, arrivalConfirmedAt: null,
  recordStatus: { in: ['draft', 'submitted'] }, onboardingStatus: { in: ['draft', 'submitted', 'pending_entry'] },
} satisfies Prisma.EmployeeDataChangeRequestWhereInput;

export function recruitmentEntryOverdueScope(actor: RecruitmentActor): Prisma.TalentApplicationWhereInput | null {
  if (!isCurrentRecruitmentActor(actor)) return null;
  const scopes: Prisma.TalentApplicationWhereInput[] = [];
  if (canEditRecruitment(actor)) scopes.push({ ownerId: actor.id });
  if (hasHrCapability(actor, 'employee_archive_edit') || hasHrCapability(actor, 'employee_archive_review')) {
    scopes.push({ onboardingRequests: { some: { AND: [activeEntryRequest, { OR: [
      { sourceSystem: null }, { sourceSystem: { not: 'archive_assistant_pilot' } }, { createdById: actor.id },
    ] }] } } });
  }
  return scopes.length > 1 ? { OR: scopes } : scopes[0] ?? null;
}

function calendarDate(value: unknown): string | null {
  let text = value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : value;
  if (typeof text === 'string' && text.includes('T')) {
    const serialized = new Date(text);
    if (!Number.isFinite(serialized.getTime()) || serialized.toISOString() !== text) return null;
    text = serialized.toISOString().slice(0, 10);
  }
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null;
}

// Shared with full-list consumers: filter before pagination because a revised intake date supersedes the application date.
export async function readRecruitmentEntryOverdue(tx: Prisma.TransactionClient, actor: RecruitmentActor, now: Date) {
  const scope = recruitmentEntryOverdueScope(actor);
  if (!scope) return [];
  const rows = await tx.talentApplication.findMany({ where: { AND: [scope], stage: { in: ['accepted', 'onboarding'] },
    candidate: { deletedAt: null }, onboardingRequests: { none: { OR: [
      { onboardingStatus: 'effective' }, { recordStatus: 'effective' }, { arrivalConfirmedAt: { not: null } },
    ] } },
  }, select: { id: true, candidateId: true, ownerId: true, stage: true, positionName: true, expectedEntryDate: true,
    candidate: { select: { name: true, deletedAt: true } }, onboardingRequests: {
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: { id: true, intakeType: true, onboardingStatus: true, recordStatus: true, archivedAt: true, cancelledAt: true,
        arrivalConfirmedAt: true, proposedValue: true, sourceSystem: true, createdById: true },
    },
  } });
  const today = shanghaiBusinessDate(now).toISOString().slice(0, 10);
  return rows.flatMap(row => {
    if (!['accepted', 'onboarding'].includes(row.stage) || row.candidate.deletedAt) return [];
    if (row.onboardingRequests.some(request => request.arrivalConfirmedAt || request.onboardingStatus === 'effective' || request.recordStatus === 'effective')) return [];
    const request = row.onboardingRequests.find(request => !request.archivedAt && !request.cancelledAt && !request.arrivalConfirmedAt
      && ['draft', 'submitted', 'pending_entry'].includes(request.onboardingStatus ?? '') && ['draft', 'submitted'].includes(request.recordStatus));
    if (row.stage === 'onboarding' && !request) return [];
    let date = calendarDate(row.expectedEntryDate);
    if (request) {
      const proposed = request.proposedValue as { employee?: Record<string, unknown> } | null;
      const employee = proposed?.employee;
      date = calendarDate(employee?.[request.intakeType === 'reentry' ? 'effectiveDate' : 'effectiveFrom'] ?? employee?.entryDate);
    }
    const canOpenIntake = request && (hasHrCapability(actor, 'employee_archive_edit') || hasHrCapability(actor, 'employee_archive_review'))
      && (request.sourceSystem !== 'archive_assistant_pilot' || request.createdById === actor.id);
    return date && date < today ? [{ id: row.id, candidateId: row.candidateId, ownerId: row.ownerId,
      title: row.candidate.name, subtitle: row.positionName, date, requestId: canOpenIntake ? request.id : undefined }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

@Injectable()
export class TalentWorkbenchService {
  constructor(private readonly prisma: PrismaService) {}

  async getWorkbench(user: AuthUser): Promise<{ groups: TalentWorkbenchGroup[] }> {
    return this.prisma.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: user.id }, select: {
        id: true, name: true, sysRole: true, hrCapabilities: true, status: true,
        archivedAt: true, deletedAt: true, isAssessorOnly: true,
      } });
      if (!actor || !isCurrentRecruitmentActor(actor)) throw new ForbiddenException('当前账号不具备办理资格');
      const now = new Date();
      const groups: Array<Promise<TalentWorkbenchGroup>> = [];
      if (canEditRecruitment(actor)) {
        groups.push(this.followUps(tx, actor.id, now));
        groups.push(this.intakes(tx, 'intake_assignment', actor), this.intakes(tx, 'intake_review', actor));
      }
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
      if (canWriteRecruitment(actor)) groups.push(this.onboarding(tx, now));
      if (recruitmentEntryOverdueScope(actor)) groups.push(this.entryOverdue(tx, actor, now));
      if (canReviewRecruitmentDemand(actor)) groups.push(this.demands(tx, 'demand_review', actor));
      if (canEditRecruitment(actor)) groups.push(this.demands(tx, 'demand_returned', actor));
      return { groups: await Promise.all(groups) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async listOnboardingHandoff(query: PaginationDto, user: AuthUser) {
    return this.prisma.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: user.id }, select: {
        id: true, sysRole: true, hrCapabilities: true, status: true, archivedAt: true, deletedAt: true, isAssessorOnly: true,
      } });
      if (!actor || !canWriteRecruitment(actor)) throw new ForbiddenException('无权限办理入职交接');
      const { items, total } = await this.onboarding(tx, new Date(), query);
      return { items, total, page: query.page, pageSize: query.pageSize };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private async demands(tx: Prisma.TransactionClient, key: 'demand_review' | 'demand_returned', actor: RecruitmentActor): Promise<TalentWorkbenchGroup> {
    const where = recruitmentDemandWorkbenchWhere(key === 'demand_review' ? 'review' : 'returned', actor);
    const [total, rows] = await Promise.all([
      tx.recruitmentDemand.count({ where }),
      tx.recruitmentDemand.findMany({ where, take: 5, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        select: { id: true, rawPosition: true, rawDepartment: true, updatedAt: true } }),
    ]);
    return { key, total, items: rows.map(row => ({ id: row.id, demandId: row.id,
      title: row.rawPosition || '招聘需求', subtitle: row.rawDepartment || '部门待核对', date: row.updatedAt.toISOString(),
      nextAction: key === 'demand_review' ? '独立审核招聘需求' : '按退回意见修改并重新提交',
    })) };
  }

  private async intakes(tx: Prisma.TransactionClient, key: 'intake_review' | 'intake_assignment', actor: RecruitmentActor & { name: string }): Promise<TalentWorkbenchGroup> {
    const where = recruitmentIntakeWorkbenchWhere(key, actor.id);
    const [total, rows] = await Promise.all([
      tx.recruitmentIntake.count({ where }),
      tx.recruitmentIntake.findMany({ where, take: 5, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, positionName: true, state: true, nextFollowUpAt: true } }),
    ]);
    return { key, total, items: rows.map(row => ({ id: row.id, intakeId: row.id,
      title: row.positionName || '岗位待确认', subtitle: key === 'intake_assignment' ? '待归岗位' : '待核对简历',
      ownerName: actor.name, nextAction: key === 'intake_assignment' ? '核对岗位和意向需求'
        : row.state === 'pending_review' ? '核对资料并确认入库' : '补充简历资料后核对',
      date: row.nextFollowUpAt?.toISOString() ?? null,
    })) };
  }

  private async entryOverdue(tx: Prisma.TransactionClient, actor: RecruitmentActor, now: Date): Promise<TalentWorkbenchGroup> {
    const rows = await readRecruitmentEntryOverdue(tx, actor, now);
    const selected = rows.slice(0, 5);
    const names = selected.length ? new Map((await tx.user.findMany({ where: { id: { in: [...new Set(selected.map(row => row.ownerId))] } },
      select: { id: true, name: true } })).map(row => [row.id, row.name])) : new Map<string, string>();
    const canOpenIntake = hasHrCapability(actor, 'employee_archive_edit') || hasHrCapability(actor, 'employee_archive_review');
    return { key: 'entry_overdue', total: rows.length, items: selected.map(({ requestId, ownerId, ...row }) => ({
      ...row, applicationId: row.id, ownerName: names.get(ownerId) ?? null,
      ...(canOpenIntake && requestId ? { onboardingRequestId: requestId } : {}),
      nextAction: canOpenIntake && requestId ? '核对入职办理和实际到岗结果' : '核对预计到岗日期与录用结果',
    })) };
  }

  private async followUps(tx: Prisma.TransactionClient, actorId: string, now: Date): Promise<TalentWorkbenchGroup> {
    // Match the talent list's dueOnly + personal talent scope, including first contact and future plans.
    const where: Prisma.TalentCandidateWhereInput = { deletedAt: null, AND: [
      { OR: [{ ownerId: actorId }, { ownerId: null, createdById: actorId }] },
      { OR: [{ followUps: { none: {} } }, { followUps: { some: { planStatus: 'pending' } } }] },
    ] };
    const total = await tx.talentCandidate.count({ where });
    const today = shanghaiBusinessDate(now).toISOString().slice(0, 10);
    const bucket = (date: string | null) => date === null ? 2 : date < today ? 0 : date === today ? 1 : 3;
    let items: TalentWorkbenchItem[] = [];
    // The latest pending plan is a relation projection; scan bounded pages and retain only the best five.
    for (let skip = 0; skip < total; skip += 100) {
      const rows = await tx.talentCandidate.findMany({ where, skip, take: 100, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, followUps: { where: { planStatus: 'pending' }, take: 1,
          orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], select: { nextFollowUpAt: true } } } });
      items = [...items, ...rows.map(row => ({ id: row.id, candidateId: row.id, title: row.name, subtitle: '待跟进',
        date: row.followUps[0]?.nextFollowUpAt?.toISOString().slice(0, 10) ?? null,
      }))].sort((a, b) => bucket(a.date) - bucket(b.date) || (a.date ?? '').localeCompare(b.date ?? '')).slice(0, 5);
      if (rows.length < 100) break;
    }
    return { key: 'follow_up', total, items };
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

  private async onboarding(tx: Prisma.TransactionClient, now: Date, query?: PaginationDto): Promise<TalentWorkbenchGroup> {
    const linked = await tx.talentCandidate.findMany({ where: { deletedAt: null, convertedUserId: { not: null },
      applications: { some: { stage: 'accepted' } } }, select: { convertedUserId: true } });
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
    return this.applications(tx, 'onboarding_handoff', {
      stage: 'accepted',
      candidate: { deletedAt: null, OR: [{ convertedUserId: null }, { convertedUserId: { notIn: blocked } }],
        onboardingRequests: { none: { archivedAt: null, cancelledAt: null,
          onboardingStatus: { in: ['draft', 'submitted', 'pending_entry'] } } } },
    }, query);
  }

  private async applications(tx: Prisma.TransactionClient, key: 'hiring_review' | 'onboarding_handoff',
    where: Prisma.TalentApplicationWhereInput, query?: PaginationDto): Promise<TalentWorkbenchGroup> {
    const orderBy: Prisma.TalentApplicationOrderByWithRelationInput[] = key === 'hiring_review'
      ? [{ hiringRequestedAt: 'asc' }, { id: 'asc' }]
      : [{ expectedEntryDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }, { id: 'asc' }];
    const [total, rows] = await Promise.all([
      tx.talentApplication.count({ where }),
      tx.talentApplication.findMany({ where, ...(query ? { skip: query.skip } : {}), take: query?.take ?? 5, orderBy, select: {
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
