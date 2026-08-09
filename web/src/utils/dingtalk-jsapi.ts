export type DingTalkJsApi = {
  requestAuthCode: (options: {
    corpId: string;
    clientId?: string;
    onSuccess: (result: { code: string }) => void;
    onFail: (error: unknown) => void;
  }) => void | Promise<{ code: string }>;
};

type DingTalkJsApiModule = { default?: unknown } & Record<string, unknown>;

interface DingTalkJsApiLoaderOptions {
  getInjectedApi?: () => DingTalkJsApi | undefined;
  importModule?: () => Promise<DingTalkJsApiModule>;
}

export function createDingTalkJsApiLoader(_options: DingTalkJsApiLoaderOptions = {}) {
  const getInjectedApi = _options.getInjectedApi ?? (() => (
    typeof window === 'undefined'
      ? undefined
      : (window as Window & { dd?: DingTalkJsApi }).dd
  ));
  const importModule = _options.importModule ?? (() => import('dingtalk-jsapi'));
  let loadedApi: DingTalkJsApi | undefined;
  let inFlight: Promise<DingTalkJsApi> | undefined;

  const resolveModuleApi = (module: DingTalkJsApiModule): DingTalkJsApi => {
    const candidates = [module.default, module];
    const api = candidates.find((candidate): candidate is DingTalkJsApi => (
      typeof candidate === 'object'
      && candidate !== null
      && typeof (candidate as Partial<DingTalkJsApi>).requestAuthCode === 'function'
    ));
    if (!api) throw new Error('DingTalk JSAPI module does not expose requestAuthCode');
    return api;
  };

  return async (): Promise<DingTalkJsApi> => {
    const injectedApi = getInjectedApi();
    if (injectedApi?.requestAuthCode) return injectedApi;
    if (loadedApi) return loadedApi;
    if (!inFlight) {
      inFlight = importModule().then(resolveModuleApi).then((api) => {
        loadedApi = api;
        return api;
      });
    }

    const currentAttempt = inFlight;
    try {
      return await currentAttempt;
    } finally {
      if (inFlight === currentAttempt) inFlight = undefined;
    }
  };
}

export const loadDingTalkJsApi = createDingTalkJsApiLoader();
