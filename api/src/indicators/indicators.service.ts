import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { IndicatorType, Prisma } from '@prisma/client';
import { paginated, PaginationDto } from '@/common/dto/pagination.dto';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { CreateIndicatorDto } from './dto/create-indicator.dto';
import { UpdateIndicatorDto } from './dto/update-indicator.dto';
import { IndicatorQueryDto } from './dto/indicator-query.dto';
import { parseImportExcel, ImportRow, buildExportWorkbook, buildTemplateWorkbook } from './indicators.excel';

@Injectable()
export class IndicatorsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: IndicatorQueryDto) {
    const { type, category, groupName, keyword, isActive = true, page, pageSize, skip, take } = query;

    const where: Prisma.IndicatorWhereInput = {
      ...(type && { type }),
      ...(category && { category }),
      ...(groupName && { groupName }),
      ...(isActive !== undefined && { isActive }),
      ...(keyword && {
        OR: [
          { name: { contains: keyword, mode: 'insensitive' } },
          { code: { contains: keyword, mode: 'insensitive' } },
        ],
      }),
    };

    const [total, items] = await Promise.all([
      this.prisma.indicator.count({ where }),
      this.prisma.indicator.findMany({
        where,
        include: { creator: { select: { name: true } } },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return paginated(items, total, { page, pageSize } as PaginationDto);
  }

  async create(dto: CreateIndicatorDto, user: AuthUser) {
    if (dto.code) {
      const existing = await this.prisma.indicator.findUnique({
        where: { code: dto.code },
      });
      if (existing) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '指标编码已存在',
        });
      }
    }

    const data: Prisma.IndicatorCreateInput = {
      name: dto.name,
      code: dto.code,
      category: dto.category,
      type: dto.type,
      description: dto.description,
      scoringStandard: dto.scoringStandard,
      dataSource: dto.dataSource,
      dataCaliber: dto.dataCaliber,
      targetValue: dto.targetValue !== undefined ? new Prisma.Decimal(dto.targetValue) : undefined,
      unit: dto.unit,
      groupName: dto.groupName,
      isActive: dto.isActive ?? true,
      creator: { connect: { id: user.id } },
    };

    return this.prisma.indicator.create({
      data,
      include: { creator: { select: { name: true } } },
    });
  }

  async update(id: string, dto: UpdateIndicatorDto) {
    const indicator = await this.prisma.indicator.findUnique({ where: { id } });
    if (!indicator) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '指标不存在',
      });
    }

    if (dto.code && dto.code !== indicator.code) {
      const existing = await this.prisma.indicator.findUnique({
        where: { code: dto.code },
      });
      if (existing) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '指标编码已存在',
        });
      }
    }

    const data: Prisma.IndicatorUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.code !== undefined && { code: dto.code }),
      ...(dto.category !== undefined && { category: dto.category }),
      ...(dto.type !== undefined && { type: dto.type }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.scoringStandard !== undefined && { scoringStandard: dto.scoringStandard }),
      ...(dto.dataSource !== undefined && { dataSource: dto.dataSource }),
      ...(dto.dataCaliber !== undefined && { dataCaliber: dto.dataCaliber }),
      ...(dto.targetValue !== undefined && { targetValue: new Prisma.Decimal(dto.targetValue) }),
      ...(dto.unit !== undefined && { unit: dto.unit }),
      ...(dto.groupName !== undefined && { groupName: dto.groupName }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };

    return this.prisma.indicator.update({
      where: { id },
      data,
      include: { creator: { select: { name: true } } },
    });
  }

  async import(file: any, user: AuthUser) {
    if (!file) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '请上传文件',
      });
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '文件大小不能超过5MB',
      });
    }
    const isXlsx =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.originalname.toLowerCase().endsWith('.xlsx');
    if (!isXlsx) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '仅支持 xlsx 格式文件',
      });
    }

    const rows = await parseImportExcel(file.buffer);
    const failed: Array<{ row: number; reason: string }> = [];
    const validRows: Array<{ row: number; data: ImportRow & { type: IndicatorType } }> = [];
    const fileCodeSet = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2; // header is row 1
      const row = rows[i];
      const reasons: string[] = [];

      if (!row.name || row.name.trim() === '') {
        reasons.push('名称不能为空');
      }
      if (!row.type) {
        reasons.push('指标类型无效');
      }
      if (row.targetValueInvalid) {
        reasons.push('参考目标值必须为数字');
      }
      if (row.code) {
        if (fileCodeSet.has(row.code)) {
          reasons.push('文件中编码重复');
        } else {
          fileCodeSet.add(row.code);
        }
      }

      if (reasons.length > 0) {
        failed.push({ row: rowNumber, reason: reasons.join('；') });
        continue;
      }

      validRows.push({ row: rowNumber, data: row as ImportRow & { type: IndicatorType } });
    }

    // Check DB conflicts for codes in batch
    if (validRows.length > 0) {
      const codes = validRows.map((r) => r.data.code).filter(Boolean) as string[];
      if (codes.length > 0) {
        const existing = await this.prisma.indicator.findMany({
          where: { code: { in: codes } },
          select: { code: true },
        });
        const existingCodes = new Set(existing.map((e) => e.code));
        for (const vr of validRows) {
          if (vr.data.code && existingCodes.has(vr.data.code)) {
            failed.push({ row: vr.row, reason: '编码已存在' });
          }
        }
      }
    }

    const toCreate = validRows.filter(
      (vr) => !failed.some((f) => f.row === vr.row),
    );

    if (toCreate.length > 0) {
      await this.prisma.$transaction(
        toCreate.map((vr) =>
          this.prisma.indicator.create({
            data: {
              name: vr.data.name,
              code: vr.data.code,
              type: vr.data.type,
              category: vr.data.category,
              groupName: vr.data.groupName,
              description: vr.data.description,
              scoringStandard: vr.data.scoringStandard,
              dataSource: this.toOptionalString(vr.data.dataSource),
              dataCaliber: this.toOptionalString(vr.data.dataCaliber),
              targetValue: vr.data.targetValue !== undefined ? new Prisma.Decimal(vr.data.targetValue) : undefined,
              unit: vr.data.unit,
              isActive: true,
              creator: { connect: { id: user.id } },
            },
          }),
        ),
      );
    }

    return {
      imported: toCreate.length,
      failed,
    };
  }

  async export(query: IndicatorQueryDto) {
    const { type, category, groupName, keyword, isActive = true } = query;

    const where: Prisma.IndicatorWhereInput = {
      ...(type && { type }),
      ...(category && { category }),
      ...(groupName && { groupName }),
      ...(isActive !== undefined && { isActive }),
      ...(keyword && {
        OR: [
          { name: { contains: keyword, mode: 'insensitive' } },
          { code: { contains: keyword, mode: 'insensitive' } },
        ],
      }),
    };

    const indicators = await this.prisma.indicator.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const exportRows = indicators.map((item) => ({
      code: item.code,
      name: item.name,
      type: item.type,
      category: item.category,
      groupName: item.groupName,
      description: item.description,
      scoringStandard: item.scoringStandard,
      dataSource: item.dataSource,
      dataCaliber: item.dataCaliber,
      targetValue: item.targetValue?.toNumber() ?? null,
      unit: item.unit,
    }));

    return buildExportWorkbook(exportRows);
  }

  async getTemplate() {
    return buildTemplateWorkbook();
  }

  private toOptionalString(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return String(value);
  }
}
