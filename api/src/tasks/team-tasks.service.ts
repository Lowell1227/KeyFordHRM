import { Injectable } from "@nestjs/common";
import { Prisma, TaskStatus } from "@prisma/client";
import { Paginated } from "@/common/dto/pagination.dto";
import { AuthUser } from "@/common/types/auth.types";
import { PrismaService } from "@/prisma/prisma.service";
import type { TaskListItem } from "./tasks.service";
import { TeamTaskQueryDto } from "./dto/team-task-query.dto";
import {
  getTeamStageState,
  getTeamStageStatuses,
  TEAM_STAGE_STATUSES,
  TeamStageState,
} from "./team-task-stage";

export interface TeamTaskCounts {
  all: number;
  notStarted: number;
  pending: number;
  completed: number;
  exempted: number;
}

export interface TeamTaskListItem extends TaskListItem {
  employeeNo: string | null;
  avatarUrl: string | null;
  position: string | null;
  stageState: TeamStageState;
}

export interface TeamTaskPage extends Paginated<TeamTaskListItem> {
  counts: TeamTaskCounts;
  facets: {
    departments: Array<{ id: string; name: string }>;
    employees: Array<{
      id: string;
      name: string;
      employeeNo: string | null;
      deptId: string | null;
    }>;
  };
}

@Injectable()
export class TeamTasksService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    dto: TeamTaskQueryDto,
    viewer: AuthUser,
  ): Promise<TeamTaskPage> {
    const authorizedWhere: Prisma.AssessmentTaskWhereInput = {
      managerId: viewer.id,
    };
    const filteredWhere = this.withFilters(authorizedWhere, dto);
    const facetWhere: Prisma.AssessmentTaskWhereInput = { ...authorizedWhere };

    if (dto.cycleId) {
      facetWhere.cycleId = dto.cycleId;
    }

    const itemWhere: Prisma.AssessmentTaskWhereInput = dto.stageState
      ? {
          ...filteredWhere,
          status: { in: [...getTeamStageStatuses(dto.stage, dto.stageState)] },
        }
      : filteredWhere;

    const [total, statusCounts, tasks, departmentTasks, employeeTasks] =
      await Promise.all([
        this.prisma.assessmentTask.count({ where: itemWhere }),
        this.prisma.assessmentTask.groupBy({
          by: ["status"],
          where: filteredWhere,
          _count: { status: true },
        }),
        this.prisma.assessmentTask.findMany({
          where: itemWhere,
          skip: dto.skip,
          take: dto.take,
          include: {
            employee: {
              select: {
                name: true,
                employeeNo: true,
                avatarUrl: true,
                position: true,
              },
            },
            cycle: { select: { name: true } },
            dept: { select: { name: true } },
            gradeResult: { select: { calculatedScore: true, rawGrade: true } },
          },
          orderBy: [{ cycle: { startDate: "desc" } }, { updatedAt: "desc" }],
        }),
        this.prisma.assessmentTask.findMany({
          where: facetWhere,
          distinct: ["deptId"],
          select: { dept: { select: { id: true, name: true } } },
          orderBy: { dept: { name: "asc" } },
        }),
        this.prisma.assessmentTask.findMany({
          where: facetWhere,
          distinct: ["employeeId"],
          select: {
            employee: {
              select: { id: true, name: true, employeeNo: true, deptId: true },
            },
          },
          orderBy: { employee: { name: "asc" } },
        }),
      ]);

    return {
      total,
      page: dto.page,
      pageSize: dto.pageSize,
      items: tasks.map((task) => this.toListItem(task, dto.stage)),
      counts: this.toCounts(statusCounts, dto.stage),
      facets: {
        departments: departmentTasks.flatMap((task) =>
          task.dept ? [task.dept] : [],
        ),
        employees: employeeTasks.map((task) => task.employee),
      },
    };
  }

  private withFilters(
    authorizedWhere: Prisma.AssessmentTaskWhereInput,
    dto: TeamTaskQueryDto,
  ): Prisma.AssessmentTaskWhereInput {
    const where: Prisma.AssessmentTaskWhereInput = { ...authorizedWhere };

    if (dto.cycleId) where.cycleId = dto.cycleId;
    if (dto.deptId) where.deptId = dto.deptId;
    if (dto.employeeId) where.employeeId = dto.employeeId;
    if (dto.keyword) {
      where.employee = {
        OR: [
          { name: { contains: dto.keyword, mode: "insensitive" } },
          { employeeNo: { contains: dto.keyword, mode: "insensitive" } },
        ],
      };
    }

    return where;
  }

  private toCounts(
    statusCounts: Array<{ status: TaskStatus; _count: { status: number } }>,
    stage: TeamTaskQueryDto["stage"],
  ): TeamTaskCounts {
    const byStatus = new Map(
      statusCounts.map(({ status, _count }) => [status, _count.status]),
    );
    const countStatuses = (statuses: readonly TaskStatus[]) =>
      statuses.reduce(
        (total, status) => total + (byStatus.get(status) ?? 0),
        0,
      );

    return {
      all: countStatuses(Object.values(TaskStatus)),
      notStarted: countStatuses(TEAM_STAGE_STATUSES[stage].not_started),
      pending: countStatuses(TEAM_STAGE_STATUSES[stage].pending),
      completed: countStatuses(TEAM_STAGE_STATUSES[stage].completed),
      exempted: countStatuses(getTeamStageStatuses(stage, "exempted")),
    };
  }

  private toListItem(
    task: Prisma.AssessmentTaskGetPayload<{
      include: {
        employee: {
          select: {
            name: true;
            employeeNo: true;
            avatarUrl: true;
            position: true;
          };
        };
        cycle: { select: { name: true } };
        dept: { select: { name: true } };
        gradeResult: { select: { calculatedScore: true; rawGrade: true } };
      };
    }>,
    stage: TeamTaskQueryDto["stage"],
  ): TeamTaskListItem {
    return {
      id: task.id,
      cycleId: task.cycleId,
      cycleName: task.cycle.name,
      employeeId: task.employeeId,
      employeeName: task.employee.name,
      deptId: task.deptId,
      deptName: task.dept?.name ?? null,
      managerId: task.managerId,
      status: task.status as TaskStatus,
      totalScore: task.gradeResult?.calculatedScore?.toNumber() ?? null,
      rawGrade: task.gradeResult?.rawGrade ?? null,
      updatedAt: task.updatedAt,
      employeeNo: task.employee.employeeNo,
      avatarUrl: task.employee.avatarUrl,
      position: task.employee.position,
      stageState: getTeamStageState(task.status, stage),
    };
  }
}
