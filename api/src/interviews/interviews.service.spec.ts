import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InterviewsService } from './interviews.service';
import { CreateInterviewDto } from './dto/create-interview.dto';
import { InterviewQueryDto } from './dto/interview-query.dto';

const viewer = (sysRole: SysRole = SysRole.hr_user) => ({ id: 'hr-1', name: 'HR', sysRole, deptId: null, isAssessorOnly: false, canViewAll: false });
const item = {
  id: 'interview-1', employeeId: 'emp-1', interviewerId: 'mgr-1', cycleId: null, taskId: null,
  status: 'closed', employeeSignedAt: new Date(), managerSignedAt: new Date(), deadline: new Date(),
  achievements: '原始记录', employee: { name: '员工', employeeNo: 'E1', deptId: 'dept-1', dept: { name: '部门' }, position: '专员' },
  interviewer: { name: '面谈人' }, recordedBy: { name: '录入HR' }, cycle: null,
};
function setup() {
  const prisma = {
    performanceInterview: { findUnique: jest.fn().mockResolvedValue(item), findMany: jest.fn().mockResolvedValue([item]),
      count: jest.fn().mockResolvedValue(1), create: jest.fn().mockResolvedValue(item), update: jest.fn().mockResolvedValue(item) },
    user: { count: jest.fn().mockResolvedValue(2), findMany: jest.fn().mockResolvedValue([]) },
    assessmentCycle: { findUnique: jest.fn().mockResolvedValue({ id: 'cycle-1' }), findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn() }, signature: { create: jest.fn() }, assessmentTask: { update: jest.fn() },
    flowRecord: { create: jest.fn() }, notification: { create: jest.fn() }, $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(callback => callback(prisma));
  return { prisma, service: new InterviewsService(prisma as any) };
}
describe('HR interview ledger', () => {
  it.each([SysRole.hr_user, SysRole.hr, SysRole.system_admin])('lets %s edit legacy signed records without workflow writes', async role => {
    const { prisma, service } = setup();
    await service.update(item.id, { achievements: '补充记录' }, viewer(role));
    expect(prisma.performanceInterview.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ achievements: '补充记录', updatedAt: expect.any(Date) }),
    }));
    expect(prisma.performanceInterview.update.mock.calls[0][0].data).not.toHaveProperty('status');
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ userId: 'hr-1', action: 'update', oldValue: { achievements: '原始记录' } });
    expect(prisma.assessmentTask.update).not.toHaveBeenCalled();
    expect(prisma.signature.create).not.toHaveBeenCalled();
    expect(prisma.flowRecord.create).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
  it.each([SysRole.employee, SysRole.chairman])('denies %s including a named interviewer or canViewAll account', async role => {
    const { prisma, service } = setup();
    const user = { ...viewer(role), id: 'mgr-1', canViewAll: true };
    await expect(service.findAll(new InterviewQueryDto(), user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.findOne(item.id, user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.update(item.id, {}, user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.create({ employeeId: 'emp-1', interviewTime: new Date() }, user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.people(new InterviewQueryDto(), user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.cycles(user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.performanceInterview.findUnique).not.toHaveBeenCalled();
  });
  it('creates multiple records without a cycle or performance task and audits the recorder', async () => {
    const { prisma, service } = setup();
    const dto = { employeeId: 'emp-1', interviewTime: new Date(), achievements: '独立沟通' };
    await service.create(dto, viewer());
    await service.create(dto, viewer());
    expect(prisma.performanceInterview.create).toHaveBeenCalledTimes(2);
    const data = prisma.performanceInterview.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ cycleId: null, employeeId: 'emp-1', interviewerId: 'hr-1', recordedById: 'hr-1' });
    expect(data).not.toHaveProperty('taskId');
    expect(data).not.toHaveProperty('deadline');
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
  });
  it('validates optional references before creating', async () => {
    const { prisma, service } = setup();
    prisma.assessmentCycle.findUnique.mockResolvedValue(null);
    await expect(service.create({ employeeId: 'emp-1', cycleId: 'missing', interviewTime: new Date() }, viewer())).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.performanceInterview.create).not.toHaveBeenCalled();
    prisma.user.count.mockResolvedValue(1);
    await expect(service.create({ employeeId: 'missing', interviewTime: new Date() }, viewer())).rejects.toBeInstanceOf(BadRequestException);
  });
  it('keeps legacy content visible to HR while omitting workflow and signature fields', async () => {
    const { service } = setup();
    const detail = await service.findOne(item.id, viewer());
    expect(detail).toMatchObject({ achievements: '原始记录', employeeName: '员工', interviewerName: '面谈人' });
    for (const key of ['taskId', 'status', 'employeeSignedAt', 'managerSignedAt', 'deadline']) expect(detail).not.toHaveProperty(key);
  });
  it('filters standalone records by the employee department and name, without requiring a task', async () => {
    const { prisma, service } = setup();
    await service.findAll(Object.assign(new InterviewQueryDto(), { cycleId: 'cycle-1', deptId: 'dept-1', keyword: ' E1 ' }), viewer());
    expect(prisma.performanceInterview.findMany.mock.calls[0][0].where).toEqual({
      cycleId: 'cycle-1', employee: { deptId: 'dept-1', OR: [
        { name: { contains: 'E1', mode: 'insensitive' } }, { employeeNo: { contains: 'E1', mode: 'insensitive' } },
      ] },
    });
  });
  it('requires employee and valid interview time for new records and limits notes', async () => {
    for (const input of [{}, { employeeId: 'invalid', interviewTime: 'invalid' },
      { employeeId: '11111111-1111-4111-8111-111111111111', achievements: 'a'.repeat(4001) }]) {
      expect((await validate(plainToInstance(CreateInterviewDto, input))).length).toBeGreaterThan(0);
    }
    expect(await validate(plainToInstance(CreateInterviewDto, {
      employeeId: '11111111-1111-4111-8111-111111111111', interviewTime: '2026-09-10T10:00:00+08:00',
    }))).toEqual([]);
  });
});
