import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Appeal, AppealResult, Prisma, SysRole } from '@prisma/client';
import { AppealsService } from './appeals.service';
import { PrismaService } from '@/prisma/prisma.service';
import { CalibrationService } from '@/calibration/calibration.service';
import { AuthUser } from '@/common/types/auth.types';
import { PaginationDto } from '@/common/dto/pagination.dto';
import { ERROR_CODE } from '@/common/constants/error-codes';

const viewer: AuthUser = {
  id: 'hr-1',
  name: 'HR',
  sysRole: SysRole.hr,
  deptId: null,
  isAssessorOnly: false,
  canViewAll: false,
};

function makeTask(overrides: Partial<Prisma.AssessmentTaskUncheckedCreateInput> = {}) {
  return {
    id: 'task-1',
    cycleId: 'cycle-1',
    employeeId: 'emp-1',
    deptId: 'dept-1',
    status: 'published',
    isExempt: false,
    ...overrides,
  } as Prisma.AssessmentTaskGetPayload<{ include: { gradeResult: true; employee: true; cycle: true } }>;
}

function makeGradeResult(overrides: Partial<Prisma.GradeResultUncheckedCreateInput> = {}) {
  return {
    id: 'gr-1',
    taskId: 'task-1',
    calculatedScore: new Prisma.Decimal(85),
    rawGrade: 'B' as const,
    calibratedGrade: 'B' as const,
    coefficient: new Prisma.Decimal(1.0),
    ...overrides,
  };
}

describe('AppealsService', () => {
  let service: AppealsService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let calibrationService: { loadGradeCoefficients: jest.Mock };

  function makePrismaMock() {
    const appeal: Record<string, jest.Mock> = {
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    };
    const assessmentTask: Record<string, jest.Mock> = {
      findUnique: jest.fn(),
    };
    const gradeResult: Record<string, jest.Mock> = {
      update: jest.fn(),
    };
    const performanceArchive: Record<string, jest.Mock> = {
      findUnique: jest.fn(),
      update: jest.fn(),
    };
    const auditLog: Record<string, jest.Mock> = {
      create: jest.fn(),
    };

    const client = {
      appeal,
      assessmentTask,
      gradeResult,
      performanceArchive,
      auditLog,
      $transaction: jest.fn((cb: any) => cb(client)),
    };

    return client;
  }

  beforeEach(async () => {
    prisma = makePrismaMock();
    calibrationService = { loadGradeCoefficients: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppealsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CalibrationService, useValue: calibrationService },
      ],
    }).compile();

    service = module.get<AppealsService>(AppealsService);

    calibrationService.loadGradeCoefficients.mockResolvedValue({
      A: 1.2,
      B: 1.0,
      C: 0.8,
      D: 0.5,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('成功录入申诉并写 AuditLog', async () => {
      const task = makeTask();
      task.gradeResult = makeGradeResult() as unknown as typeof task.gradeResult;
      task.employee = { id: 'emp-1', name: '员工A' } as typeof task.employee;
      task.cycle = { id: 'cycle-1', deadlineAppeal: new Date('2026-07-15') } as typeof task.cycle;

      prisma.assessmentTask.findUnique.mockResolvedValue(task);
      prisma.appeal.count.mockResolvedValue(0);
      prisma.appeal.create.mockResolvedValue({
        id: 'appeal-1',
        taskId: 'task-1',
        cycleId: 'cycle-1',
        appellantId: 'emp-1',
        reason: '对结果有异议',
        attachments: [],
        status: 'pending',
        appealDeadline: new Date('2026-07-15'),
      } as unknown as Appeal);

      const result = await service.create(
        { taskId: 'task-1', reason: '对结果有异议' },
        viewer,
      );

      expect(result.taskId).toBe('task-1');
      expect(result.appellantId).toBe('emp-1');
      expect(result.status).toBe('pending');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'hr-1',
            action: 'create_appeal',
            entityType: 'appeal',
            newValue: expect.objectContaining({ taskId: 'task-1', appellantId: 'emp-1' }),
          }),
        }),
      );
    });

    it('任务无 GradeResult 时拒绝', async () => {
      const task = makeTask();
      task.gradeResult = null;
      task.employee = { id: 'emp-1', name: '员工A' } as any;
      task.cycle = { id: 'cycle-1' } as any;

      prisma.assessmentTask.findUnique.mockResolvedValue(task);

      await expect(service.create({ taskId: 'task-1', reason: '异议' }, viewer)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('同一任务存在 pending 申诉时拒绝并返回 4009', async () => {
      const task = makeTask();
      task.gradeResult = makeGradeResult() as any;
      task.employee = { id: 'emp-1' } as any;
      task.cycle = { id: 'cycle-1' } as any;

      prisma.assessmentTask.findUnique.mockResolvedValue(task);
      prisma.appeal.count.mockResolvedValue(1);

      await expect(service.create({ taskId: 'task-1', reason: '异议' }, viewer)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findAll', () => {
    it('按 keyword、status、deptId 过滤并分页，返回不含 coefficient', async () => {
      prisma.appeal.count.mockResolvedValue(1);
      prisma.appeal.findMany.mockResolvedValue([
        {
          id: 'appeal-1',
          taskId: 'task-1',
          cycleId: 'cycle-1',
          status: 'pending',
          reason: '异议',
          finalResult: null,
          hrResolution: null,
          createdAt: new Date(),
          hrResolvedAt: null,
          appellant: { id: 'emp-1', name: '员工A' },
          task: { dept: { id: 'dept-1', name: '研发部' } },
          cycle: { id: 'cycle-1', name: '2026Q1' },
        },
      ]);

      const pagination = new PaginationDto();
      pagination.page = 1;
      pagination.pageSize = 20;

      const result = await service.findAll(
        { status: 'pending', deptId: 'dept-1', keyword: '员工A', cycleId: 'cycle-1' },
        pagination,
      );

      expect(result.total).toBe(1);
      expect(result.items[0]).not.toHaveProperty('coefficient');
      expect(result.items[0].appellant?.name).toBe('员工A');
      expect(prisma.appeal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            cycleId: 'cycle-1',
            status: 'pending',
            task: { deptId: 'dept-1' },
            appellant: { name: { contains: '员工A', mode: 'insensitive' } },
          }),
          skip: 0,
          take: 20,
        }),
      );
    });
  });

  describe('findOne', () => {
    it('返回详情且不含 coefficient', async () => {
      prisma.appeal.findUnique.mockResolvedValue({
        id: 'appeal-1',
        taskId: 'task-1',
        cycleId: 'cycle-1',
        appellantId: 'emp-1',
        reason: '异议',
        attachments: [],
        status: 'resolved',
        deptResolution: null,
        deptResolvedAt: null,
        deptResolverId: null,
        hrResolution: '维持原判',
        hrResolvedAt: new Date(),
        hrResolverId: 'hr-1',
        finalResult: 'maintained',
        appealDeadline: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        appellant: { id: 'emp-1', name: '员工A' },
        task: {
          dept: { id: 'dept-1', name: '研发部' },
          gradeResult: {
            calculatedScore: new Prisma.Decimal(85),
            rawGrade: 'B',
            calibratedGrade: 'B',
          },
        },
        cycle: { id: 'cycle-1', name: '2026Q1' },
      });

      const result = await service.findOne('appeal-1');

      expect(result.id).toBe('appeal-1');
      expect(result.taskGrade?.calibratedGrade).toBe('B');
      expect(result).not.toHaveProperty('coefficient');
    });

    it('申诉不存在时抛 404', async () => {
      prisma.appeal.findUnique.mockResolvedValue(null);
      await expect(service.findOne('not-exist')).rejects.toThrow(NotFoundException);
    });
  });

  describe('resolve', () => {
    it('maintained 只记录不动 GradeResult', async () => {
      prisma.appeal.findUnique.mockResolvedValue({
        id: 'appeal-1',
        taskId: 'task-1',
        cycleId: 'cycle-1',
        status: 'pending',
        task: {
          id: 'task-1',
          employeeId: 'emp-1',
          gradeResult: makeGradeResult(),
          employee: { id: 'emp-1', name: '员工A' },
          dept: { id: 'dept-1', name: '研发部' },
        },
        cycle: { id: 'cycle-1', name: '2026Q1' },
      });
      prisma.appeal.update.mockResolvedValue({
        id: 'appeal-1',
        taskId: 'task-1',
        cycleId: 'cycle-1',
        status: 'resolved',
        hrResolution: '维持原判',
        hrResolvedAt: new Date(),
        hrResolverId: 'hr-1',
        finalResult: 'maintained',
        appellant: { id: 'emp-1', name: '员工A' },
        task: {
          dept: { id: 'dept-1', name: '研发部' },
          gradeResult: {
            calculatedScore: new Prisma.Decimal(85),
            rawGrade: 'B',
            calibratedGrade: 'B',
          },
        },
        cycle: { id: 'cycle-1', name: '2026Q1' },
      });

      const result = await service.resolve(
        'appeal-1',
        { resolution: '维持原判', result: AppealResult.maintained },
        viewer,
      );

      expect(result.status).toBe('resolved');
      expect(result.finalResult).toBe('maintained');
      expect(prisma.gradeResult.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'resolve_appeal',
            entityType: 'appeal',
            newValue: expect.objectContaining({ result: 'maintained' }),
          }),
        }),
      );
    });

    it('modified 缺 newGrade 返回 4001', async () => {
      prisma.appeal.findUnique.mockResolvedValue({
        id: 'appeal-1',
        taskId: 'task-1',
        cycleId: 'cycle-1',
        status: 'pending',
        task: {
          id: 'task-1',
          employeeId: 'emp-1',
          gradeResult: makeGradeResult(),
          employee: { id: 'emp-1', name: '员工A' },
          dept: { id: 'dept-1', name: '研发部' },
        },
        cycle: { id: 'cycle-1', name: '2026Q1' },
      });

      await expect(
        service.resolve('appeal-1', { resolution: '改判', result: AppealResult.modified }, viewer),
      ).rejects.toThrow(BadRequestException);
    });

    it('modified 正确改等级、重算系数、写 AuditLog、同步 archive', async () => {
      prisma.appeal.findUnique.mockResolvedValue({
        id: 'appeal-1',
        taskId: 'task-1',
        cycleId: 'cycle-1',
        status: 'pending',
        task: {
          id: 'task-1',
          employeeId: 'emp-1',
          gradeResult: makeGradeResult(),
          employee: { id: 'emp-1', name: '员工A' },
          dept: { id: 'dept-1', name: '研发部' },
        },
        cycle: { id: 'cycle-1', name: '2026Q1' },
      });
      prisma.performanceArchive.findUnique.mockResolvedValue({
        id: 'archive-1',
        employeeId: 'emp-1',
        cycleId: 'cycle-1',
      });
      prisma.appeal.update.mockResolvedValue({
        id: 'appeal-1',
        taskId: 'task-1',
        cycleId: 'cycle-1',
        status: 'resolved',
        hrResolution: '改判为 A',
        hrResolvedAt: new Date(),
        hrResolverId: 'hr-1',
        finalResult: 'modified',
        appellant: { id: 'emp-1', name: '员工A' },
        task: {
          dept: { id: 'dept-1', name: '研发部' },
          gradeResult: {
            calculatedScore: new Prisma.Decimal(85),
            rawGrade: 'B',
            calibratedGrade: 'A',
          },
        },
        cycle: { id: 'cycle-1', name: '2026Q1' },
      });

      const result = await service.resolve(
        'appeal-1',
        { resolution: '改判为 A', result: AppealResult.modified, newGrade: 'A' },
        viewer,
      );

      expect(result.status).toBe('resolved');
      expect(result.finalResult).toBe('modified');
      expect(result.taskGrade?.calibratedGrade).toBe('A');

      expect(prisma.gradeResult.update).toHaveBeenCalledWith({
        where: { taskId: 'task-1' },
        data: expect.objectContaining({
          calibratedGrade: 'A',
          coefficient: expect.any(Prisma.Decimal),
        }),
      });

      expect(prisma.performanceArchive.update).toHaveBeenCalledWith({
        where: { id: 'archive-1' },
        data: expect.objectContaining({
          grade: 'A',
          coefficient: expect.any(Prisma.Decimal),
        }),
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'resolve_appeal',
            oldValue: expect.objectContaining({ calibratedGrade: 'B', coefficient: 1 }),
            newValue: expect.objectContaining({ calibratedGrade: 'A', coefficient: 1.2 }),
          }),
        }),
      );
    });

    it('modified 未归档时不创建 archive', async () => {
      prisma.appeal.findUnique.mockResolvedValue({
        id: 'appeal-1',
        taskId: 'task-1',
        cycleId: 'cycle-1',
        status: 'pending',
        task: {
          id: 'task-1',
          employeeId: 'emp-1',
          gradeResult: makeGradeResult(),
          employee: { id: 'emp-1', name: '员工A' },
          dept: { id: 'dept-1', name: '研发部' },
        },
        cycle: { id: 'cycle-1', name: '2026Q1' },
      });
      prisma.performanceArchive.findUnique.mockResolvedValue(null);
      prisma.appeal.update.mockResolvedValue({
        id: 'appeal-1',
        taskId: 'task-1',
        cycleId: 'cycle-1',
        status: 'resolved',
        finalResult: 'modified',
        appellant: { id: 'emp-1', name: '员工A' },
        task: {
          dept: { id: 'dept-1', name: '研发部' },
          gradeResult: {
            calculatedScore: new Prisma.Decimal(85),
            rawGrade: 'B',
            calibratedGrade: 'A',
          },
        },
        cycle: { id: 'cycle-1', name: '2026Q1' },
      });

      await service.resolve(
        'appeal-1',
        { resolution: '改判为 A', result: AppealResult.modified, newGrade: 'A' },
        viewer,
      );

      expect(prisma.performanceArchive.update).not.toHaveBeenCalled();
    });

    it('已 resolved 再次 resolve 返回 4009', async () => {
      prisma.appeal.findUnique.mockResolvedValue({
        id: 'appeal-1',
        taskId: 'task-1',
        cycleId: 'cycle-1',
        status: 'resolved',
        task: {
          id: 'task-1',
          employeeId: 'emp-1',
          gradeResult: makeGradeResult(),
          employee: { id: 'emp-1', name: '员工A' },
          dept: { id: 'dept-1', name: '研发部' },
        },
        cycle: { id: 'cycle-1', name: '2026Q1' },
      });

      await expect(
        service.resolve(
          'appeal-1',
          { resolution: '再判', result: AppealResult.maintained },
          viewer,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
});
