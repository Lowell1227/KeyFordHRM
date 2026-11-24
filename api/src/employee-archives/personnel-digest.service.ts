import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hasHrCapability } from '@/auth/hr-capabilities';
import type { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { currentArchiveFactsSelect, loadCurrentArchiveIssues } from './employee-archive-current-issues';
import { activeApplicationWhere } from './employee-data-change-view';
import { addDays, contractDeadline, dateKey, digestDay, digestKinds, projectApplication, type DigestItem } from './personnel-digest';

@Injectable()
export class PersonnelDigestService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async list(viewer: Pick<AuthUser, 'id' | 'sysRole' | 'hrCapabilities'>, day = digestDay(new Date()).day) {
    if (!hasHrCapability(viewer, 'employee_archive_edit') && !hasHrCapability(viewer, 'employee_archive_review')) {
      throw new ForbiddenException('无权限查看人事待办');
    }
    const [staff, requests] = await Promise.all([
      this.prisma.user.findMany({
        where: { accountType: 'employee', deletedAt: null, archivedAt: null, status: { in: ['active', 'probation'] } },
        select: { id: true, name: true, status: true, plannedRegularDate: true, actualRegularDate: true,
          employeeContracts: { select: currentArchiveFactsSelect.employeeContracts.select } },
      }),
      this.prisma.employeeDataChangeRequest.findMany({
        where: { ...activeApplicationWhere(), AND: [
          { OR: [{ userId: null }, { user: { deletedAt: null, archivedAt: null } }] },
          { OR: [{ sourceSystem: null }, { sourceSystem: { not: 'archive_assistant_pilot' } }, { createdById: viewer.id }] },
        ] },
        select: { id: true, employeeName: true, createdById: true, intakeType: true, requiresArrivalConfirmation: true,
          onboardingStatus: true, profileReviewStatus: true, performanceReviewStatus: true,
          arrivalConfirmedAt: true, proposedValue: true },
      }),
    ]);
    const archiveIssues = await loadCurrentArchiveIssues(this.prisma, staff.map(person => person.id));
    const items: DigestItem[] = requests.flatMap(row => {
      const item = projectApplication(row, viewer.id, day);
      return item ? [item] : [];
    });
    const probationHorizon = addDays(day, this.window('PERSONNEL_DIGEST_PROBATION_DAYS', 14));
    const contractHorizon = addDays(day, this.window('PERSONNEL_DIGEST_CONTRACT_DAYS', 30));
    for (const person of staff) {
      const common = { id: person.id, employee: person.name, link: '/users?employeeId=' + person.id };
      const planned = dateKey(person.plannedRegularDate);
      if (person.status === 'probation' && !person.actualRegularDate && planned && planned <= probationHorizon) {
        items.push({ ...common, kind: 'probation', due: planned, next: '核对试用期结束日期并跟进转正办理' });
      }
      const expiry = contractDeadline(person.employeeContracts, day, contractHorizon);
      if (expiry) {
        items.push({ ...common, kind: 'contract', due: expiry, next: '核对续签或合同结束情况' });
      }
      const issues = (archiveIssues.get(person.id) ?? []).filter(issue => !expiry || issue.id !== 'current:contract-expired');
      if (issues.length) {
        items.push({ ...common, kind: 'archive', due: null, next: issues.map(issue => issue.message).join('、') });
      }
    }
    items.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.employee.localeCompare(b.employee, 'zh-CN'));
    return { day, items, kinds: digestKinds };
  }

  private window(name: string, fallback: number) {
    const configured = Number(this.config.get<string>(name) ?? fallback);
    return Number.isInteger(configured) && configured >= 0 && configured <= 365 ? configured : fallback;
  }
}
