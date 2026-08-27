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
const showTestAccounts = ref(false);

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
    const passwordChangeRequired = await auth.loginWithPassword(form.employeeNo, form.password);
    if (passwordChangeRequired) {
      await router.replace({ name: 'ChangePassword' });
    } else {
      redirectAfterLogin();
    }
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
  <section class="login-shell" data-testid="login-shell">
    <aside class="brand-panel" data-testid="login-brand-panel">
      <img
        src="/brand/logo-2025-horizontal-inverse.png"
        alt=""
        aria-hidden="true"
        class="brand-logo"
      />

      <div class="brand-orbit" aria-hidden="true">
        <span class="brand-orbit__outer"></span>
        <span class="brand-orbit__inner"></span>
        <span class="brand-orbit__core"></span>
      </div>

      <div class="brand-copy">
        <p class="brand-eyebrow">KAYFORD PERFORMANCE</p>
        <h1>让目标更清晰，<br />让成长被看见</h1>
        <p class="brand-description">连接目标、过程与结果，让每一次绩效沟通都有依据。</p>
      </div>

      <div class="brand-footer" aria-label="产品价值">
        <span>目标对齐</span>
        <span>过程跟进</span>
        <span>结果沉淀</span>
      </div>
    </aside>

    <main class="auth-panel" data-testid="login-auth-panel">
      <div class="auth-content">
        <img src="/brand/logo-2025.png" alt="KAYFORD 孚德" class="login-logo" />

        <header class="auth-heading">
          <p class="auth-eyebrow">绩效管理系统</p>
          <h2>欢迎登录</h2>
          <p>使用企业身份进入你的绩效工作台</p>
        </header>

        <el-button
          type="primary"
          size="large"
          class="dingtalk-btn"
          :loading="loading"
          @click="onDingTalkLogin"
        >
          {{ dingtalkButtonText }}
        </el-button>

        <a
          class="manual-link"
          href="/manual/index.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6.5 4.75h8.75A2.75 2.75 0 0 1 18 7.5v11.75H8.75A2.75 2.75 0 0 1 6 16.5V5.25a.5.5 0 0 1 .5-.5Z" />
            <path d="M6 16.5a2.75 2.75 0 0 1 2.75-2.75H18M9.5 8h5" />
          </svg>
          查看系统操作与验收手册
        </a>

        <div class="auth-options">
          <button
            type="button"
            class="auth-option"
            data-testid="password-login-toggle"
            :aria-expanded="showPasswordForm"
            @click="showPasswordForm = !showPasswordForm"
          >
            <span class="auth-option__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="5" y="10" width="14" height="10" rx="2" />
                <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M12 14.25v2.5" />
              </svg>
            </span>
            <span class="auth-option__copy">
              <strong>密码登录</strong>
              <small>账号为工号，初始密码为 0000</small>
            </span>
            <span class="auth-option__arrow" :class="{ 'is-open': showPasswordForm }" aria-hidden="true">⌄</span>
          </button>

          <transition name="field-reveal">
            <el-form v-show="showPasswordForm" class="password-form" aria-label="密码登录表单" @submit.prevent="onPasswordLogin">
              <el-form-item>
                <label class="sr-only" for="login-employee-no">工号</label>
                <el-input
                  id="login-employee-no"
                  v-model="form.employeeNo"
                  autocomplete="username"
                  placeholder="工号"
                  data-testid="login-employee-no"
                />
              </el-form-item>
              <el-form-item>
                <label class="sr-only" for="login-password">密码</label>
                <el-input
                  id="login-password"
                  v-model="form.password"
                  type="password"
                  autocomplete="current-password"
                  placeholder="密码"
                  show-password
                  data-testid="login-password"
                />
              </el-form-item>
              <el-button type="primary" :loading="loading" class="full" native-type="submit" data-testid="login-submit">登录</el-button>
            </el-form>
          </transition>

          <button
            v-if="testAccounts.length"
            type="button"
            class="auth-option auth-option--test"
            data-testid="test-account-login-toggle"
            :aria-expanded="showTestAccounts"
            @click="showTestAccounts = true"
          >
            <span class="auth-option__icon auth-option__icon--test" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M7 4.75h10A2.25 2.25 0 0 1 19.25 7v10A2.25 2.25 0 0 1 17 19.25H7A2.25 2.25 0 0 1 4.75 17V7A2.25 2.25 0 0 1 7 4.75Z" />
                <path d="m8.5 12 2.25 2.25 4.75-4.75" />
              </svg>
            </span>
            <span class="auth-option__copy">
              <strong>验收账号登录</strong>
              <small>仅用于测试组织与测试数据</small>
            </span>
            <span class="auth-option__meta">{{ testAccounts.length }} 个场景</span>
            <span class="auth-option__arrow auth-option__arrow--right" aria-hidden="true">›</span>
          </button>
        </div>

        <p class="security-note">
          <span aria-hidden="true"></span>
          企业身份认证 · 数据安全保护
        </p>
      </div>
    </main>
  </section>

  <el-dialog
    v-model="showTestAccounts"
    title="验收账号登录"
    width="680px"
    align-center
    destroy-on-close
    class="test-account-dialog"
    modal-class="test-account-overlay"
  >
    <div class="quick-login" data-testid="test-account-login">
      <p class="quick-login__lead">选择一个业务场景，直接进入对应的验收工作台。</p>
      <p class="quick-login__boundary">
        <span aria-hidden="true">i</span>
        仅用于测试组织与测试数据，不关联钉钉和真实员工
      </p>
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
          <span class="quick-login__content">
            <span class="quick-login__role">{{ acc.roleLabel }}</span>
            <span class="quick-login__details">
              <span class="quick-login__name">{{ acc.name }}</span>
              <span class="quick-login__no">{{ acc.employeeNo }}</span>
            </span>
          </span>
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.login-shell {
  position: relative;
  display: grid;
  grid-template-columns: 48% 52%;
  width: min(1120px, calc(100vw - 64px));
  min-height: min(640px, calc(100dvh - 64px));
  overflow: hidden;
  border: 1px solid rgba(8, 30, 52, 0.08);
  border-radius: 24px;
  background: #fcfdfe;
  box-shadow:
    0 32px 80px rgba(12, 35, 58, 0.16),
    0 4px 14px rgba(12, 35, 58, 0.06);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  padding: 0;
  border: 0;
  margin: -1px;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.brand-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  padding: 50px 52px 42px;
  color: #fff;
  background:
    radial-gradient(circle at 82% 26%, rgba(72, 211, 179, 0.22), transparent 28%),
    linear-gradient(145deg, #071a30 0%, #0b2a4a 54%, #0e3a5d 100%);
}

.brand-panel::after {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(115deg, transparent 0 58%, rgba(255, 255, 255, 0.035) 58% 58.25%, transparent 58.25%),
    linear-gradient(155deg, transparent 0 68%, rgba(255, 255, 255, 0.025) 68% 68.2%, transparent 68.2%);
  content: '';
}

.brand-logo {
  position: relative;
  z-index: 2;
  display: block;
  width: 230px;
  height: auto;
  object-fit: contain;
}

.brand-orbit {
  position: absolute;
  top: 82px;
  right: -94px;
  width: 340px;
  height: 340px;
  pointer-events: none;
}

.brand-orbit span {
  position: absolute;
  inset: 50%;
  display: block;
  border-radius: 50%;
  transform: translate(-50%, -50%);
}

.brand-orbit__outer {
  width: 330px;
  height: 330px;
  border: 1px solid rgba(126, 229, 205, 0.18);
}

.brand-orbit__inner {
  width: 222px;
  height: 222px;
  border: 38px solid rgba(79, 201, 188, 0.075);
  box-shadow: 0 0 80px rgba(87, 220, 191, 0.08);
}

.brand-orbit__core {
  width: 76px;
  height: 76px;
  background: linear-gradient(145deg, rgba(67, 181, 221, 0.2), rgba(132, 215, 42, 0.18));
  box-shadow: 0 0 48px rgba(80, 211, 187, 0.15);
}

.brand-copy {
  position: relative;
  z-index: 2;
  margin: auto 0;
  padding: 54px 0 38px;
}

.brand-eyebrow {
  margin: 0 0 18px;
  color: #66d6c3;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.18em;
}

.brand-copy h1 {
  margin: 0;
  color: #fff;
  font-size: clamp(36px, 3.3vw, 48px);
  font-weight: 600;
  line-height: 1.28;
  letter-spacing: -0.04em;
}

.brand-description {
  max-width: 360px;
  margin: 24px 0 0;
  color: rgba(229, 240, 248, 0.72);
  font-size: 15px;
  line-height: 1.8;
}

.brand-footer {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 0;
  color: rgba(226, 239, 247, 0.62);
  font-size: 12px;
  letter-spacing: 0.08em;
}

.brand-footer span + span::before {
  display: inline-block;
  width: 3px;
  height: 3px;
  margin: 0 13px 3px;
  border-radius: 50%;
  background: #61cdb9;
  content: '';
}

.auth-panel {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 44px clamp(48px, 5.7vw, 78px);
  background:
    radial-gradient(circle at 100% 0, rgba(71, 190, 172, 0.055), transparent 30%),
    #fcfdfe;
}

.auth-content {
  width: 100%;
  max-width: 390px;
  margin: auto;
}

.login-logo {
  display: block;
  width: 132px;
  height: auto;
  margin: 0 0 34px;
  object-fit: contain;
}

.auth-heading {
  margin-bottom: 24px;
}

.auth-eyebrow {
  margin: 0 0 6px;
  color: #536f70;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.09em;
}

.auth-heading h2 {
  margin: 0;
  color: #193047;
  font-size: 27px;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: -0.025em;
}

.auth-heading > p:last-child {
  margin: 6px 0 0;
  color: #66727e;
  font-size: 13px;
  line-height: 1.5;
}

.dingtalk-btn.el-button,
.full.el-button {
  width: 100%;
  height: 48px;
  border-radius: 11px;
  font-size: 15px;
  font-weight: 600;
}

.dingtalk-btn.el-button {
  --el-button-bg-color: #1677ff;
  --el-button-border-color: #1677ff;
  --el-button-hover-bg-color: #0f68e8;
  --el-button-hover-border-color: #0f68e8;
  --el-button-active-bg-color: #0d5dcc;
  box-shadow: 0 12px 24px rgba(22, 119, 255, 0.19);
}

.manual-link {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: fit-content;
  min-height: 40px;
  margin: 8px auto 0;
  padding: 8px 4px;
  color: #53677a;
  font-size: 13px;
  text-decoration: none;
  transition: color 0.2s ease;
}

.manual-link svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
}

.manual-link:hover {
  color: #1677ff;
}

.manual-link:focus-visible,
.auth-option:focus-visible {
  outline: 2px solid rgba(22, 119, 255, 0.42);
  outline-offset: 3px;
}

.auth-options {
  margin-top: 20px;
  border-top: 1px solid #e8edf1;
}

.auth-option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 64px;
  padding: 11px 4px;
  border: 0;
  border-bottom: 1px solid #e8edf1;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.auth-option__icon {
  display: grid;
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 10px;
  color: #53677a;
  background: #f1f4f6;
}

.auth-option__icon--test {
  color: #178477;
  background: #ebf7f4;
}

.auth-option__icon svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}

.auth-option__copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 3px;
}

.auth-option__copy strong {
  color: #2d3e4f;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
}

.auth-option__copy small {
  overflow: hidden;
  color: #66727e;
  font-size: 11px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.auth-option__meta {
  flex: none;
  color: #667887;
  font-size: 12px;
}

.auth-option__arrow {
  flex: none;
  color: #9aa5ae;
  font-size: 18px;
  line-height: 1;
  transform: rotate(0deg);
  transition: transform 0.2s ease;
}

.auth-option__arrow.is-open {
  transform: rotate(180deg);
}

.auth-option__arrow--right {
  font-size: 23px;
}

.password-form {
  padding: 18px 0 20px;
  border-bottom: 1px solid #e8edf1;
}

.password-form :deep(.el-form-item) {
  margin-bottom: 12px;
}

.password-form :deep(.el-input__wrapper) {
  min-height: 42px;
  border-radius: 9px;
  box-shadow: 0 0 0 1px #dce3e8 inset;
}

.security-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin: 22px 0 0;
  color: #66727e;
  font-size: 11px;
  letter-spacing: 0.03em;
}

.security-note span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #5bc1ad;
  box-shadow: 0 0 0 4px rgba(91, 193, 173, 0.12);
}

.field-reveal-enter-active,
.field-reveal-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.field-reveal-enter-from,
.field-reveal-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.quick-login__lead {
  margin: -2px 0 14px;
  color: #74808c;
  font-size: 13px;
  line-height: 1.6;
}

.quick-login__boundary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 18px;
  padding: 10px 12px;
  border: 1px solid #dceeea;
  border-radius: 10px;
  color: #51716e;
  background: #f2faf8;
  font-size: 12px;
  line-height: 1.5;
}

.quick-login__boundary span {
  display: grid;
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: #48a99b;
  font-family: Georgia, serif;
  font-size: 12px;
  font-weight: 700;
}

.quick-login__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.quick-login__account.el-button {
  margin: 0;
  height: 78px;
  min-width: 0;
  padding: 12px 14px;
  overflow: hidden;
  border-color: #e1e7eb;
  border-radius: 12px;
  background: #fbfcfd;
  text-align: left;
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}

.quick-login__account.el-button:hover,
.quick-login__account.el-button:focus-visible {
  border-color: #78c9bc;
  background: #f1faf8;
  transform: translateY(-1px);
}

.quick-login__content {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 9px;
  width: 100%;
  min-width: 0;
  line-height: 1.15;
}

.quick-login__role {
  display: block;
  min-width: 0;
  color: #1d4f4a;
  font-size: 14px;
  font-weight: 650;
  line-height: 1.25;
  white-space: normal;
}

.quick-login__details {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.quick-login__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #66727e;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-login__no {
  flex: none;
  white-space: nowrap;
  color: #66727e;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

:global(.test-account-overlay) {
  background: rgba(5, 21, 37, 0.48);
  backdrop-filter: blur(8px);
}

:global(.test-account-dialog) {
  overflow: hidden;
  margin: 0;
  border-radius: 20px;
  box-shadow: 0 28px 80px rgba(5, 24, 43, 0.24);
}

:global(.test-account-dialog .el-dialog__header) {
  margin: 0;
  padding: 24px 26px 12px;
}

:global(.test-account-dialog .el-dialog__title) {
  color: #153046;
  font-size: 20px;
  font-weight: 650;
}

:global(.test-account-dialog .el-dialog__headerbtn) {
  top: 17px;
  right: 18px;
}

:global(.test-account-dialog .el-dialog__body) {
  padding: 8px 26px 26px;
}

@media (max-width: 900px) {
  .login-shell {
    grid-template-columns: 44% 56%;
  }

  .brand-panel {
    padding-right: 38px;
    padding-left: 38px;
  }

  .brand-copy h1 {
    font-size: 34px;
  }

  .auth-panel {
    padding-right: 44px;
    padding-left: 44px;
  }
}

@media (max-width: 720px) {
  .login-shell {
    display: block;
    width: 100%;
    min-height: 100vh;
    min-height: 100dvh;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .brand-panel {
    display: none;
  }

  .auth-panel {
    min-height: 100vh;
    min-height: 100dvh;
    align-items: flex-start;
    padding: 36px 24px 30px;
  }

  .auth-content {
    max-width: 420px;
  }

  .login-logo {
    width: 122px;
    margin: 8px auto 34px;
  }

  .auth-heading {
    margin-bottom: 22px;
    text-align: center;
  }

  .auth-heading h2 {
    font-size: 25px;
  }

  .auth-option {
    min-height: 66px;
  }

  :global(.test-account-overlay .el-overlay-dialog) {
    align-items: flex-end;
    padding: 0;
  }

  :global(.test-account-dialog) {
    display: flex;
    flex-direction: column;
    width: 100% !important;
    max-width: none;
    max-height: 78vh;
    margin: 0 !important;
    border-radius: 22px 22px 0 0;
  }

  :global(.test-account-dialog .el-dialog__header) {
    flex: none;
    padding: 22px 22px 10px;
  }

  :global(.test-account-dialog .el-dialog__body) {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 18px 24px;
  }

  .quick-login__grid {
    grid-template-columns: 1fr;
  }

  .quick-login__account.el-button {
    height: 72px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .manual-link,
  .auth-option__arrow,
  .quick-login__account.el-button,
  .field-reveal-enter-active,
  .field-reveal-leave-active {
    transition: none;
  }

  :global(.dialog-fade-enter-active),
  :global(.dialog-fade-leave-active),
  :global(.dialog-fade-enter-active .el-overlay-dialog),
  :global(.dialog-fade-leave-active .el-overlay-dialog) {
    animation: none !important;
  }
}
</style>
