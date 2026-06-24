import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { assertTemplateWeights } from './templates.validation';
import { AuthUser } from '@/common/types/auth.types';
import { PaginationDto, paginated } from '@/common/dto/pagination.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  private assertApplicableNotEmpty(dto: { applicableDepts?: string[]; applicableUsers?: string[] }) {
    const depts = dto.applicableDepts ?? [];
    const users = dto.applicableUsers ?? [];
    if (depts.length === 0 && users.length === 0) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: 'applicableDepts 与 applicableUsers 不能同时为空',
      });
    }
  }

  private async assertNotLocked(templateId: string) {
    const count = await this.prisma.assessmentTemplateSnapshot.count({
      where: { templateId },
    });
    if (count > 0) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '该模板已被考核周期使用并生成任务，为保证历史考核记录一致，不能直接修改。请先复制模板，编辑副本后用于新的考核周期。',
      });
    }
  }

  private buildDimensionCreateInput(
    dimensions: CreateTemplateDto['dimensions'],
  ): Prisma.TemplateDimensionCreateWithoutTemplateInput[] {
    return dimensions.map((dim) => ({
      name: dim.name,
      weight: new Prisma.Decimal(dim.weight),
      type: dim.type,
      sortOrder: dim.sortOrder,
      indicators: {
        create: dim.indicators.map((ind) => ({
          indicatorId: ind.indicatorId ?? null,
          name: ind.name,
          description: ind.description ?? null,
          scoringStandard: ind.scoringStandard ?? null,
          dataSource: ind.dataSource ?? null,
          dataCaliber: ind.dataCaliber ?? null,
          targetValue: ind.targetValue != null ? new Prisma.Decimal(ind.targetValue) : null,
          unit: ind.unit ?? null,
          weight: new Prisma.Decimal(ind.weight),
          sortOrder: ind.sortOrder,
        })),
      },
    }));
  }

  private async findTemplateOrThrow(id: string) {
    const template = await this.prisma.assessmentTemplate.findUnique({
      where: { id },
      include: {
        dimensions: {
          orderBy: { sortOrder: 'asc' },
          include: {
            indicators: { orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    });
    if (!template || template.deletedAt != null) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '模板不存在' });
    }
    return template;
  }

  async create(dto: CreateTemplateDto, user: AuthUser) {
    this.assertApplicableNotEmpty(dto);
    assertTemplateWeights(dto.dimensions);

    const template = await this.prisma.assessmentTemplate.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        applicableDepts: dto.applicableDepts,
        applicableUsers: dto.applicableUsers,
        maxScore: new Prisma.Decimal(dto.maxScore ?? 100),
        isActive: dto.isActive ?? true,
        version: 1,
        createdBy: user.id,
        dimensions: {
          create: this.buildDimensionCreateInput(dto.dimensions),
        },
      },
      include: {
        dimensions: {
          orderBy: { sortOrder: 'asc' },
          include: {
            indicators: { orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    });

    return template;
  }

  async findAll(query: { keyword?: string; isActive?: boolean } & PaginationDto) {
    const where: Prisma.AssessmentTemplateWhereInput = {
      deletedAt: null,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.keyword
        ? { name: { contains: query.keyword, mode: 'insensitive' } }
        : {}),
    };

    const [total, items, users] = await Promise.all([
      this.prisma.assessmentTemplate.count({ where }),
      this.prisma.assessmentTemplate.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: {
            select: {
              dimensions: true,
              snapshots: true,
            },
          },
        },
      }),
      this.prisma.user.findMany({
        where: {
          deletedAt: null,
          name: { not: '' },
        },
        select: { name: true },
      }),
    ]);

    const userNames = users.map((u) => u.name.trim()).filter((name) => name.length >= 2);
    const sortedItems = items
      .map((template, index) => ({
        template,
        index,
        hasRealPersonName: userNames.some((name) => template.name.includes(name)),
      }))
      .sort((a, b) => {
        if (a.hasRealPersonName !== b.hasRealPersonName) return a.hasRealPersonName ? -1 : 1;
        return a.index - b.index;
      })
      .slice(query.skip, query.skip + query.take)
      .map((item) => item.template);

    const mapped = await Promise.all(
      sortedItems.map(async (t) => {
        const indicatorCount = await this.prisma.templateIndicator.count({
          where: {
            dimension: { templateId: t.id },
          },
        });
        return {
          id: t.id,
          name: t.name,
          description: t.description,
          isActive: t.isActive,
          version: t.version,
          maxScore: t.maxScore,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          dimensionCount: t._count.dimensions,
          indicatorCount,
          isLocked: t._count.snapshots > 0,
          lockedUsageCount: t._count.snapshots,
          applicableDepts: t.applicableDepts,
          applicableUsers: t.applicableUsers,
        };
      }),
    );

    return paginated(mapped, total, query);
  }

  async findOne(id: string) {
    return this.findTemplateOrThrow(id);
  }

  async update(id: string, dto: UpdateTemplateDto) {
    await this.assertNotLocked(id);
    const existing = await this.findTemplateOrThrow(id);

    const dimensions = dto.dimensions ?? existing.dimensions.map((d) => ({
      name: d.name,
      type: d.type,
      weight: Number(d.weight),
      sortOrder: d.sortOrder,
      indicators: d.indicators.map((i) => ({
        indicatorId: i.indicatorId ?? undefined,
        name: i.name,
        description: i.description ?? undefined,
        scoringStandard: i.scoringStandard ?? undefined,
        dataSource: i.dataSource ?? undefined,
        dataCaliber: i.dataCaliber ?? undefined,
        targetValue: i.targetValue != null ? Number(i.targetValue) : undefined,
        unit: i.unit ?? undefined,
        weight: Number(i.weight),
        sortOrder: i.sortOrder,
      })),
    }));

    const applicableDepts = dto.applicableDepts ?? existing.applicableDepts;
    const applicableUsers = dto.applicableUsers ?? existing.applicableUsers;
    this.assertApplicableNotEmpty({ applicableDepts, applicableUsers });
    assertTemplateWeights(dimensions);

    const updated = await this.prisma.$transaction(async (tx) => {
      // 删除旧 dimensions（级联删除 indicators）
      await tx.templateDimension.deleteMany({
        where: { templateId: id },
      });

      return tx.assessmentTemplate.update({
        where: { id },
        data: {
          name: dto.name ?? existing.name,
          description: dto.description !== undefined ? (dto.description ?? null) : existing.description,
          applicableDepts,
          applicableUsers,
          maxScore: dto.maxScore != null ? new Prisma.Decimal(dto.maxScore) : existing.maxScore,
          isActive: dto.isActive ?? existing.isActive,
          version: { increment: 1 },
          dimensions: {
            create: this.buildDimensionCreateInput(dimensions),
          },
        },
        include: {
          dimensions: {
            orderBy: { sortOrder: 'asc' },
            include: {
              indicators: { orderBy: { sortOrder: 'asc' } },
            },
          },
        },
      });
    });

    return updated;
  }

  async duplicate(id: string, user: AuthUser) {
    const existing = await this.findTemplateOrThrow(id);

    const newTemplate = await this.prisma.$transaction(async (tx) => {
      return tx.assessmentTemplate.create({
        data: {
          name: `${existing.name}-副本`,
          description: existing.description,
          applicableDepts: existing.applicableDepts,
          applicableUsers: existing.applicableUsers,
          maxScore: existing.maxScore,
          isActive: true,
          version: 1,
          createdBy: user.id,
          dimensions: {
            create: existing.dimensions.map((dim) => ({
              name: dim.name,
              weight: dim.weight,
              type: dim.type,
              sortOrder: dim.sortOrder,
              indicators: {
                create: dim.indicators.map((ind) => ({
                  indicatorId: ind.indicatorId,
                  name: ind.name,
                  description: ind.description,
                  scoringStandard: ind.scoringStandard,
                  dataSource: ind.dataSource,
                  dataCaliber: ind.dataCaliber,
                  targetValue: ind.targetValue,
                  unit: ind.unit,
                  weight: ind.weight,
                  sortOrder: ind.sortOrder,
                })),
              },
            })),
          },
        },
        include: {
          dimensions: {
            orderBy: { sortOrder: 'asc' },
            include: {
              indicators: { orderBy: { sortOrder: 'asc' } },
            },
          },
        },
      });
    });

    return newTemplate;
  }

  async removeMany(ids: string[]) {
    const uniqueIds = Array.from(new Set(ids));
    const result = await this.prisma.assessmentTemplate.updateMany({
      where: {
        id: { in: uniqueIds },
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });

    return {
      deletedCount: result.count,
    };
  }
}
