import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { RuntimeSettingsService } from '@/system-configuration/runtime-settings.service';
import { ERROR_CODE } from '../common/constants/error-codes';

export type DingtalkLoginMode = 'oauth' | 'internal';
export type DingtalkIdentity = { appKey?: string; appSecret?: string; agentId?: string; corpId?: string };

/** 钉钉 access_token 缓存项。 */
interface TokenCacheEntry {
  token: string;
  /** 过期时间戳（毫秒），保留 60s 余量。 */
  expiresAt: number;
}

/** 钉钉部门原始结构（topapi/v2/department/listsub）。 */
export interface DingtalkDepartment {
  dept_id: number;
  name: string;
  parent_id?: number;
  order?: number;
}

/** 钉钉用户原始结构（topapi/v2/user/list）。 */
export interface DingtalkUser {
  userid: string;
  unionid: string;
  name: string;
  avatar?: string;
  mobile?: string;
  email?: string;
  title?: string; // 职位
  dept_id_list?: number[];
  manager_userid?: string;
  state_code?: string;
  /** 激活状态：1=已激活，2=已禁用，3=已删除（视返回字段）。 */
  active?: boolean;
}

/**
 * 钉钉开放 API 封装。
 *
 * 负责 access_token 获取与缓存、authCode 换 unionId、
 * 拉取部门/成员列表、发送工作通知。
 */
@Injectable()
export class DingtalkService {
  private readonly logger = new Logger(DingtalkService.name);
  private readonly tokenCache = new Map<string, TokenCacheEntry>();

  constructor(@Inject(RuntimeSettingsService) private readonly config: ConfigService) {}

  getIdentitySnapshot(): Readonly<DingtalkIdentity> {
    return Object.freeze({ appKey: this.appKey, appSecret: this.appSecret, agentId: this.agentId, corpId: this.corpId });
  }
  private async safeFetch(url: string, options?: RequestInit): Promise<Response> {
    try { return await fetch(url, options); }
    catch { throw new Error('钉钉请求未完成，请检查网络及平台配置'); }
  }
  private async safeJson(response: Response): Promise<unknown> {
    try { return await response.json(); }
    catch { throw new Error('钉钉响应格式无效，请稍后重试'); }
  }

  private get appKey(): string | undefined {
    return this.config.get<string>('DINGTALK_APP_KEY');
  }

  private get appSecret(): string | undefined {
    return this.config.get<string>('DINGTALK_APP_SECRET');
  }

  private get agentId(): string | undefined {
    return this.config.get<string>('DINGTALK_AGENT_ID');
  }

  private get corpId(): string | undefined {
    return this.config.get<string>('DINGTALK_CORP_ID');
  }

  private assertConfigured(identity: DingtalkIdentity): void {
    if (!identity.appKey || !identity.appSecret) {
      throw new Error('缺少 DINGTALK_APP_KEY / DINGTALK_APP_SECRET 环境变量，无法调用钉钉 API');
    }
  }

  /**
   * 获取 access_token，带内存缓存（有效期 7200s，保留 60s 余量）。
   * 内存缓存进程重启后丢失，可接受。
   */
  async getAccessToken(signal?: AbortSignal, identity = this.getIdentitySnapshot()): Promise<string> {
    signal?.throwIfAborted();
    if (this.config.get('HRM_PREVIEW') === 'true') throw new Error('隔离预览禁止调用真实钉钉服务');
    this.assertConfigured(identity);

    const cacheKey = createHash('sha256').update(JSON.stringify([identity.corpId, identity.appKey, identity.appSecret])).digest('hex');
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const url = new URL('https://oapi.dingtalk.com/gettoken');
    url.searchParams.set('appkey', identity.appKey!);
    url.searchParams.set('appsecret', identity.appSecret!);

    const res = await this.safeFetch(url.toString(), { signal });
    const data = (await this.safeJson(res)) as {
      errcode?: number;
      errmsg?: string;
      access_token?: string;
      expires_in?: number;
    };
    signal?.throwIfAborted();

    if (!res.ok || data.errcode !== 0 || !data.access_token) {
      throw new Error('钉钉应用凭据连接失败，请核对配置、平台权限及网络');
    }

    const ttlSeconds = data.expires_in ?? 7200;
    this.tokenCache.set(cacheKey, {
      token: data.access_token,
      expiresAt: Date.now() + Math.max(ttlSeconds - 60, 60) * 1000,
    });

    return data.access_token;
  }

  /** 清空 access_token 缓存（测试/异常恢复可用）。 */
  clearTokenCache(): void {
    this.tokenCache.clear();
  }

  /** 按授权码来源换取 unionId，避免不同类型的一次性 code 被错误接口消费。 */
  async getAuthCodeUnionId(authCode: string, loginMode: DingtalkLoginMode): Promise<string> {
    if (this.config.get('HRM_PREVIEW') === 'true') throw new Error('隔离预览禁止调用真实钉钉服务');
    const identity = this.getIdentitySnapshot();
    this.assertConfigured(identity);

    return loginMode === 'internal'
      ? this.getUnionIdByAppAuthCode(authCode, identity)
      : this.getUnionIdByOAuthCode(authCode, identity);
  }

  private async getUnionIdByOAuthCode(authCode: string, identity: DingtalkIdentity): Promise<string> {
    const tokenRes = await this.safeFetch('https://api.dingtalk.com/v1.0/oauth2/userAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: identity.appKey,
        clientSecret: identity.appSecret,
        code: authCode,
        grantType: 'authorization_code',
      }),
    });

    const tokenData = (await this.safeJson(tokenRes)) as {
      accessToken?: string;
      corpId?: string;
      code?: string;
      message?: string;
    };

    if (!tokenRes.ok || !tokenData.accessToken) {
      throw new Error(
        '钉钉 OAuth 授权码换用户 token 失败，请检查应用身份与授权配置',
      );
    }

    if (!identity.corpId || tokenData.corpId !== identity.corpId) {
      throw new UnauthorizedException({
        code: ERROR_CODE.UNAUTHORIZED,
        message: '当前选择的钉钉组织不属于本系统企业',
      });
    }

    const userRes = await this.safeFetch('https://api.dingtalk.com/v1.0/contact/users/me', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': tokenData.accessToken,
      },
    });
    const userData = (await this.safeJson(userRes)) as {
      unionId?: string;
      unionid?: string;
      code?: string;
      message?: string;
    };

    if (!userRes.ok) {
      throw new Error(
        '钉钉获取登录用户信息失败，请检查平台权限',
      );
    }

    const unionId = userData.unionId ?? userData.unionid;
    if (!unionId) throw new Error('钉钉获取登录用户信息失败：响应中无 unionId');
    return unionId;
  }

  private async getUnionIdByAppAuthCode(authCode: string, identity: DingtalkIdentity): Promise<string> {
    const token = await this.getAccessToken(undefined, identity);
    const res = await this.safeFetch(`https://oapi.dingtalk.com/topapi/v2/user/getuserinfo?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: authCode }),
    });

    const data = (await this.safeJson(res)) as {
      errcode?: number;
      errmsg?: string;
      result?: { unionid?: string; unionId?: string; userid?: string };
    };

    if (!res.ok || data.errcode !== 0) {
      throw new Error('钉钉 app authCode 换 unionId 失败，请重新登录或检查平台权限');
    }

    const unionId = data.result?.unionid ?? data.result?.unionId;
    if (unionId) {
      return unionId;
    }

    const userId = data.result?.userid;
    if (!userId) {
      throw new Error('钉钉 app authCode 换 unionId 失败：响应中无 unionid / userid');
    }

    return this.getUnionIdByUserId(userId, token);
  }

  private async getUnionIdByUserId(userId: string, token?: string): Promise<string> {
    const user = await this.fetchUserDetail(userId, token);
    return user.unionid;
  }

  /** 获取单个用户详情，用于补齐成员列表未返回的直属主管等字段。 */
  async fetchUserDetail(userId: string, token?: string, signal?: AbortSignal, identity?: DingtalkIdentity): Promise<DingtalkUser> {
    const accessToken = token ?? (await this.getAccessToken(signal, identity ?? this.getIdentitySnapshot()));
    signal?.throwIfAborted();
    const res = await this.safeFetch(`https://oapi.dingtalk.com/topapi/v2/user/get?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userid: userId, language: 'zh_CN' }),
      signal,
    });

    const data = (await this.safeJson(res)) as {
      errcode?: number;
      errmsg?: string;
      result?: DingtalkUser & { unionId?: string };
    };
    signal?.throwIfAborted();

    if (!res.ok || data.errcode !== 0) {
      throw new Error('钉钉获取用户详情失败，请检查平台权限');
    }

    const user = data.result;
    const unionId = user?.unionid ?? user?.unionId;
    if (!user?.userid || !user.name || !unionId) {
      throw new Error('钉钉获取用户详情失败：响应缺少 userid / unionid / name');
    }

    return { ...user, unionid: unionId };
  }

  /**
   * 拉取全部部门（递归子部门）。
   * 从根部门 1 开始，递归获取子部门。
   */
  async fetchDepartments(): Promise<DingtalkDepartment[]> {
    const token = await this.getAccessToken();
    const result: DingtalkDepartment[] = [];
    const queue: number[] = [1];
    const visited = new Set<number>();

    while (queue.length > 0) {
      const deptId = queue.shift()!;
      if (visited.has(deptId)) continue;
      visited.add(deptId);

      const res = await this.safeFetch(`https://oapi.dingtalk.com/topapi/v2/department/listsub?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dept_id: deptId, language: 'zh_CN' }),
      });

      const data = (await this.safeJson(res)) as {
        errcode?: number;
        errmsg?: string;
        result?: DingtalkDepartment[];
      };

      if (!res.ok || data.errcode !== 0) {
        throw new Error('钉钉拉取部门失败，请检查平台权限');
      }

      const list = data.result ?? [];
      for (const dept of list) {
        result.push(dept);
        queue.push(dept.dept_id);
      }
    }

    return result;
  }

  /**
   * 拉取指定部门下的成员（分页拉取）。
   */
  async fetchUsersByDepartment(deptId: number): Promise<DingtalkUser[]> {
    const token = await this.getAccessToken();
    const result: DingtalkUser[] = [];
    let cursor = 0;
    const size = 100;

    while (true) {
      const res = await this.safeFetch(`https://oapi.dingtalk.com/topapi/v2/user/list?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dept_id: deptId, cursor, size }),
      });

      const data = (await this.safeJson(res)) as {
        errcode?: number;
        errmsg?: string;
        result?: {
          list?: DingtalkUser[];
          has_more?: boolean;
          next_cursor?: number;
        };
      };

      if (!res.ok || data.errcode !== 0) {
        throw new Error('钉钉拉取成员失败，请检查平台权限');
      }

      const list = data.result?.list ?? [];
      result.push(...list);

      if (!data.result?.has_more) break;
      cursor = data.result.next_cursor ?? cursor + size;
    }

    return result;
  }

  /**
   * 发送钉钉工作通知。
   * @param dingtalkUserId 接收人钉钉 userid
   * @param title 标题
   * @param content 正文（支持 markdown）
   * @param url 跳转链接（可选）
   */
  async sendWorkNotification(
    dingtalkUserId: string,
    title: string,
    content: string,
    url?: string,
  ): Promise<void> {
    const identity = this.getIdentitySnapshot();
    if (!identity.agentId) {
      throw new Error('缺少 DINGTALK_AGENT_ID 环境变量，无法发送工作通知');
    }

    const token = await this.getAccessToken(undefined, identity);
    const message: Record<string, unknown> = {
      msgtype: 'markdown',
      markdown: { title, text: content },
    };
    if (url) {
      message.action_card = {
        title,
        markdown: content,
        single_title: '查看详情',
        single_url: url,
      };
      message.msgtype = 'action_card';
    }

    const res = await this.safeFetch(`https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: identity.agentId,
        userid_list: dingtalkUserId,
        msg: message,
      }),
    });

    const data = (await this.safeJson(res)) as { errcode?: number; errmsg?: string };
    if (!res.ok || data.errcode !== 0) {
      throw new Error('钉钉发送工作通知失败，请检查平台权限');
    }
  }
}
