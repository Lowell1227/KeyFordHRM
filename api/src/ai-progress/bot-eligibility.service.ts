import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountType, ExternalIdentityProvider, ExternalIdentityStatus } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { AuthUser } from '../common/types/auth.types';
import { DingtalkService } from '../dingtalk/dingtalk.service';
import { BotGoalCandidate } from '../objectives/bot-goal-access.types';
import { ObjectivesService } from '../objectives/objectives.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiConfigService } from './ai-config.service';

export interface BotSender {
  corpId: string;
  senderStaffId: string;
  conversationId: string;
  conversationType: string;
  deliveryId: string;
}

@Injectable()
export class BotEligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly aiConfig: AiConfigService,
    private readonly auth: AuthService,
    private readonly dingtalk: DingtalkService,
    private readonly objectives: ObjectivesService,
  ) {}

  async resolve(sender: BotSender): Promise<
    { kind: 'ready'; viewer: AuthUser; goals: BotGoalCandidate[] } | { kind: 'reply'; text: string }
  > {
    const identity = await this.resolveIdentity(sender);
    if (identity.kind === 'reply') return identity;
    const access = await this.objectives.findBotGoalAccess(identity.viewer);
    return access.kind === 'ready'
      ? { ...identity, goals: access.goals }
      : { kind: 'reply', text: access.message };
  }

  async resolveIdentity(sender: BotSender): Promise<
    { kind: 'ready'; viewer: AuthUser } | { kind: 'reply'; text: string }
  > {
    const corpId = this.config.get<string>('DINGTALK_CORP_ID');
    if (!corpId || sender.corpId !== corpId || sender.conversationType !== '1'
      || !sender.senderStaffId?.trim() || !sender.conversationId?.trim() || !sender.deliveryId?.trim()) {
      return { kind: 'reply', text: '请在本企业的机器人单聊中更新目标进展。' };
    }
    const state = await this.aiConfig.getPublicState();
    if (!state.botEnabled) return { kind: 'reply', text: '功能暂未开放' };

    const unavailable = { kind: 'reply' as const, text: '账号未开通或已停用，请联系管理员核对钉钉绑定和有效任职。' };
    let binding = await this.prisma.externalIdentityBinding.findFirst({
      where: { provider: ExternalIdentityProvider.dingtalk, externalUserId: sender.senderStaffId, endedAt: null },
      include: { user: true },
    });
    if (!binding) {
      let unionId: string;
      try {
        unionId = (await this.dingtalk.fetchUserDetail(sender.senderStaffId)).unionid;
      } catch {
        return unavailable;
      }
      if (!unionId?.trim()) return unavailable;
      binding = await this.prisma.externalIdentityBinding.findFirst({
        where: { provider: ExternalIdentityProvider.dingtalk, externalUnionId: unionId, endedAt: null },
        include: { user: true },
      });
    }
    if (!binding || binding.status !== ExternalIdentityStatus.enabled || binding.endedAt) return unavailable;
    if (!state.allowlist.includes(binding.user.id)) return { kind: 'reply', text: '功能暂未开放' };
    if (binding.user.accountType !== AccountType.employee) return unavailable;
    try {
      await this.auth.assertLoginEligibility(binding.user);
    } catch (error) {
      if (error instanceof UnauthorizedException) return unavailable;
      throw error;
    }
    const user = binding.user;
    const viewer: AuthUser = {
      id: user.id, name: user.name, sysRole: user.sysRole, deptId: user.deptId,
      isAssessorOnly: user.isAssessorOnly, canViewAll: user.canViewAll,
      hrCapabilities: user.hrCapabilities ?? [],
    };
    return { kind: 'ready', viewer };
  }
}
