import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODE } from '../common/constants/error-codes';

export type DingtalkLoginMode = 'oauth' | 'internal';

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

  constructor(private readonly config: ConfigService) {}

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

  private assertConfigured(): void {
    if (!this.appKey || !this.appSecret) {
      throw new Error('缺少 DINGTALK_APP_KEY / DINGTALK_APP_SECRET 环境变量，无法调用钉钉 API');
    }
  }

  /**
   * 获取 access_token，带内存缓存（有效期 7200s，保留 60s 余量）。
   * 内存缓存进程重启后丢失，可接受。
   */
  async getAccessToken(): Promise<string> {
    this.assertConfigured();

    const cacheKey = `${this.appKey}:token`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const url = new URL('https://oapi.dingtalk.com/gettoken');
    url.searchParams.set('appkey', this.appKey!);
    url.searchParams.set('appsecret', this.appSecret!);

    const res = await fetch(url.toString());
    const data = (await res.json()) as {
      errcode?: number;
      errmsg?: string;
      access_token?: string;
      expires_in?: number;
    };

    if (!res.ok || data.errcode !== 0 || !data.access_token) {
      throw new Error(`钉钉获取 access_token 失败: ${data.errmsg ?? res.statusText} (${data.errcode ?? res.status})`);
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
    this.assertConfigured();

    return loginMode === 'internal'
      ? this.getUnionIdByAppAuthCode(authCode)
      : this.getUnionIdByOAuthCode(authCode);
  }

  private async getUnionIdByOAuthCode(authCode: string): Promise<string> {
    const tokenRes = await fetch('https://api.dingtalk.com/v1.0/oauth2/userAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: this.appKey,
        clientSecret: this.appSecret,
        code: authCode,
        grantType: 'authorization_code',
      }),
    });

    const tokenData = (await tokenRes.json()) as {
      accessToken?: string;
      corpId?: string;
      code?: string;
      message?: string;
    };

    if (!tokenRes.ok || !tokenData.accessToken) {
      throw new Error(
        `钉钉 OAuth 授权码换用户 token 失败: ${tokenData.message ?? tokenRes.statusText} (${tokenData.code ?? tokenRes.status})`,
      );
    }

    if (!this.corpId || tokenData.corpId !== this.corpId) {
      throw new UnauthorizedException({
        code: ERROR_CODE.UNAUTHORIZED,
        message: '当前选择的钉钉组织不属于本系统企业',
      });
    }

    const userRes = await fetch('https://api.dingtalk.com/v1.0/contact/users/me', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': tokenData.accessToken,
      },
    });
    const userData = (await userRes.json()) as {
      unionId?: string;
      unionid?: string;
      code?: string;
      message?: string;
    };

    if (!userRes.ok) {
      throw new Error(
        `钉钉获取登录用户信息失败: ${userData.message ?? userRes.statusText} (${userData.code ?? userRes.status})`,
      );
    }

    const unionId = userData.unionId ?? userData.unionid;
    if (!unionId) throw new Error('钉钉获取登录用户信息失败：响应中无 unionId');
    return unionId;
  }

  private async getUnionIdByAppAuthCode(authCode: string): Promise<string> {
    const token = await this.getAccessToken();
    const res = await fetch(`https://oapi.dingtalk.com/topapi/v2/user/getuserinfo?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: authCode }),
    });

    const data = (await res.json()) as {
      errcode?: number;
      errmsg?: string;
      result?: { unionid?: string; unionId?: string; userid?: string };
    };

    if (!res.ok || data.errcode !== 0) {
      throw new Error(`钉钉 app authCode 换 unionId 失败: ${data.errmsg ?? res.statusText} (${data.errcode ?? res.status})`);
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
  async fetchUserDetail(userId: string, token?: string): Promise<DingtalkUser> {
    const accessToken = token ?? (await this.getAccessToken());
    const res = await fetch(`https://oapi.dingtalk.com/topapi/v2/user/get?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userid: userId, language: 'zh_CN' }),
    });

    const data = (await res.json()) as {
      errcode?: number;
      errmsg?: string;
      result?: DingtalkUser & { unionId?: string };
    };

    if (!res.ok || data.errcode !== 0) {
      throw new Error(`钉钉获取用户详情失败: ${data.errmsg ?? res.statusText} (${data.errcode ?? res.status})`);
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

      const res = await fetch(`https://oapi.dingtalk.com/topapi/v2/department/listsub?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dept_id: deptId, language: 'zh_CN' }),
      });

      const data = (await res.json()) as {
        errcode?: number;
        errmsg?: string;
        result?: DingtalkDepartment[];
      };

      if (!res.ok || data.errcode !== 0) {
        throw new Error(`钉钉拉取部门失败: ${data.errmsg ?? res.statusText} (${data.errcode ?? res.status})`);
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
      const res = await fetch(`https://oapi.dingtalk.com/topapi/v2/user/list?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dept_id: deptId, cursor, size }),
      });

      const data = (await res.json()) as {
        errcode?: number;
        errmsg?: string;
        result?: {
          list?: DingtalkUser[];
          has_more?: boolean;
          next_cursor?: number;
        };
      };

      if (!res.ok || data.errcode !== 0) {
        throw new Error(`钉钉拉取成员失败: ${data.errmsg ?? res.statusText} (${data.errcode ?? res.status})`);
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
    if (!this.agentId) {
      throw new Error('缺少 DINGTALK_AGENT_ID 环境变量，无法发送工作通知');
    }

    const token = await this.getAccessToken();
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

    const res = await fetch(`https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: this.agentId,
        userid_list: dingtalkUserId,
        msg: message,
      }),
    });

    const data = (await res.json()) as { errcode?: number; errmsg?: string };
    if (!res.ok || data.errcode !== 0) {
      throw new Error(`钉钉发送工作通知失败: ${data.errmsg ?? res.statusText} (${data.errcode ?? res.status})`);
    }
  }
}
