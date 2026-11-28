import http from './http';

export type ConfigurationStatus = {
  id: string;
  fields: { label: string; state: 'present' | 'missing' | 'unknown' | 'managed' }[];
  verification: 'unknown' | 'untested' | 'passed' | 'failed';
  verifiedAt: string | null;
  enabled: boolean | null;
  revision?: number;
  appliedRevision?: number;
  ready?: boolean;
  testKind?: 'connection' | 'scope' | 'configuration' | 'none';
  verificationMessage?: string | null;
};

export type SystemConfigurationField = {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'boolean' | 'datetime' | 'textarea' | 'select';
  required: boolean;
  value?: string | boolean | null;
  configured: boolean;
  help?: string;
  options?: { value: string; label: string }[];
};
export type SystemConfigurationView = {
  id: string;
  title: string;
  description: string;
  revision: number;
  appliedRevision: number;
  source: 'deployment' | 'database' | 'none';
  encryptionReady: boolean;
  fields: SystemConfigurationField[];
  verification: ConfigurationStatus['verification'];
  verifiedAt: string | null;
  verificationMessage: string | null;
  testKind: 'connection' | 'scope' | 'configuration' | 'none';
  requiresSample: boolean;
};
export type SaveSystemConfiguration = { expectedRevision: number; values: Record<string, string | boolean> };
const path = (id: string) => `/system/configurations/${encodeURIComponent(id)}`;
export const systemConfigurationApi = {
  mailboxes(): Promise<SystemConfigurationView[]> {
    return http.get('/system/configuration-mailboxes', { skipErrorMessage: true }) as unknown as Promise<SystemConfigurationView[]>;
  },
  createMailbox(): Promise<SystemConfigurationView> {
    return http.post('/system/configuration-mailboxes', {}, { skipErrorMessage: true }) as unknown as Promise<SystemConfigurationView>;
  },
  get(id: string): Promise<SystemConfigurationView> {
    return http.get(path(id), { skipErrorMessage: true }) as unknown as Promise<SystemConfigurationView>;
  },
  save(id: string, body: SaveSystemConfiguration): Promise<SystemConfigurationView> {
    return http.put(path(id), body, { skipErrorMessage: true }) as unknown as Promise<SystemConfigurationView>;
  },
  test(id: string, body: { expectedRevision: number; sampleInstanceId?: string }): Promise<SystemConfigurationView> {
    return http.post(path(id) + '/test', body, { skipErrorMessage: true }) as unknown as Promise<SystemConfigurationView>;
  },
  apply(id: string, body: { expectedRevision: number }): Promise<SystemConfigurationView> {
    return http.post(path(id) + '/apply', body, { skipErrorMessage: true }) as unknown as Promise<SystemConfigurationView>;
  },
};

export async function getConfigurationStatus(): Promise<ConfigurationStatus[]> {
  const rows: unknown = await http.get('/system/configuration-status', { skipErrorMessage: true });
  if (!Array.isArray(rows)) throw new Error('配置状态格式不可用');
  return rows;
}
