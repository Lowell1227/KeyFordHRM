import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import type { AuthUser } from '@/common/types/auth.types';
import { TALENT_GENDER_LABELS, TALENT_STATUS_LABELS } from './talent.constants';
import { CreateShareDto } from './dto/create-share.dto';
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
/** 接收人可选角色范围（需求 §5.4）。 */
const RECIPIENT_ROLES = new Set(['dept_head', 'manager', 'hr', 'vp', 'system_admin']);

@Injectable()
export class TalentSharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly talents: TalentsService,
  ) {}

  /** HR 创建单条只读分享：指定接收人 + 有效期 + 可选附简历原件。 */
  async create(candidateId: string, input: CreateShareDto, operator: AuthUser) {
    const candidate = await this.talents.findActive(candidateId);
    const recipients = await this.prisma.user.findMany({
      where: { id: { in: input.recipientIds }, deletedAt: null },
      select: { id: true, name: true, sysRole: true },
    });
    if (recipients.length !== input.recipientIds.length) {
      throw new BadRequestException('部分接收人不存在或已删除，请重新选择');
    }
    const invalid = recipients.filter((user) => !RECIPIENT_ROLES.has(user.sysRole));
    if (invalid.length > 0) {
      throw new BadRequestException(`接收人须为部门负责人、经理、HR 或 VP：${invalid.map((user) => user.name).join('、')}`);
    }
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
    const share = await this.prisma.talentShare.create({
      data: {
        candidateId,
        token,
        recipientIds: input.recipientIds,
        includeResume: input.includeResume === true,
        message: input.message?.trim() || null,
        expiresAt,
        createdById: operator.id,
      },
    });
    // 站内通知（复用 NotificationLog，channel=system，不自动发钉钉）。
    const title = `HR 分享了一位候选人：${candidate.name}`;
    const content = input.message?.trim()
      ? `${operator.name}：${input.message.trim()}`
      : `${operator.name} 分享了一位候选人，点击查看（有效期 ${input.expiresInDays} 天）。`;
    for (const recipient of recipients) {
      await this.prisma.notificationLog.create({
        data: {
          userId: recipient.id,
          senderId: operator.id,
          type: 'talent_share',
          title,
          content,
          status: 'sent',
          channel: 'system',
          isRead: false,
          sentAt: new Date(),
          extraData: { token } as Prisma.InputJsonValue,
        },
      });
    }
    return { id: share.id, token, url: `/talents/s/${token}`, expiresAt };
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
