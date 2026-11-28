import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';

export interface RecruitmentMailSettings {
  account: string;
  password: string;
  folder: string;
  authorizedFrom: string;
}

const fields = ['version', 'provider', 'account', 'password', 'folder', 'authorizedFrom'];
const invalid = () => new ServiceUnavailableException('招聘邮箱安全配置未就绪，请管理员检查私有配置或已保存的邮箱设置');

export function readRecruitmentMailSettings(config?: Pick<ConfigService, 'get'>): RecruitmentMailSettings | null {
  const enabled = config?.get('RECRUITMENT_MAIL_ENABLED');
  if (!config || (enabled !== 'true' && enabled !== true)) return null;
  let descriptor: number | undefined;
  try {
    const file = config.get<string>('RECRUITMENT_MAIL_CONFIG_FILE');
    if (typeof file !== 'string' || !file || lstatSync(file).isSymbolicLink()) throw invalid();
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 1 || stat.size > 8192) throw invalid();
    if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 ||
      (stat.uid !== 0 && stat.uid !== process.getuid?.()))) throw invalid();
    const buffer = Buffer.alloc(8193);
    const length = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (length > 8192) throw invalid();
    const value = JSON.parse(buffer.toString('utf8', 0, length)) as Record<string, unknown>;
    if (!value || Array.isArray(value) || value.version !== 1 || value.provider !== 'alimail' ||
      Object.keys(value).some(key => !fields.includes(key))) throw invalid();
    for (const key of fields.slice(2)) {
      if (typeof value[key] !== 'string' || !(value[key] as string).trim()) throw invalid();
    }
    return { account: value.account as string, password: value.password as string,
      folder: value.folder as string, authorizedFrom: value.authorizedFrom as string };
  } catch {
    throw invalid();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
