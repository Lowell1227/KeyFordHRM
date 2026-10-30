export interface DingTalkOAuthOptions {
  appKey: string;
  corpId: string;
  redirectUri: string;
}

const ARCHIVE_RETURN_KEY = 'archive-assistant:oauth-return';
const ARCHIVE_RETURN_TTL = 10 * 60 * 1000;

export function clearArchiveOAuthReturn(): void {
  try { sessionStorage.removeItem(ARCHIVE_RETURN_KEY); } catch { /* Storage may be disabled. */ }
}

export function rememberArchiveOAuthReturn(target: unknown): void {
  clearArchiveOAuthReturn();
  const match = typeof target === 'string'
    ? /^\/archive-assistant\/preview\/([a-f0-9]{64})$/.exec(target) : null;
  if (!match) return;
  try {
    // Store only the public reference, never the signed preview token or an arbitrary redirect.
    sessionStorage.setItem(ARCHIVE_RETURN_KEY, JSON.stringify({ reference: match[1], expiresAt: Date.now() + ARCHIVE_RETURN_TTL }));
  } catch { /* Normal callback redirect remains available if storage is disabled. */ }
}

export function takeArchiveOAuthReturn(): string | undefined {
  try {
    const raw = sessionStorage.getItem(ARCHIVE_RETURN_KEY);
    clearArchiveOAuthReturn();
    if (!raw) return;
    const { reference, expiresAt } = JSON.parse(raw);
    const remaining = expiresAt - Date.now();
    if (typeof reference === 'string' && /^[a-f0-9]{64}$/.test(reference)
      && typeof expiresAt === 'number' && remaining > 0 && remaining <= ARCHIVE_RETURN_TTL) {
      return `/archive-assistant/preview/${reference}`;
    }
  } catch { /* Invalid or unavailable storage falls back to the existing callback destination. */ }
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
