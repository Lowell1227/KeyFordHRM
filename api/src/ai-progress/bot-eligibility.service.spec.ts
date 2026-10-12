import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth/auth.service';
import { BotEligibilityService, BotSender } from './bot-eligibility.service';

const sender: BotSender = {
  corpId: 'corp', senderStaffId: 'staff', conversationId: 'chat',
  conversationType: '1', deliveryId: 'delivery',
};
const user = {
  id: 'employee', name: 'Employee', sysRole: 'employee', deptId: null,
  isAssessorOnly: false, canViewAll: false, hrCapabilities: [],
  status: 'active', accountType: 'employee', deletedAt: null, archivedAt: null,
};
const noProgress = '你当前没有可更新的绩效目标。如果你认为自己应参加本期考核，请联系绩效管理员核对参与范围。';

function setup() {
  const prisma = {
    externalIdentityBinding: { findFirst: jest.fn().mockResolvedValue({
      id: 'binding', status: 'enabled', endedAt: null, userId: user.id, user,
    }) },
    employmentRecord: { findFirst: jest.fn().mockResolvedValue({ id: 'job', employeeStatus: 'active' }) },
  };
  const config = new ConfigService({ DINGTALK_CORP_ID: 'corp' });
  const aiConfig = { getPublicState: jest.fn().mockResolvedValue({ botEnabled: true, allowlist: [user.id] }) };
  const dingtalk = { fetchUserDetail: jest.fn().mockResolvedValue({ userid: 'staff', unionid: 'union' }) };
  const objectives = { findBotGoalAccess: jest.fn().mockResolvedValue({ kind: 'not_participant', message: noProgress }) };
  const auth = new AuthService(prisma as any, {} as any, config, dingtalk as any, {} as any);
  const service = new BotEligibilityService(prisma as any, config, aiConfig as any, auth, dingtalk as any, objectives as any);
  return { service, prisma, aiConfig, dingtalk, objectives };
}

describe('BotEligibilityService', () => {
  it('revalidates identity for a saved retry without requiring a writable month', async () => {
    const { service, prisma, objectives } = setup();
    expect(await (service as any).resolveIdentity(sender)).toMatchObject({ kind: 'ready', viewer: { id: user.id } });
    expect(objectives.findBotGoalAccess).not.toHaveBeenCalled();
    prisma.employmentRecord.findFirst.mockResolvedValue(null);
    expect(await (service as any).resolveIdentity(sender)).toMatchObject({ kind: 'reply' });
  });
  it('returns no-progress reply without exposing goals', async () => {
    const { service } = setup();
    const result = await service.resolve(sender);
    expect(result).toEqual({ kind: 'reply', text: noProgress });
  });

  it.each([
    { botEnabled: false, allowlist: [user.id] },
    { botEnabled: true, allowlist: ['staff', 'Employee'] },
  ])('keeps disabled or non-allowlisted accounts out of performance queries: %j', async (state) => {
    const { service, aiConfig, objectives } = setup();
    aiConfig.getPublicState.mockResolvedValue(state);
    expect(await service.resolve(sender)).toEqual({ kind: 'reply', text: '功能暂未开放' });
    expect(objectives.findBotGoalAccess).not.toHaveBeenCalled();
  });

  it.each([{ corpId: 'other' }, { conversationType: '2' }, { senderStaffId: '' }])(
    'rejects invalid sender context before identity and performance lookup: %j', async (override) => {
      const { service, prisma, dingtalk, objectives } = setup();
      expect(await service.resolve({ ...sender, ...override })).toMatchObject({ kind: 'reply' });
      expect(prisma.externalIdentityBinding.findFirst).not.toHaveBeenCalled();
      expect(dingtalk.fetchUserDetail).not.toHaveBeenCalled();
      expect(objectives.findBotGoalAccess).not.toHaveBeenCalled();
    },
  );

  it('requires an explicitly configured corporation', async () => {
    const { prisma, aiConfig, dingtalk, objectives } = setup();
    const service = new BotEligibilityService(prisma as any, new ConfigService(), aiConfig as any, {} as any, dingtalk as any, objectives as any);
    expect(await service.resolve(sender)).toMatchObject({ kind: 'reply' });
    expect(prisma.externalIdentityBinding.findFirst).not.toHaveBeenCalled();
    expect(objectives.findBotGoalAccess).not.toHaveBeenCalled();
  });

  it.each(['disabled', 'ended'])('rejects %s bindings without fallback', async (status) => {
    const { service, prisma, dingtalk, objectives } = setup();
    prisma.externalIdentityBinding.findFirst.mockResolvedValue({
      user, status, endedAt: status === 'ended' ? new Date() : null,
    });
    expect(await service.resolve(sender)).toMatchObject({ kind: 'reply' });
    expect(dingtalk.fetchUserDetail).not.toHaveBeenCalled();
    expect(objectives.findBotGoalAccess).not.toHaveBeenCalled();
  });

  it.each([null, { employeeStatus: 'resigned' }])('rejects absent or resigned effective employment: %j', async (employment) => {
    const { service, prisma, objectives } = setup();
    prisma.employmentRecord.findFirst.mockResolvedValue(employment as any);
    expect(await service.resolve(sender)).toMatchObject({ kind: 'reply' });
    expect(objectives.findBotGoalAccess).not.toHaveBeenCalled();
  });

  it.each(['service', 'test'])('rejects an enabled bound allowlisted %s account before objective access', async (accountType) => {
    const { service, prisma, objectives } = setup();
    prisma.externalIdentityBinding.findFirst.mockResolvedValue({
      id: 'binding', status: 'enabled', endedAt: null, userId: user.id,
      user: { ...user, accountType },
    });
    prisma.employmentRecord.findFirst.mockResolvedValue(null);
    const result = await service.resolve(sender);
    expect(objectives.findBotGoalAccess).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: 'reply', text: '账号未开通或已停用，请联系管理员核对钉钉绑定和有效任职。',
    });
  });

  it('resolves union ID only when no staff-ID binding exists', async () => {
    const { service, prisma, dingtalk, objectives } = setup();
    prisma.externalIdentityBinding.findFirst.mockResolvedValueOnce(null);
    await service.resolve(sender);
    expect(dingtalk.fetchUserDetail).toHaveBeenCalledWith('staff');
    expect(prisma.externalIdentityBinding.findFirst).toHaveBeenNthCalledWith(2, {
      where: { provider: 'dingtalk', externalUnionId: 'union', endedAt: null }, include: { user: true },
    });
    expect(objectives.findBotGoalAccess).toHaveBeenCalledWith({
      id: 'employee', name: 'Employee', sysRole: 'employee', deptId: null,
      isAssessorOnly: false, canViewAll: false, hrCapabilities: [],
    });
  });

  it.each(['unbound', 'unavailable', 'empty_union'])('does not guess identity when union resolution is %s', async (reason) => {
    const { service, prisma, dingtalk, objectives } = setup();
    prisma.externalIdentityBinding.findFirst.mockResolvedValue(null);
    if (reason === 'unavailable') dingtalk.fetchUserDetail.mockRejectedValue(new Error('external failure'));
    if (reason === 'empty_union') dingtalk.fetchUserDetail.mockResolvedValue({ userid: 'staff', unionid: '' });
    expect(await service.resolve(sender)).toMatchObject({ kind: 'reply' });
    expect(objectives.findBotGoalAccess).not.toHaveBeenCalled();
  });

  it.each(['no_cycle', 'awaiting_goal_approval', 'month_locked', 'self_eval_submitted'])('preserves the %s business reply', async (kind) => {
    const { service, objectives } = setup();
    objectives.findBotGoalAccess.mockResolvedValue({ kind, message: `blocked:${kind}` });
    expect(await service.resolve(sender)).toEqual({ kind: 'reply', text: `blocked:${kind}` });
  });

  it('returns only admitted own goals with a minimal viewer', async () => {
    const { service, objectives, dingtalk } = setup();
    objectives.findBotGoalAccess.mockResolvedValue({ kind: 'ready', goals: [
      { id: 'goal', title: 'Visits', targetValue: '20', unit: '家', periodId: 'month', periodKey: '2026-10' },
    ] } as any);
    expect(await service.resolve(sender)).toEqual({
      kind: 'ready', viewer: {
        id: 'employee', name: 'Employee', sysRole: 'employee', deptId: null,
        isAssessorOnly: false, canViewAll: false, hrCapabilities: [],
      },
      goals: [{ id: 'goal', title: 'Visits', targetValue: '20', unit: '家', periodId: 'month', periodKey: '2026-10' }],
    });
    expect(dingtalk.fetchUserDetail).not.toHaveBeenCalled();
    expect(objectives.findBotGoalAccess).toHaveBeenCalledTimes(1);
  });
});
