import { expect, test } from '@playwright/test';
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
});
