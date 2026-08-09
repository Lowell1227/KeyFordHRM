<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth.store';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const isDingTalkEnv = computed(() => navigator.userAgent.includes('DingTalk'));
const showPasswordForm = ref(!isDingTalkEnv.value);
const loading = ref(false);
const form = reactive({ employeeNo: '', password: '' });

const DINGTALK_APP_KEY = import.meta.env.VITE_DINGTALK_APP_KEY || 'dinghwbnyktt3oku2jd3';
const DINGTALK_CORP_ID = import.meta.env.VITE_DINGTALK_CORP_ID || '';
const DINGTALK_JSAPI_URL = 'https://g.alicdn.com/dingding/dingtalk-jsapi/2.15.6/dingtalk.open.js';
type DingTalkJsApi = {
  requestAuthCode: (options: {
    corpId: string;
    onSuccess: (result: { code: string }) => void;
    onFail: (error: unknown) => void;
  }) => void;
};

// —— 测试账号快速登录（仅开发环境，生产构建不包含）——
// 账号由 `npm run db:seed:dev` 写入，密码统一 000000。
const isDev = import.meta.env.DEV;
const quickAccounts = [
  { role: '系统管理员', employeeNo: 'ADMIN', type: 'danger' },
  { role: 'HR', employeeNo: 'HR001', type: 'warning' },
  { role: 'VP', employeeNo: 'VP001', type: 'primary' },
  { role: '主管', employeeNo: 'MGR001', type: 'success' },
  { role: '员工', employeeNo: 'EMP001', type: 'info' },
] as const;
const QUICK_PASSWORD = '000000';
const quickLoadingNo = ref<string | null>(null);

function isAuthFailure(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 401;
}

async function quickLogin(employeeNo: string) {
  if (loading.value || quickLoadingNo.value) return;
  quickLoadingNo.value = employeeNo;
  try {
    await auth.loginWithPassword(employeeNo, QUICK_PASSWORD);
    redirectAfterLogin();
  } catch (err) {
    // 401（账号不存在/密码不对）拦截器不弹提示，这里给出可操作的指引；
    // 其它错误（网络等）已由 http 拦截层提示，避免重复弹窗。
    if (isAuthFailure(err)) {
      ElMessage.error(`${employeeNo} 登录失败：请先运行 npm run db:seed:dev 写入测试账号`);
    }
  } finally {
    quickLoadingNo.value = null;
  }
}

function redirectAfterLogin() {
  const target = (route.query.redirect as string) || '/dashboard';
  router.replace(target);
}

function getDingTalkRedirectUri() {
  return import.meta.env.VITE_DINGTALK_REDIRECT_URI || `${window.location.origin}/auth/callback`;
}

function getDingTalkJsApi(): DingTalkJsApi | undefined {
  return (window as Window & { dd?: DingTalkJsApi }).dd;
}

async function ensureDingTalkJsApi(): Promise<boolean> {
  if (getDingTalkJsApi()?.requestAuthCode) return true;

  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-dingtalk-jsapi]');
    const script = existing ?? document.createElement('script');
    const settle = () => resolve(!!getDingTalkJsApi()?.requestAuthCode);

    script.addEventListener('load', settle, { once: true });
    script.addEventListener('error', () => resolve(false), { once: true });
    if (!existing) {
      script.src = DINGTALK_JSAPI_URL;
      script.async = true;
      script.dataset.dingtalkJsapi = 'true';
      document.head.append(script);
    }
  });
}

async function onDingTalkLogin() {
  if (loading.value) return;

  if (isDingTalkEnv.value) {
    if (!DINGTALK_CORP_ID) {
      ElMessage.error('缺少钉钉企业 CorpId 配置，请联系管理员检查 VITE_DINGTALK_CORP_ID');
      return;
    }
    if (!await ensureDingTalkJsApi()) {
      ElMessage.error('钉钉 JSAPI 未加载，请在钉钉客户端内重新打开页面');
      return;
    }

    const dingTalkJsApi = getDingTalkJsApi();
    if (!dingTalkJsApi) return;

    loading.value = true;
    dingTalkJsApi.requestAuthCode({
      corpId: DINGTALK_CORP_ID,
      onSuccess: async (res) => {
        try {
          await auth.loginWithDingTalk(res.code);
          redirectAfterLogin();
        } catch {
          ElMessage.error('钉钉登录失败，请确认账号已开通或改用账号密码登录');
        } finally {
          loading.value = false;
        }
      },
      onFail: (err) => {
        console.error('DingTalk requestAuthCode failed', err);
        ElMessage.error('获取钉钉授权失败，请稍后重试');
        loading.value = false;
      },
    });
    return;
  }

  loading.value = true;
  const params = new URLSearchParams({
    redirect_uri: getDingTalkRedirectUri(),
    response_type: 'code',
    client_id: DINGTALK_APP_KEY,
    scope: 'openid',
    prompt: 'consent',
  });
  window.location.href = `https://login.dingtalk.com/oauth2/auth?${params.toString()}`;
}

async function onPasswordLogin() {
  if (!form.employeeNo || !form.password) {
    ElMessage.warning('请输入工号和密码');
    return;
  }
  loading.value = true;
  try {
    await auth.loginWithPassword(form.employeeNo, form.password);
    redirectAfterLogin();
  } catch (err) {
    // 401 拦截器静默处理，这里补充用户可见的失败提示；其它错误已由拦截层弹窗。
    if (isAuthFailure(err)) {
      ElMessage.error('工号或密码错误');
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <el-card class="login-card">
    <img src="/logo.png" alt="KAYFORD 孚德" class="login-logo" />
    <h2 class="title">绩效管理系统</h2>
    <el-button type="primary" size="large" class="dingtalk-btn" :loading="loading" @click="onDingTalkLogin">
      钉钉一键登录
    </el-button>

    <el-divider>
      <span class="other" @click="showPasswordForm = !showPasswordForm">其他方式登录</span>
    </el-divider>

    <el-form v-show="showPasswordForm" @submit.prevent="onPasswordLogin">
      <el-form-item>
        <el-input v-model="form.employeeNo" placeholder="工号" data-testid="login-employee-no" />
      </el-form-item>
      <el-form-item>
        <el-input v-model="form.password" type="password" placeholder="密码" show-password data-testid="login-password" />
      </el-form-item>
      <el-button type="primary" :loading="loading" class="full" native-type="submit" data-testid="login-submit">登录</el-button>
    </el-form>

    <div v-if="isDev" class="quick-login">
      <el-divider><span class="quick-login__hint">测试账号快速登录（仅开发环境）</span></el-divider>
      <div class="quick-login__grid">
        <el-button
          v-for="acc in quickAccounts"
          :key="acc.employeeNo"
          :type="acc.type"
          plain
          size="small"
          :loading="quickLoadingNo === acc.employeeNo"
          :disabled="!!quickLoadingNo && quickLoadingNo !== acc.employeeNo"
          @click="quickLogin(acc.employeeNo)"
        >
          {{ acc.role }}
        </el-button>
      </div>
    </div>
  </el-card>
</template>

<style scoped>
.login-card {
  width: 360px;
  padding: 12px;
}
.login-logo {
  display: block;
  height: 56px;
  width: auto;
  margin: 12px auto 4px;
  object-fit: contain;
}
.title {
  text-align: center;
  color: var(--app-text-secondary, #646a73);
  font-size: 16px;
  font-weight: 500;
  margin: 4px 0 24px;
}
.dingtalk-btn,
.full {
  width: 100%;
}
.other {
  cursor: pointer;
  color: #909399;
  font-size: 13px;
}
.quick-login {
  margin-top: 8px;
}
.quick-login__hint {
  color: #c0c4cc;
  font-size: 12px;
}
.quick-login__grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.quick-login__grid .el-button {
  margin: 0;
}
</style>
