import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { PersonnelReferenceData } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import type { AuthUser } from '@/common/types/auth.types';
import {
  CreatePersonnelReferenceDataDto,
  PersonnelReferenceDataQueryDto,
  UpdatePersonnelReferenceDataDto,
} from './personnel-reference-data.dto';
import { assertPersonnelReferenceDataAccess } from './personnel-reference-data.permissions';

type ReferenceDataSnapshot = Pick<
  PersonnelReferenceData,
  'id' | 'kind' | 'name' | 'isActive'
>;

@Injectable()
export class PersonnelReferenceDataService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    rawKind: string,
    query: PersonnelReferenceDataQueryDto,
    operator: AuthUser,
  ) {
    const kind = assertPersonnelReferenceDataAccess(operator, rawKind, false);
    if (
      query.includeInactive !== undefined &&
      typeof query.includeInactive !== 'boolean'
    )
      throw new BadRequestException('启用状态筛选无效');
    return this.prisma.personnelReferenceData.findMany({
      where: {
        kind,
        ...(query.includeInactive === true ? {} : { isActive: true }),
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async create(
    kind: string,
    input: CreatePersonnelReferenceDataDto,
    operator: AuthUser,
  ) {
    return this.write(kind, null, input, operator);
  }

  async update(
    kind: string,
    id: string,
    input: UpdatePersonnelReferenceDataDto,
    operator: AuthUser,
  ) {
    if (!isUUID(id)) throw new BadRequestException('基础资料ID无效');
    return this.write(kind, id, input, operator);
  }

  private async write(
    rawKind: string,
    id: string | null,
    input: UpdatePersonnelReferenceDataDto,
    operator: AuthUser,
  ) {
    const kind = assertPersonnelReferenceDataAccess(operator, rawKind, true);
    const name = typeof input.name === 'string' ? input.name.trim() : undefined;
    if ((!id || input.name !== undefined) && (!name || [...name].length > 100))
      throw new BadRequestException('基础资料名称须为1至100字');
    if (input.isActive !== undefined && typeof input.isActive !== 'boolean')
      throw new BadRequestException('启用状态无效');
    if (id && input.name === undefined && input.isActive === undefined)
      throw new BadRequestException('请填写名称或启用状态');
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Lock before reading the audit snapshot so concurrent patches form one continuous history.
        const before = id
          ? (
              await tx.$queryRaw<ReferenceDataSnapshot[]>`
          SELECT "id", "kind", "name", "is_active" AS "isActive"
          FROM "personnel_reference_data"
          WHERE "id" = ${id}::uuid AND "kind" = ${kind}::"personnel_reference_data_kind"
          FOR UPDATE`
            )[0]
          : null;
        if (id && (!before || before.kind !== kind))
          throw new NotFoundException('基础资料不存在');
        const result = id
          ? await tx.personnelReferenceData.update({
              where: { id },
              data: {
                ...(name !== undefined ? { name } : {}),
                ...(input.isActive !== undefined
                  ? { isActive: input.isActive }
                  : {}),
              },
            })
          : await tx.personnelReferenceData.create({
              data: { kind, name: name! },
            });
        await tx.auditLog.create({
          data: {
            userId: operator.id,
            action: id
              ? 'update_personnel_reference_data'
              : 'create_personnel_reference_data',
            entityType: 'personnel_reference_data',
            entityId: result.id,
            ...(before
              ? {
                  oldValue: {
                    kind,
                    name: before.name,
                    isActive: before.isActive,
                  },
                }
              : {}),
            newValue: { kind, name: result.name, isActive: result.isActive },
          },
        });
        return result;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002')
        throw new ConflictException('该名称已存在');
      throw error;
    }
  }
}
