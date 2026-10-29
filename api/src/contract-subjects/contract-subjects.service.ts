import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { AuthUser } from '@/common/types/auth.types';
import { ContractSubjectQueryDto, CreateContractSubjectDto, UpdateContractSubjectDto } from './contract-subjects.dto';

@Injectable()
export class ContractSubjectsService {
  constructor(private readonly prisma: PrismaService) {}
  findAll(query: ContractSubjectQueryDto) {
    return this.prisma.contractSubject.findMany({ where: query.includeInactive === true ? {} : { isActive: true }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  }
  create(input: CreateContractSubjectDto, operator: AuthUser) { return this.write(null, input, operator); }
  update(id: string, input: UpdateContractSubjectDto, operator: AuthUser) { return this.write(id, input, operator); }
  private async write(id: string | null, input: UpdateContractSubjectDto, operator: AuthUser) {
    const name = input.name?.trim();
    if ((!id || input.name !== undefined) && (!name || name.length > 150)) throw new BadRequestException('合同主体名称须为1至150字');
    if (input.isActive !== undefined && typeof input.isActive !== 'boolean') throw new BadRequestException('启用状态无效');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = id ? await tx.contractSubject.findUnique({ where: { id } }) : null;
        if (id && !before) throw new NotFoundException('合同主体不存在');
        const data = { ...(name !== undefined ? { name } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) };
        const result = id ? await tx.contractSubject.update({ where: { id }, data }) : await tx.contractSubject.create({ data: { name: name! } });
        await tx.auditLog.create({ data: { userId: operator.id, action: id ? 'update_contract_subject' : 'create_contract_subject', entityType: 'contract_subject', entityId: result.id,
          ...(before ? { oldValue: { name: before.name, isActive: before.isActive } } : {}), newValue: { name: result.name, isActive: result.isActive } } });
        return result;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('合同主体名称已存在');
      throw error;
    }
  }
}
