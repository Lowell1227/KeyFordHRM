import { ConfirmationService } from './confirmation.service';
import { approvedEmploymentSourceWhere } from '@/employee-archives/employment-timeline';

describe('confirmation company display', () => {
  const viewer = { id: 'synthetic-employee', sysRole: 'employee' } as any;
  function fixture(history: unknown[]) {
    const employee = { id: viewer.id, name: '虚构员工', employeeNo: 'QA',
      dept: { name: '虚构部门', company: 'fuede' }, employmentHistory: history };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(employee) } };
    const service = new ConfirmationService(prisma as any, {} as any, {} as any, {} as any);
    return { service, prisma, employee };
  }
  it('uses the formal company snapshot rather than the department authorization code', async () => {
    const { service, prisma, employee } = fixture([{ company: null, companyText: '虚构任职公司' }]);
    expect(await service.myRoster(viewer)).toMatchObject({ company: null, companyText: '虚构任职公司' });
    const historyQuery = prisma.user.findUnique.mock.calls[0][0].select.employmentHistory;
    expect(historyQuery.where.AND).toContainEqual(approvedEmploymentSourceWhere);
    expect(historyQuery.take).toBe(1);
    const detail = (service as any).mapToDetail({ employee, employeeId: viewer.id,
      workflowVersion: 2, status: 'draft', meetingAttachments: [] }, viewer);
    expect(detail.roster).toMatchObject({ company: null, companyText: '虚构任职公司' });
  });
  it('retains a historical employment code and does not guess missing company from the department', async () => {
    expect(await fixture([{ company: 'fansibao', companyText: null }]).service.myRoster(viewer))
      .toMatchObject({ company: 'fansibao', companyText: null });
    expect(await fixture([]).service.myRoster(viewer)).toMatchObject({ company: null, companyText: null });
  });
});
