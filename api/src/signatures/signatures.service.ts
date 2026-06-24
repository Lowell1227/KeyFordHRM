import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  Signature,
  SignatureBusinessType,
  SignatureMethod,
  SignatureRole,
  SysRole,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { CreateSignatureDto } from './dto/create-signature.dto';
import { SignatureQueryDto } from './dto/signature-query.dto';

/** 签字视图项（前端展示用）。 */
export interface SignatureItem {
  id: string;
  businessType: SignatureBusinessType;
  businessRecordId: string;
  role: SignatureRole;
  signerId: string;
  signerName: string;
  signedAt: Date;
  method: SignatureMethod;
  imageUrl: string | null;
}

@Injectable()
export class SignaturesService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /signatures — 查询某一业务记录的三方签字状态。 */
  async findAll(query: SignatureQueryDto, viewer: AuthUser): Promise<SignatureItem[]> {
    await this.assertCanView(query.businessType, query.businessRecordId, viewer);

    const signatures = await this.prisma.signature.findMany({
      where: {
        businessType: query.businessType,
        businessRecordId: query.businessRecordId,
      },
      include: {
        signer: { select: { id: true, name: true } },
      },
      orderBy: { signedAt: 'asc' },
    });

    return signatures.map((s) => this.mapToItem(s));
  }

  /** POST /signatures — 在线签字（幂等：同一记录+角色仅保留一条）。 */
  async create(dto: CreateSignatureDto, viewer: AuthUser): Promise<SignatureItem> {
    await this.assertCanSignAs(dto.businessType, dto.businessRecordId, dto.role, viewer);

    const method = dto.method ?? (dto.imageUrl ? SignatureMethod.handwritten_image : SignatureMethod.online_confirm);
    const idempotencyKey = dto.idempotencyKey ?? this.buildIdempotencyKey(dto);

    const result = await this.prisma.$transaction(async (tx) => {
      // 先查：已存在则直接返回，保证幂等（不产生第二条，也不重复写 AuditLog）
      const existing = await tx.signature.findUnique({
        where: {
          businessType_businessRecordId_role: {
            businessType: dto.businessType,
            businessRecordId: dto.businessRecordId,
            role: dto.role,
          },
        },
        include: { signer: { select: { id: true, name: true } } },
      });

      if (existing) {
        return { signature: existing, isNew: false };
      }

      const created = await tx.signature.create({
        data: {
          businessType: dto.businessType,
          businessRecordId: dto.businessRecordId,
          role: dto.role,
          signerId: viewer.id,
          method,
          idempotencyKey,
          imageUrl: dto.imageUrl ?? null,
        },
        include: { signer: { select: { id: true, name: true } } },
      });

      await tx.auditLog.create({
        data: {
          userId: viewer.id,
          action: 'sign',
          entityType: 'signature',
          entityId: created.id,
          newValue: {
            businessType: created.businessType,
            businessRecordId: created.businessRecordId,
            role: created.role,
            signerId: created.signerId,
            method: created.method,
            idempotencyKey: created.idempotencyKey,
            imageUrl: created.imageUrl,
          } as Prisma.InputJsonValue,
        },
      });

      return { signature: created, isNew: true };
    });

    return this.mapToItem(result.signature);
  }

  private mapToItem(signature: Signature & { signer: { id: string; name: string } }): SignatureItem {
    return {
      id: signature.id,
      businessType: signature.businessType,
      businessRecordId: signature.businessRecordId,
      role: signature.role,
      signerId: signature.signerId,
      signerName: signature.signer.name,
      signedAt: signature.signedAt,
      method: signature.method,
      imageUrl: signature.imageUrl,
    };
  }

  private buildIdempotencyKey(dto: CreateSignatureDto): string {
    return `${dto.businessType}:${dto.businessRecordId}:${dto.role}`;
  }

  /** 查看权限：按真实身份判定，不是粗角色门。 */
  private async assertCanView(
    businessType: SignatureBusinessType,
    businessRecordId: string,
    viewer: AuthUser,
  ): Promise<void> {
    switch (businessType) {
      case SignatureBusinessType.assessment_task:
        await this.assertCanViewAssessmentTask(businessRecordId, viewer);
        return;
      case SignatureBusinessType.probation_task:
        await this.assertCanViewProbationTask(businessRecordId, viewer);
        return;
      case SignatureBusinessType.interview:
      default:
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: `暂不支持的签字业务类型：${businessType}`,
        });
    }
  }

  /** 签字权限：角色位按真实身份校验。 */
  private async assertCanSignAs(
    businessType: SignatureBusinessType,
    businessRecordId: string,
    role: SignatureRole,
    viewer: AuthUser,
  ): Promise<void> {
    // 必须先有查看权
    await this.assertCanView(businessType, businessRecordId, viewer);

    switch (businessType) {
      case SignatureBusinessType.assessment_task:
        await this.assertCanSignAssessmentTask(businessRecordId, role, viewer);
        return;
      case SignatureBusinessType.probation_task:
        await this.assertCanSignProbationTask(businessRecordId, role, viewer);
        return;
      default:
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: `暂不支持的签字业务类型：${businessType}`,
        });
    }
  }

  private async assertCanViewAssessmentTask(businessRecordId: string, viewer: AuthUser): Promise<void> {
    const task = await this.prisma.assessmentTask.findUnique({
      where: { id: businessRecordId },
      select: {
        employeeId: true,
        managerId: true,
        deptHeadId: true,
        approverId: true,
      },
    });

    if (!task) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '考核任务不存在',
      });
    }

    const canView =
      task.employeeId === viewer.id ||
      task.managerId === viewer.id ||
      task.deptHeadId === viewer.id ||
      task.approverId === viewer.id ||
      viewer.sysRole === SysRole.hr ||
      viewer.sysRole === SysRole.system_admin ||
      viewer.canViewAll;

    if (!canView) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '无权限查看该记录的签字信息',
      });
    }
  }

  private async assertCanSignAssessmentTask(
    businessRecordId: string,
    role: SignatureRole,
    viewer: AuthUser,
  ): Promise<void> {
    const task = await this.prisma.assessmentTask.findUnique({
      where: { id: businessRecordId },
      select: { employeeId: true, managerId: true },
    });

    if (!task) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '考核任务不存在',
      });
    }

    if (role === SignatureRole.assessee && task.employeeId !== viewer.id) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '仅被考核人本人可签署',
      });
    }

    if (role === SignatureRole.assessor && task.managerId !== viewer.id) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '仅考核人（主管）本人可签署',
      });
    }

    if (role === SignatureRole.hr && viewer.sysRole !== SysRole.hr && viewer.sysRole !== SysRole.system_admin) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '仅 HR 可签署',
      });
    }
  }

  private async assertCanViewProbationTask(businessRecordId: string, viewer: AuthUser): Promise<void> {
    const review = await this.prisma.probationReview.findUnique({
      where: { id: businessRecordId },
      select: { employeeId: true, managerId: true, hrId: true },
    });

    if (!review) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '试用期考核不存在',
      });
    }

    const canView =
      review.employeeId === viewer.id ||
      review.managerId === viewer.id ||
      review.hrId === viewer.id ||
      viewer.sysRole === SysRole.hr ||
      viewer.sysRole === SysRole.system_admin ||
      viewer.canViewAll;

    if (!canView) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '无权限查看该试用期考核的签字信息',
      });
    }
  }

  private async assertCanSignProbationTask(
    businessRecordId: string,
    role: SignatureRole,
    viewer: AuthUser,
  ): Promise<void> {
    const review = await this.prisma.probationReview.findUnique({
      where: { id: businessRecordId },
      select: { employeeId: true, managerId: true },
    });

    if (!review) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '试用期考核不存在',
      });
    }

    if (role === SignatureRole.assessee && review.employeeId !== viewer.id) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '仅被考核员工本人可签署',
      });
    }

    if (role === SignatureRole.assessor && review.managerId !== viewer.id) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '仅指定主管可签署',
      });
    }

    if (role === SignatureRole.hr && viewer.sysRole !== SysRole.hr && viewer.sysRole !== SysRole.system_admin) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '仅 HR 可签署',
      });
    }
  }
}
