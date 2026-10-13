import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

/** Access token for the pilot-only robot application, separate from HRM login credentials. */
@Injectable()
export class DingtalkBotCredentialsService {
  private readonly tokenCache = new Map<string, TokenCacheEntry>();

  constructor(private readonly config: ConfigService) {}

  async getAccessToken(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const appKey = this.config.get<string>('DINGTALK_BOT_APP_KEY')?.trim();
    const appSecret = this.config.get<string>('DINGTALK_BOT_APP_SECRET')?.trim();
    if (!appKey || !appSecret || appKey.includes('请填写') || appSecret.includes('请填写')) {
      throw new Error('钉钉进展机器人应用凭证未配置');
    }

    const cacheKey = `${appKey}:${appSecret}`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const url = new URL('https://oapi.dingtalk.com/gettoken');
    url.searchParams.set('appkey', appKey);
    url.searchParams.set('appsecret', appSecret);
    const response = await fetch(url, { signal });
    const data = (await response.json()) as {
      errcode?: number;
      access_token?: string;
      expires_in?: number;
    };
    signal?.throwIfAborted();
    if (!response.ok || data.errcode !== 0 || !data.access_token) {
      throw new Error('钉钉进展机器人应用凭证校验失败');
    }

    const ttlSeconds = data.expires_in ?? 7200;
    this.tokenCache.set(cacheKey, {
      token: data.access_token,
      expiresAt: Date.now() + Math.max(ttlSeconds - 60, 60) * 1000,
    });
    return data.access_token;
  }
}
