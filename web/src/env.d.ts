/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

// 钉钉 JSAPI（在钉钉容器内由 dingtalk-jsapi 注入）
declare const dd: {
  requestAuthCode: (opts: { corpId: string; onSuccess: (res: { code: string }) => void; onFail: (err: unknown) => void }) => void;
};
