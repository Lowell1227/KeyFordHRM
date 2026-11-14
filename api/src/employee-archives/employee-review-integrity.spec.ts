import { SysRole } from '@prisma/client';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';

const operator = { id: 'synthetic-hr', name: 'HR', sysRole: SysRole.hr,
  deptId: null, isAssessorOnly: false, canViewAll: true };

function archiveReview(positionChanged: boolean, directoryFamily: string | null, proposedFamily?: string | null) {
  const employee = { employeeNo: 'S001', name: '合成员工', phone: null, company: 'fuede',
    companyText: null, contractSubjectId: null, deptId: 'synthetic-dept', positionId: 'original-position',
    position: '目录岗位名称', jobGrade: 'P3', jobFamily: '档案职系', managerId: null,
    workLocation: '原工作地点', entryDate: '2024-01-01T00:00:00.000Z', plannedRegularDate: null,
    actualRegularDate: null, leaveDate: null, probationMonths: null,
    employmentType: 'full_time', employeeStatus: 'active' };
  const proposal = { ...employee, workLocation: '新工作地点',
    ...(proposedFamily !== undefined ? { jobFamily: proposedFamily } : {}),
    ...(positionChanged ? { positionId: 'new-position', position: '提案岗位名称' } : {}) };
  const review = { id: 'synthetic-review', userId: 'synthetic-employee', sourceType: 'manual_archive_change',
    sourceBatchId: null, intakeType: null, recordStatus: 'submitted', archivedAt: null,
    profileReviewStatus: 'pending', performanceReviewStatus: 'not_required', validationErrors: [],
    baseValue: { employee, profile: {}, contracts: [] },
    proposedValue: { employee: proposal, profile: {}, contracts: [] } };
  const current = { ...employee, id: review.userId, status: 'active', entryDate: new Date(employee.entryDate),
    employeeProfile: null, employeeContracts: [], employmentHistory: [{
      company: 'fuede', companyText: null, contractSubjectId: null, positionId: employee.positionId,
      jobGrade: employee.jobGrade, jobFamily: employee.jobFamily, directManagerId: null,
      directManager: null, workLocation: employee.workLocation, probationMonths: null,
    }] };
  const written: Record<string, any>[] = [];
  const tx = {
    employeeDataChangeRequest: { findUnique: jest.fn(async () => review),
      updateMany: jest.fn(async () => ({ count: 1 })), update: jest.fn(async ({ data }: any) => ({ ...review, ...data })) },
    user: { findUnique: jest.fn(async () => current), update: jest.fn(async ({ data }: any) => Object.assign(current, data)) },
    position: { findUnique: jest.fn(async () => ({ id: proposal.positionId, name: '目录岗位名称', jobFamily: directoryFamily })) },
    employmentRecord: { findFirst: jest.fn(async () => null), update: jest.fn(),
      create: jest.fn(async ({ data }: any) => { written.push(data); return { id: 'new-employment', ...data }; }) },
    employeeContract: { findMany: jest.fn(async () => []) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const service = new EmployeeDataReviewsService({ $transaction: async (run: any) => run(tx) } as any);
  return { written, current, approve: () => service.approveBatch({ requestIds: [review.id], scopes: ['profile'] }, operator) };
}

describe('employee review preserves family outside a requested position change', () => {
  it.each([null, '目录其他职系'])('keeps the archive family when only location changes (directory family=%s)', async family => {
    const f = archiveReview(false, family);
    expect((await f.approve()).failed).toEqual([]);
    expect(f.written).toHaveLength(1);
    expect(f.written[0]).toMatchObject({ positionId: 'original-position', position: '目录岗位名称',
      jobFamily: '档案职系', jobGrade: 'P3', workLocation: '新工作地点' });
    expect(f.current.position).toBe('目录岗位名称');
  });

  it.each([null, '新岗位职系'])('keeps existing directory derivation when position actually changes (family=%s)', async family => {
    const f = archiveReview(true, family);
    expect((await f.approve()).failed).toEqual([]);
    expect(f.written[0]).toMatchObject({ positionId: 'new-position', position: '目录岗位名称', jobFamily: family });
    expect(f.current.position).toBe('目录岗位名称');
  });

  it.each([null, '人工修订职系'])('derives an attempted family override from the directory with the same position ID (%s)', async family => {
    const f = archiveReview(false, '目录职系', family);
    expect((await f.approve()).failed).toEqual([]);
    expect(f.written[0]).toMatchObject({ positionId: 'original-position', position: '目录岗位名称', jobFamily: '目录职系' });
  });
});
