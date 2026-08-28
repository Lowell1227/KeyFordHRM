export interface DingTalkOAuthOptions {
  appKey: string;
  corpId: string;
  redirectUri: string;
}

export function buildDingTalkOAuthUrl(options: DingTalkOAuthOptions): string {
  const params = new URLSearchParams({
    redirect_uri: options.redirectUri,
    response_type: 'code',
    client_id: options.appKey,
    scope: 'openid corpid',
    corpId: options.corpId,
  });

  return `https://login.dingtalk.com/oauth2/auth?${params.toString()}`;
}
