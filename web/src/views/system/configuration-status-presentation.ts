import type { ConfigurationStatus } from '@/api/system-configuration.api';

export function configurationSource(row: ConfigurationStatus): string | null {
  if (row.id === 'recruitment-mail' || row.revision === undefined) return null;
  if (row.appliedRevision) return `当前使用系统配置 · 版本 ${row.appliedRevision}`;
  return '系统内配置尚未应用；运行时读取部署设置';
}

export function configurationDraft(row: ConfigurationStatus): string | null {
  if (row.id === 'recruitment-mail' || !row.revision || row.revision === row.appliedRevision) return null;
  return `草稿版本 ${row.revision} · 尚未应用`;
}

export function verificationText(row: ConfigurationStatus): string {
  if (row.id === 'recruitment-mail') return '各邮箱核验状态请查看邮箱管理';
  const provider = row.id.startsWith('ai-progress-');
  if (!provider && !row.revision) return '本页面无核验记录';
  const name = provider ? '服务商连接' : row.testKind === 'connection' ? '连接'
    : row.testKind === 'scope' ? '指定样本' : '配置';
  const subject = configurationDraft(row) ? '草稿' : '';
  if (row.verification === 'unknown') return `${subject}核验状态待核实`;
  if (row.verification === 'untested') return `${subject}尚未核验`;
  return `${subject}${name}核验${row.verification === 'passed' ? '通过' : '失败'}`;
}

export function businessState(row: ConfigurationStatus): string {
  if (row.id === 'recruitment-mail' && row.configuredCount !== undefined && row.enabledCount !== undefined) {
    return `已配置 ${row.configuredCount} 个 · 已启用 ${row.enabledCount} 个`;
  }
  if (row.enabled === null) return '状态待核实';
  if (row.id.startsWith('ai-progress-')) return row.enabled ? '目标进展识别使用中' : '目标进展识别未使用';
  if (row.id === 'recruitment-demand') return row.enabled ? '审批表接入配置已填写' : '审批表接入配置不完整';
  if (row.id === 'dingtalk-login') return row.enabled ? '登录入口已启用' : '登录入口未启用';
  if (row.id === 'dingtalk-notifications') return row.enabled ? '通知实际开关已启用' : '通知实际开关未启用';
  return row.enabled ? '业务开关已启用' : '业务开关未启用';
}

export function configurationAction(row: ConfigurationStatus): string {
  if (row.id === 'recruitment-mail') return '管理招聘邮箱';
  if (row.id === 'recruitment-demand') return '配置审批表接入';
  if (row.id.startsWith('ai-progress-')) return '配置 AI 服务';
  return '查看与配置';
}
