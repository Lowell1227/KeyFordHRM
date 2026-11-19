import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type TalentShare } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import type { AuthUser } from '@/common/types/auth.types';
import { paginated } from '@/common/dto/pagination.dto';
import { CURRENT_WORKER_STATUSES, currentWorkerWhere } from '@/common/personnel/current-worker';
import { approvedEmploymentSourceWhere, selectEmploymentAt, shanghaiBusinessDate } from '@/employee-archives/employment-timeline';
import { TALENT_GENDER_LABELS, TALENT_STATUS_LABELS } from './talent.constants';
import { CreateShareDto } from './dto/create-share.dto';
import { ShareRecipientQueryDto } from './dto/share-recipient-query.dto';
import { TalentsService } from './talents.service';

/** 被分享人视图（严格脱敏，需求 §5.4）：禁止手机号/邮箱/期望薪资/来源/备注/跟进记录。 */
export interface SharedCandidateView {
  name: string;
  gender: string | null;
  genderLabel: string | null;
  age: number | null;
  currentCompany: string | null;
  currentPosition: string | null;
  yearsOfExperience: number | null;
  education: string | null;
  school: string | null;
  major: string | null;
  expectCity: string | null;
  appliedPosition: string | null;
  tags: string[];
  status: string;
  statusLabel: string;
}

export interface ShareView {
  token: string;
  message: string | null;
  includeResume: boolean;
  expiresAt: Date;
  createdAt: Date;
  candidate: SharedCandidateView;
  files: Array<{ id: string; fileName: string; fileSize: number; mimeType: string }>;
}

/** 统一失效文案（前后端共用断言；不暴露候选人是否存在）。 */
export const SHARE_FORBIDDEN_MESSAGE = '链接已失效或无权查看';

@Injectable()
export class TalentSharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly talents: TalentsService,
  ) {}

  private async recipientWhere(tx: Prisma.TransactionClient = this.prisma): Promise<Prisma.UserWhereInput> {
    const today = shanghaiBusinessDate();
    const records = await tx.employmentRecord.findMany({
      where: {
        user: currentWorkerWhere,
        AND: [approvedEmploymentSourceWhere, { effectiveFrom: { lte: today } },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] }],
      },
      select: { id: true, userId: true, directManagerId: true, employeeStatus: true, effectiveFrom: true, effectiveTo: true, createdAt: true },
    });
    const byEmployee = new Map<string, typeof records>();
    for (const record of records) {
      const history = byEmployee.get(record.userId) ?? [];
      history.push(record);
      byEmployee.set(record.userId, history);
    }
    const rosterManagerIds = new Set<string>();
    for (const history of byEmployee.values()) {
      // User.directManagerId is the performance manager; roster authority is the selected employment.
      const current = selectEmploymentAt(history, today).current;
      if (current?.directManagerId && CURRENT_WORKER_STATUSES.includes(current.employeeStatus)) {
        rosterManagerIds.add(current.directManagerId);
      }
    }
    return {
      ...currentWorkerWhere,
      OR: [
        { sysRole: { in: ['hr', 'hr_user', 'system_admin'] } },
        { id: { in: [...rosterManagerIds].sort() } },
        { ledDepartments: { some: { isActive: true } } },
      ],
    };
  }

  async searchRecipients(query: ShareRecipientQueryDto) {
    const where = await this.recipientWhere();
    const keyword = query.keyword?.trim();
    if (keyword) {
      where.AND = [{ OR: [
        { name: { contains: keyword, mode: 'insensitive' } },
        { employeeNo: { contains: keyword, mode: 'insensitive' } },
      ] }];
    }
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: { id: true, name: true, employeeNo: true, dept: { select: { name: true } } },
        orderBy: [{ name: 'asc' }, { employeeNo: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize, take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(rows.map(row => ({ id: row.id, name: row.name, employeeNo: row.employeeNo, deptName: row.dept?.name ?? null })), total, query);
  }

  private async currentRecipients(ids: string[], tx: Prisma.TransactionClient = this.prisma) {
    return tx.user.findMany({
      where: { ...await this.recipientWhere(tx), id: { in: ids } },
      select: { id: true },
    });
  }

  /** HR 创建单条只读分享：指定接收人 + 有效期 + 可选附简历原件。 */
  async create(candidateId: string, input: CreateShareDto, operator: AuthUser) {
    if (new Set(input.recipientIds).size !== input.recipientIds.length) {
      throw new BadRequestException('接收人不能重复选择');
    }
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM talent_candidates WHERE id = ${candidateId}::uuid FOR UPDATE`;
        if (input.requestId) {
          const prior = await tx.talentShare.findUnique({ where: { requestId: input.requestId } });
          if (prior) return this.replay(prior, candidateId, input, operator);
        }
        const candidate = await tx.talentCandidate.findFirst({ where: { id: candidateId, deletedAt: null }, select: { id: true, name: true } });
        if (!candidate) throw new NotFoundException('候选人不存在或已删除');
        const recipients = await this.currentRecipients(input.recipientIds, tx);
        if (recipients.length !== input.recipientIds.length) {
          throw new BadRequestException('接收人资格已变化，请重新选择在职的 HR、实际主管或部门负责人');
        }
        const token = randomBytes(32).toString('hex');
        const createdAt = new Date();
        const expiresAt = new Date(createdAt.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000);
        const share = await tx.talentShare.create({
          data: { candidateId, requestId: input.requestId ?? null, token, recipientIds: [...input.recipientIds].sort(),
            includeResume: input.includeResume === true, message: input.message?.trim() || null,
            expiresAt, createdAt, createdById: operator.id },
        });
        // System records only: no external delivery is triggered by share creation.
        const title = `HR 分享了一位候选人：${candidate.name}`;
        const content = input.message?.trim()
          ? `${operator.name}：${input.message.trim()}`
          : `${operator.name} 分享了一位候选人，点击查看（有效期 ${input.expiresInDays} 天）。`;
        for (const recipient of recipients) {
          await tx.notificationLog.create({
            data: { userId: recipient.id, senderId: operator.id, type: 'talent_share', title, content,
              status: 'sent', channel: 'system', isRead: false, sentAt: createdAt, extraData: { token } },
          });
        }
        await tx.auditLog.create({ data: { userId: operator.id, action: 'create_talent_share',
          entityType: 'talent_share', entityId: share.id,
          newValue: { candidateId, recipientIds: input.recipientIds, includeResume: input.includeResume === true,
            expiresInDays: input.expiresInDays, requestId: input.requestId ?? null } } });
        return this.shareResult({ id: share.id, token, expiresAt });
      });
    } catch (error) {
      // The UUID is globally unique; a different candidate lock cannot serialize its reuse.
      if (input.requestId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const prior = await this.prisma.talentShare.findUnique({ where: { requestId: input.requestId } });
        if (prior) return this.replay(prior, candidateId, input, operator);
      }
      throw error;
    }
  }

  private replay(share: TalentShare, candidateId: string, input: CreateShareDto, operator: AuthUser) {
    const duration = share.expiresAt.getTime() - share.createdAt.getTime();
    if (share.candidateId.toLowerCase() !== candidateId.toLowerCase() || share.createdById.toLowerCase() !== operator.id.toLowerCase()
      || JSON.stringify(share.recipientIds.map(id => id.toLowerCase()).sort()) !== JSON.stringify(input.recipientIds.map(id => id.toLowerCase()).sort())
      || share.includeResume !== (input.includeResume === true) || share.message !== (input.message?.trim() || null)
      || duration !== input.expiresInDays * 24 * 60 * 60 * 1000) {
      throw new ConflictException('分享请求已用于其他内容，请重新发起分享');
    }
    return this.shareResult(share);
  }

  private shareResult(share: Pick<TalentShare, 'id' | 'token' | 'expiresAt'>) {
    return { id: share.id, token: share.token, url: `/talents/s/${share.token}`, expiresAt: share.expiresAt };
  }

  /** 撤销分享（写 revoked_at，幂等）。 */
  async revoke(shareId: string, operator: AuthUser) {
    const share = await this.prisma.talentShare.findUnique({ where: { id: shareId } });
    if (!share) throw new NotFoundException('分享不存在');
    if (share.revokedAt) return { id: share.id, revoked: true };
    await this.prisma.$transaction([
      this.prisma.talentShare.update({ where: { id: shareId }, data: { revokedAt: new Date() } }),
      this.prisma.auditLog.create({
        data: {
          userId: operator.id,
          action: 'revoke_talent_share',
          entityType: 'talent_share',
          entityId: shareId,
          oldValue: { candidateId: share.candidateId } as Prisma.InputJsonValue,
        },
      }),
    ]);
    return { id: share.id, revoked: true };
  }

  /** 被分享人打开：校验登录态在 controller，这里校验白名单/有效期/撤销/软删，命中则累计查看。 */
  async resolve(token: string, user: AuthUser): Promise<ShareView> {
    const share = await this.findUsableShare(token);
    if (!share.recipientIds.includes(user.id)) throw new ForbiddenException(SHARE_FORBIDDEN_MESSAGE);
    if ((await this.currentRecipients([user.id])).length !== 1) throw new ForbiddenException(SHARE_FORBIDDEN_MESSAGE);
    await this.prisma.talentShare.update({
      where: { id: share.id },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date(), lastViewedById: user.id },
    });
    const candidate = share.candidate;
    const now = new Date();
    return {
      token: share.token,
      message: share.message,
      includeResume: share.includeResume,
      expiresAt: share.expiresAt,
      createdAt: share.createdAt,
      candidate: {
        name: candidate.name,
        gender: candidate.gender,
        genderLabel: candidate.gender ? TALENT_GENDER_LABELS[candidate.gender as keyof typeof TALENT_GENDER_LABELS] ?? null : null,
        age: candidate.birthYear ? now.getFullYear() - candidate.birthYear : null,
        currentCompany: candidate.currentCompany,
        currentPosition: candidate.currentPosition,
        yearsOfExperience: candidate.yearsOfExperience,
        education: candidate.education,
        school: candidate.school,
        major: candidate.major,
        expectCity: candidate.expectCity,
        appliedPosition: candidate.appliedPosition,
        tags: candidate.tags,
        status: candidate.status,
        statusLabel: TALENT_STATUS_LABELS[candidate.status as keyof typeof TALENT_STATUS_LABELS] ?? candidate.status,
      },
      files: share.includeResume
        ? candidate.files.map((file) => ({ id: file.id, fileName: file.fileName, fileSize: file.fileSize, mimeType: file.mimeType }))
        : [],
    };
  }

  /** 被分享人下载简历原件：仅 includeResume=true 且文件属于该候选人。 */
  async resolveFile(token: string, fileId: string, user: AuthUser) {
    const share = await this.findUsableShare(token);
    if (!share.recipientIds.includes(user.id)) throw new ForbiddenException(SHARE_FORBIDDEN_MESSAGE);
    if ((await this.currentRecipients([user.id])).length !== 1) throw new ForbiddenException(SHARE_FORBIDDEN_MESSAGE);
    if (!share.includeResume) throw new ForbiddenException(SHARE_FORBIDDEN_MESSAGE);
    const file = share.candidate.files.find((item) => item.id === fileId);
    if (!file) throw new NotFoundException('简历文件不存在');
    return file.objectKey;
  }

  /** 统一失效入口：找不到 / 已过期 / 已撤销 / 候选人已软删 → 一律 403，不暴露候选人信息。 */
  private async findUsableShare(token: string) {
    const share = await this.prisma.talentShare.findUnique({
      where: { token },
      include: { candidate: { include: { files: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } } } },
    });
    if (!share
      || share.candidate.deletedAt !== null
      || share.revokedAt !== null
      || share.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException(SHARE_FORBIDDEN_MESSAGE);
    }
    return share;
  }
}
