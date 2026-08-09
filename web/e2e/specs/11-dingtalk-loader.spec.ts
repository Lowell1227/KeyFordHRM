import { expect, test } from '@playwright/test';
import {
  createDingTalkJsApiLoader,
  type DingTalkJsApi,
} from '../../src/utils/dingtalk-jsapi';

function fakeApi(): DingTalkJsApi {
  return {
    requestAuthCode: () => undefined,
  };
}

test.describe('DingTalk JSAPI loader', () => {
  test('uses an injected window API without importing the package', async () => {
    const injected = fakeApi();
    let imports = 0;
    const load = createDingTalkJsApiLoader({
      getInjectedApi: () => injected,
      importModule: async () => {
        imports += 1;
        return { default: fakeApi() };
      },
    });

    await expect(load()).resolves.toBe(injected);
    expect(imports).toBe(0);
  });

  test('clears a failed attempt so the next call imports again and settles', async () => {
    const imported = fakeApi();
    let imports = 0;
    const load = createDingTalkJsApiLoader({
      getInjectedApi: () => undefined,
      importModule: async () => {
        imports += 1;
        if (imports === 1) throw new Error('first import failed');
        return { default: imported };
      },
    });

    await expect(load()).rejects.toThrow('first import failed');
    await expect(load()).resolves.toBe(imported);
    expect(imports).toBe(2);
  });

  test('ordinary login does not load the SDK, while an explicit browser import resolves the npm module', async ({ page }) => {
    const sdkRequests: string[] = [];
    const failedRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (
        url.includes('/node_modules/dingtalk-jsapi')
        || url.includes('/node_modules/.vite/deps/dingtalk-jsapi')
        || url.includes('g.alicdn.com/dingding/dingtalk-jsapi')
      ) sdkRequests.push(url);
    });
    page.on('requestfailed', (request) => failedRequests.push(request.url()));

    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    expect(sdkRequests).toEqual([]);
    expect(failedRequests).toEqual([]);

    const requestAuthCodeType = await page.evaluate(async () => {
      const loader = await import('/src/utils/dingtalk-jsapi.ts');
      const sdk = await loader.loadDingTalkJsApi();
      return typeof sdk.requestAuthCode;
    });
    expect(requestAuthCodeType).toBe('function');
    expect(failedRequests).toEqual([]);
  });
});
