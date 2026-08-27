import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dingtalkLoginErrorMessage } from '../../src/utils/dingtalk-login-error';

const loginViewPath = fileURLToPath(
  new URL('../../src/views/auth/LoginView.vue', import.meta.url),
);
const mainPath = fileURLToPath(new URL('../../src/main.ts', import.meta.url));
const callbackViewPath = fileURLToPath(
  new URL('../../src/views/auth/DingTalkCallbackView.vue', import.meta.url),
);
const nginxConfigPath = fileURLToPath(
  new URL('../../nginx/default.conf', import.meta.url),
);
const dingtalkBuildValidatorPath = fileURLToPath(
  new URL('../../scripts/validate-dingtalk-build-env.mjs', import.meta.url),
);

test.describe('DingTalk login error message', () => {
  test('turns a missing contact permission into an actionable message', () => {
    const error = {
      response: {
        data: {
          message: 'Forbidden.AccessDenied.AccessTokenPermissionDenied',
        },
      },
    };

    expect(dingtalkLoginErrorMessage(error)).toBe(
      '钉钉应用缺少“获取用户通讯录个人信息”权限，请联系应用管理员开通并重新发布应用',
    );
  });

  test('keeps the default message for an unknown failure', () => {
    expect(dingtalkLoginErrorMessage(new Error('network failed'))).toBe(
      '钉钉登录失败，请重试；如持续失败请联系 HR 或系统管理员',
    );
  });

  test('turns an unsynced DingTalk identity into an actionable message', () => {
    const error = {
      response: {
        data: {
          message: '账号未开通',
        },
      },
    };

    expect(dingtalkLoginErrorMessage(error)).toBe(
      '该钉钉账号尚未同步到系统，请联系 HR 或系统管理员后重试',
    );
  });

  test('turns an organization mismatch into an account selection prompt', () => {
    const error = {
      response: {
        data: {
          message: '当前选择的钉钉组织不属于本系统企业',
        },
      },
    };

    expect(dingtalkLoginErrorMessage(error)).toBe(
      '当前选择的不是孚德企业，请重新选择钉钉账号或组织',
    );
  });

  test('keeps DingTalk as the clear employee login path', async () => {
    const source = await readFile(loginViewPath, 'utf8');

    expect(source).toContain("const showPasswordForm = ref(false)");
    expect(source).toContain("isDingTalkEnv.value ? '钉钉内免登' : '选择钉钉账号/组织登录'");
    expect(source).toContain('公司员工请使用钉钉账号登录；新浏览器首次使用需完成钉钉授权');
    expect(source).toContain('管理员账号登录');
    expect(source).not.toContain('>其他方式登录<');
  });

  test('prevents Safari from reusing a stale SPA shell after deployment', async () => {
    const source = await readFile(nginxConfigPath, 'utf8');

    expect(source).toContain('location = /index.html');
    expect(source).toContain('Cache-Control "no-store, no-cache, must-revalidate"');
  });

  test('waits for the initial auth redirect before mounting the application shell', async () => {
    const source = await readFile(mainPath, 'utf8');
    const routerReadyIndex = source.indexOf('await router.isReady()');
    const mountIndex = source.indexOf("app.mount('#app')");

    expect(routerReadyIndex).toBeGreaterThan(-1);
    expect(mountIndex).toBeGreaterThan(routerReadyIndex);
  });

  test('starts a clean application boot after a successful OAuth callback', async () => {
    const source = await readFile(callbackViewPath, 'utf8');

    expect(source).toContain('window.location.replace(redirect)');
    expect(source).not.toContain('router.replace(redirect)');
  });

  test('explains the organization boundary before DingTalk authorization', async () => {
    const source = await readFile(loginViewPath, 'utf8');

    expect(source).not.toContain('const isSafariEnv = computed');
    expect(source).toContain("scope: 'openid corpid'");
    expect(source).toMatch(
      /const params = new URLSearchParams\(\{[\s\S]*?corpId: DINGTALK_CORP_ID,[\s\S]*?\}\);/,
    );
    expect(source).toContain('多组织账号请在钉钉授权页选择应用所属企业');
    expect(source).not.toContain('Safari 若未显示钉钉扫码页');
  });

  const validDingTalkBuildEnv = {
    VITE_DINGTALK_APP_KEY: 'dingvalidappkey12345',
    VITE_DINGTALK_CORP_ID: 'dingvalidcorpid12345',
    VITE_DINGTALK_REDIRECT_URI: 'https://hr.example.com/auth/callback',
  };

  function validateDingTalkBuildEnv(overrides: Record<string, string>) {
    return spawnSync(process.execPath, [dingtalkBuildValidatorPath], {
      encoding: 'utf8',
      env: { ...process.env, ...validDingTalkBuildEnv, ...overrides },
    });
  }

  test('rejects each unsafe DingTalk production build setting independently', () => {
    const invalidCases = [
      ['missing AppKey', { VITE_DINGTALK_APP_KEY: '' }, 'VITE_DINGTALK_APP_KEY 未配置'],
      ['placeholder AppKey', { VITE_DINGTALK_APP_KEY: 'devdingtalk' }, 'VITE_DINGTALK_APP_KEY 仍是开发占位值'],
      ['missing CorpId', { VITE_DINGTALK_CORP_ID: '' }, 'VITE_DINGTALK_CORP_ID 未配置'],
      ['placeholder CorpId', { VITE_DINGTALK_CORP_ID: 'dingdev' }, 'VITE_DINGTALK_CORP_ID 仍是开发占位值'],
      ['missing redirect URI', { VITE_DINGTALK_REDIRECT_URI: '' }, 'VITE_DINGTALK_REDIRECT_URI 未配置'],
      ['malformed redirect URI', { VITE_DINGTALK_REDIRECT_URI: 'not-a-url' }, 'VITE_DINGTALK_REDIRECT_URI 不是有效地址'],
      ['HTTP redirect URI', { VITE_DINGTALK_REDIRECT_URI: 'http://hr.example.com/auth/callback' }, 'VITE_DINGTALK_REDIRECT_URI 必须使用 HTTPS'],
      ['wrong callback path', { VITE_DINGTALK_REDIRECT_URI: 'https://hr.example.com/login' }, 'VITE_DINGTALK_REDIRECT_URI 必须指向 /auth/callback'],
      ['IPv4 loopback redirect', { VITE_DINGTALK_REDIRECT_URI: 'https://127.0.0.2/auth/callback' }, 'VITE_DINGTALK_REDIRECT_URI 不能指向本机'],
      ['IPv6 loopback redirect', { VITE_DINGTALK_REDIRECT_URI: 'https://[::1]/auth/callback' }, 'VITE_DINGTALK_REDIRECT_URI 不能指向本机'],
      ['unspecified redirect', { VITE_DINGTALK_REDIRECT_URI: 'https://0.0.0.0/auth/callback' }, 'VITE_DINGTALK_REDIRECT_URI 不能指向本机'],
    ] as const;

    for (const [caseName, overrides, expectedMessage] of invalidCases) {
      const result = validateDingTalkBuildEnv(overrides);
      expect(result.status, caseName).toBe(1);
      expect(result.stderr, caseName).toContain(expectedMessage);
    }
  });

  test('accepts a valid HTTPS DingTalk callback for a production build', () => {
    const validResult = validateDingTalkBuildEnv({});

    expect(validResult.status).toBe(0);
    expect(validResult.stdout).toContain('钉钉生产构建配置已通过校验');
  });
});
