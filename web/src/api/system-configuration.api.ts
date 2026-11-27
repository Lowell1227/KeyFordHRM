import http from './http';

export type ConfigurationStatus = {
  id: string;
  fields: { label: string; state: 'present' | 'missing' | 'unknown' | 'managed' }[];
  verification: 'unknown' | 'untested' | 'passed' | 'failed';
  verifiedAt: string | null;
  enabled: boolean | null;
};

export async function getConfigurationStatus(): Promise<ConfigurationStatus[]> {
  const rows: unknown = await http.get('/system/configuration-status', { skipErrorMessage: true });
  if (!Array.isArray(rows)) throw new Error('配置状态格式不可用');
  return rows;
}
