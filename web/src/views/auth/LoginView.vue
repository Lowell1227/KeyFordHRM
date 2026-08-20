<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth.store';
import { loadDingTalkJsApi } from '@/utils/dingtalk-jsapi';
import { dingtalkLoginErrorMessage } from '@/utils/dingtalk-login-error';
import { authApi, type TestAccount } from '@/api/auth.api';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const isDingTalkEnv = computed(() => navigator.userAgent.includes('DingTalk'));
const dingtalkButtonText = computed(() => (
  isDingTalkEnv.value ? '钉钉内免登' : '选择钉钉账号/组织登录'
));
const showPasswordForm = ref(false);
const loading = ref(false);
const form = reactive({ employeeNo: '', password: '' });

const DINGTALK_APP_KEY = import.meta.env.VITE_DINGTALK_APP_KEY || 'dinghwbnyktt3oku2jd3';
const DINGTALK_CORP_ID = import.meta.env.VITE_DINGTALK_CORP_ID || '';

const testAccounts = ref<TestAccount[]>([]);
const quickLoadingNo = ref<string | null>(null);

onMounted(async () => {
  try {
    const result = await authApi.getTestAccounts();
    testAccounts.value = result.enabled ? result.accounts : [];
  } catch {
    testAccounts.value = [];
  }
});

function isAuthFailure(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 401;
}

async function quickLogin(employeeNo: string) {
  if (loading.value || quickLoadingNo.value) return;
  quickLoadingNo.value = employeeNo;
  try {
    await auth.loginWithTestAccount(employeeNo);
    redirectAfterLogin();
  } catch {
    ElMessage.error('测试账号暂不可用，请联系系统管理员检查测试数据');
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

async function onDingTalkLogin() {
  if (loading.value) return;

  if (isDingTalkEnv.value) {
    if (!DINGTALK_CORP_ID) {
      ElMessage.error('缺少钉钉企业 CorpId 配置，请联系管理员检查 VITE_DINGTALK_CORP_ID');
      return;
    }
    let dingTalkJsApi;
    try {
      dingTalkJsApi = await loadDingTalkJsApi();
    } catch {
      ElMessage.error('钉钉 JSAPI 未加载，请在钉钉客户端内重新打开页面');
      return;
    }

    loading.value = true;
    let authSettled = false;
    const onSuccess = async (res: { code: string }) => {
      if (authSettled) return;
      authSettled = true;
      try {
        await auth.loginWithDingTalk(res.code, 'internal');
        redirectAfterLogin();
      } catch (error) {
        ElMessage.error(dingtalkLoginErrorMessage(error));
      } finally {
        loading.value = false;
      }
    };
    const onFail = (err: unknown) => {
      if (authSettled) return;
      authSettled = true;
      console.error('DingTalk requestAuthCode failed', err);
      ElMessage.error('获取钉钉授权失败，请稍后重试');
      loading.value = false;
    };
    try {
      const result = dingTalkJsApi.requestAuthCode({
        corpId: DINGTALK_CORP_ID,
        clientId: DINGTALK_APP_KEY,
        onSuccess,
        onFail,
      });
      if (result && typeof result.then === 'function') void result.then(onSuccess, onFail);
    } catch (error) {
      onFail(error);
    }
    return;
  }

  loading.value = true;
  const params = new URLSearchParams({
    redirect_uri: getDingTalkRedirectUri(),
    response_type: 'code',
    client_id: DINGTALK_APP_KEY,
    scope: 'openid corpid',
    prompt: 'consent',
    corpId: DINGTALK_CORP_ID,
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
    <img src="/brand/logo-2025.png" alt="KAYFORD 孚德" class="login-logo" />
    <h2 class="title">绩效管理系统</h2>
    <el-button type="primary" size="large" class="dingtalk-btn" :loading="loading" @click="onDingTalkLogin">
      {{ dingtalkButtonText }}
    </el-button>

    <p class="login-guidance">公司员工请使用钉钉账号登录；新浏览器首次使用需完成钉钉授权</p>
    <p class="org-guidance">多组织账号请在钉钉授权页选择应用所属企业</p>
    <a
      class="manual-link"
      href="/manual/index.html"
      target="_blank"
      rel="noopener noreferrer"
    >
      查看系统操作与验收手册
    </a>

    <el-divider>
      <span class="other" @click="showPasswordForm = !showPasswordForm">管理员账号登录</span>
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

    <div v-if="testAccounts.length" class="quick-login" data-testid="test-account-login">
      <el-divider><span class="quick-login__hint">测试账号快捷登录</span></el-divider>
      <div class="quick-login__grid">
        <el-button
          v-for="acc in testAccounts"
          :key="acc.employeeNo"
          plain
          class="quick-login__account"
          :loading="quickLoadingNo === acc.employeeNo"
          :disabled="!!quickLoadingNo && quickLoadingNo !== acc.employeeNo"
          data-testid="test-account-login-button"
          @click="quickLogin(acc.employeeNo)"
        >
          <span class="quick-login__role">{{ acc.roleLabel }}</span>
          <span class="quick-login__name">{{ acc.name }}</span>
          <span class="quick-login__no">{{ acc.employeeNo }}</span>
        </el-button>
      </div>
    </div>
  </el-card>
</template>

<style scoped>
.login-card {
  width: 420px;
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
.login-guidance,
.org-guidance {
  margin: 10px 0 0;
  text-align: center;
  color: var(--app-text-secondary, #646a73);
  font-size: 12px;
  line-height: 1.6;
}
.org-guidance {
  color: var(--el-color-warning-dark-2, #b88230);
}
.manual-link {
  display: block;
  width: fit-content;
  margin: 12px auto 0;
  color: var(--el-color-primary);
  font-size: 13px;
  text-decoration: none;
}
.manual-link:hover {
  text-decoration: underline;
}
.manual-link:focus-visible {
  outline: 2px solid var(--el-color-primary-light-5);
  outline-offset: 3px;
  border-radius: 2px;
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
  color: var(--app-text-secondary, #646a73);
  font-size: 12px;
}
.quick-login__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.quick-login__account.el-button {
  margin: 0;
  height: 48px;
  padding: 6px 10px;
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: 8px;
  text-align: left;
}
.quick-login__role {
  grid-row: 1 / 3;
  align-self: center;
  min-width: 48px;
  color: var(--el-color-primary);
  font-weight: 600;
}
.quick-login__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.quick-login__no {
  color: var(--app-text-tertiary, #8f959e);
  font-size: 11px;
}
@media (max-width: 520px) {
  .login-card {
    width: calc(100vw - 32px);
  }
  .quick-login__grid {
    grid-template-columns: 1fr;
  }
}
</style>
