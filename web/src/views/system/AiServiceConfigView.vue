<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { aiProgressApi } from '@/api/ai-progress.api';
import { usersApi } from '@/api/users.api';
import type { AiConfigState, AiProvider, SaveAiProviderBody, User } from '@/types/api.types';

const labels: Record<AiProvider, string> = { kimi: 'Kimi', deepseek: 'DeepSeek', qwen: '千问' };
const regions = [
  { value: 'cn-beijing', label: '中国内地（北京）' },
  { value: 'ap-southeast-1', label: '新加坡' },
  { value: 'us-east-1', label: '美国（弗吉尼亚）' },
  { value: 'eu-central-1', label: '德国（法兰克福）' },
  { value: 'ap-northeast-1', label: '日本（东京）' },
  { value: 'cn-hongkong', label: '中国香港' },
];
type Draft = { modelId: string; apiKey: string; replaceKey: boolean; region: string; workspaceId: string };
const emptyDraft = (): Draft => ({ modelId: '', apiKey: '', replaceKey: false, region: '', workspaceId: '' });
const drafts = reactive<Record<AiProvider, Draft>>({ kimi: emptyDraft(), deepseek: emptyDraft(), qwen: emptyDraft() });
const selected = ref<AiProvider>('kimi');
const state = ref<AiConfigState>();
const busy = ref('');
const loading = ref(true);
const loadError = ref('');
const feedback = ref('');
const feedbackError = ref(false);
const errors = reactive({ modelId: '', apiKey: '', workspaceId: '' });
const users = ref<User[]>([]);
const usersLoading = ref(false);
const usersError = ref('');
const userIds = ref<string[]>([]);
const allowlistFeedback = ref('');
const botError = ref('');
const summary = computed(() => state.value?.providers.find((item) => item.provider === selected.value));
const draft = computed(() => drafts[selected.value]);
const dirty = computed(() => draft.value.modelId !== (summary.value?.modelId ?? '')
  || draft.value.region !== (summary.value?.region ?? '')
  || draft.value.workspaceId !== (summary.value?.workspaceId ?? '')
  || draft.value.replaceKey || Boolean(draft.value.apiKey));
const tested = computed(() => Boolean(summary.value?.tested
  && summary.value.testedVersion === summary.value.configVersion));
const disabled = computed(() => Boolean(busy.value) || !state.value?.encryptionReady);

function hydrateDraft(provider: AiProvider) {
  const saved = state.value?.providers.find((item) => item.provider === provider);
  Object.assign(drafts[provider], emptyDraft(), { modelId: saved?.modelId ?? '',
    region: saved?.region ?? '', workspaceId: saved?.workspaceId ?? '' });
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    state.value = await aiProgressApi.getConfig();
    for (const provider of ['kimi', 'deepseek', 'qwen'] as const) hydrateDraft(provider);
    userIds.value = [...state.value.allowlist];
    await searchUsers('');
    // Resolve already-selected people even when outside the first search page.
    const missing = userIds.value.filter((id) => !users.value.some((user) => user.id === id));
    const results = await Promise.allSettled(missing.map((id) => usersApi.findOne(id)));
    for (const result of results) if (result.status === 'fulfilled') users.value.push(result.value);
  } catch {
    state.value = undefined;
    loadError.value = 'AI 服务配置读取失败，请重试。';
  } finally { loading.value = false; }
}

let searchVersion = 0;
async function searchUsers(keyword: string) {
  const version = ++searchVersion;
  usersLoading.value = true;
  usersError.value = '';
  try {
    const results = await Promise.all((['active', 'probation'] as const).map(status =>
      usersApi.findAll({ keyword, page: 1, pageSize: 100, status })));
    if (version !== searchVersion) return;
    const chosen = users.value.filter((user) => userIds.value.includes(user.id));
    users.value = [...new Map([...chosen, ...results.flatMap(result => result.items)].map(user => [user.id, user])).values()];
  } catch {
    if (version === searchVersion) usersError.value = '人员读取失败，请重新输入姓名或工号查询。';
  } finally { if (version === searchVersion) usersLoading.value = false; }
}

function clearFeedback() {
  feedback.value = '';
  Object.assign(errors, { modelId: '', apiKey: '', workspaceId: '' });
}

async function save() {
  clearFeedback();
  const value = draft.value;
  const replace = !summary.value?.configured || value.replaceKey;
  if (!value.modelId) errors.modelId = '请填写模型标识';
  else if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value.modelId)) errors.modelId = '模型标识仅支持字母、数字、点、下划线、冒号和短横线，最多128字符';
  if (replace && !value.apiKey) errors.apiKey = '请填写 API Key';
  else if (replace && (!/^\S+$/.test(value.apiKey) || value.apiKey.length > 4096)) errors.apiKey = 'API Key 不能包含空白，最多4096字符';
  if (selected.value === 'qwen') {
    if (['eu-central-1', 'ap-northeast-1'].includes(value.region) && !value.workspaceId) errors.workspaceId = '该地域需要填写工作空间标识';
    else if (value.workspaceId && !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(value.workspaceId)) errors.workspaceId = '工作空间标识仅支持字母、数字和中间短横线，最多63字符';
  }
  if (Object.values(errors).some(Boolean)) return;
  const body: SaveAiProviderBody = { modelId: value.modelId };
  if (replace) body.apiKey = value.apiKey;
  if (selected.value === 'qwen') {
    if (value.region) body.region = value.region;
    if (value.workspaceId) body.workspaceId = value.workspaceId;
  }
  busy.value = 'save';
  try {
    state.value = await aiProgressApi.saveProvider(selected.value, body);
    hydrateDraft(selected.value);
    feedbackError.value = false;
    feedback.value = '服务商配置已保存，请测试连接后再启用。';
  } catch {
    feedbackError.value = true;
    feedback.value = '服务商配置保存失败，输入已保留，请重试。';
  } finally { busy.value = ''; }
}

const testErrors: Record<string, string> = {
  config_changed: '配置已变更，请重新测试当前配置。',
  credential_unavailable: '凭据不可用，请联系部署管理员检查加密配置或重新录入 API Key。',
  timeout: '服务商连接超时，请稍后重新测试。',
  authentication_failed: '服务商认证失败，请检查 API Key 后重新保存并测试。',
  rate_limited: '服务商限流或额度不足，请检查服务商账户后重新测试。',
};
async function testConnection() {
  feedback.value = '';
  busy.value = 'test';
  try {
    const result = await aiProgressApi.testProvider(selected.value);
    state.value = await aiProgressApi.getConfig();
    const currentVersion = summary.value?.configVersion;
    const valid = result.success && result.configVersion === currentVersion && tested.value;
    if (!valid && summary.value) summary.value.tested = false;
    feedbackError.value = !valid;
    feedback.value = valid ? '连接测试成功，可启用此服务商。' : testErrors[result.errorCode ?? 'config_changed']
      ?? '服务商测试失败，请检查模型、地域及账户配置后重新测试。';
  } catch {
    // A failed refresh must not leave an older successful test actionable.
    if (summary.value) summary.value.tested = false;
    feedbackError.value = true;
    feedback.value = '连接测试未完成，请重新读取配置后再测试。';
  } finally { busy.value = ''; }
}

async function activate() {
  busy.value = 'activate'; feedback.value = '';
  try {
    state.value = await aiProgressApi.activateProvider(selected.value);
    feedbackError.value = false;
    feedback.value = '服务商已启用，仅对新消息生效。';
  } catch {
    if (summary.value) summary.value.tested = false;
    feedbackError.value = true;
    feedback.value = '服务商启用失败，请重新读取并测试当前配置。';
  } finally { busy.value = ''; }
}

async function toggleBot(enabled: string | number | boolean) {
  busy.value = 'bot'; botError.value = '';
  try { state.value = await aiProgressApi.setBotEnabled(enabled === true); }
  catch { botError.value = '机器人开关保存失败，请重新读取配置后重试。'; }
  finally { busy.value = ''; }
}

async function saveAllowlist() {
  if (userIds.value.length > 1000) { allowlistFeedback.value = '试运行名单最多1000人，请减少人数后保存。'; return; }
  busy.value = 'allowlist'; allowlistFeedback.value = '';
  try {
    state.value = await aiProgressApi.setAllowlist([...userIds.value]);
    allowlistFeedback.value = '试运行名单已保存';
  } catch { allowlistFeedback.value = '试运行名单保存失败，选择已保留，请核对人员后重试。'; }
  finally { busy.value = ''; }
}

onMounted(load);
</script>

<template>
  <main class="ai-config" aria-label="AI 服务配置">
    <p v-if="loading" role="status">正在读取 AI 服务配置…</p>
    <template v-else-if="loadError">
      <el-alert :title="loadError" type="error" :closable="false" />
      <el-button class="retry" @click="load">重新读取</el-button>
    </template>
    <template v-else-if="state">
      <el-alert v-if="!state.encryptionReady" title="凭据加密尚未就绪，请联系部署管理员配置后重试。" type="warning" :closable="false" />
      <section class="config-panel" aria-label="目标进展识别服务商">
        <div class="panel-heading"><h2>目标进展识别</h2><span>当前使用：{{ state.activeProvider ? labels[state.activeProvider] : '未启用' }}</span></div>
        <p class="hint">先保存配置，再使用样例测试连接，测试通过后启用。修改正在使用的配置会关闭机器人，需重新测试并启用。</p>
        <el-radio-group v-model="selected" aria-label="AI 服务商" :disabled="Boolean(busy)" @change="clearFeedback">
          <el-radio-button value="kimi">Kimi</el-radio-button>
          <el-radio-button value="deepseek">DeepSeek</el-radio-button>
          <el-radio-button value="qwen">千问</el-radio-button>
        </el-radio-group>
        <p class="provider-status"><el-tag :type="summary?.configured ? 'success' : 'info'">{{ summary?.configured ? '已配置' : '未配置' }}</el-tag>
          <span>{{ tested ? '当前配置测试通过' : '当前配置待测试' }}</span>
          <span v-if="summary?.configVersion">配置版本 {{ summary.configVersion }}</span>
          <span v-if="summary?.testedAt">最近测试：{{ new Date(summary.testedAt).toLocaleString('zh-CN') }}</span>
        </p>
        <el-form label-position="top" :disabled="disabled" @submit.prevent="save">
          <el-form-item label="模型标识" :error="errors.modelId">
            <el-input v-model="draft.modelId" maxlength="128" autocomplete="off" @input="errors.modelId = ''" />
          </el-form-item>
          <el-checkbox v-if="summary?.configured" v-model="draft.replaceKey">替换 API Key</el-checkbox>
          <el-form-item label="API Key" :error="errors.apiKey">
            <el-input v-model="draft.apiKey" type="password" autocomplete="new-password" maxlength="4096"
              :disabled="disabled || (summary?.configured && !draft.replaceKey)" @input="errors.apiKey = ''" />
            <p class="field-hint">{{ summary?.configured ? '已保存的密钥不回显。仅勾选替换并填写新值时更新密钥。' : '首次配置需要填写密钥，保存后输入框清空。' }}</p>
          </el-form-item>
          <template v-if="selected === 'qwen'">
            <el-form-item label="地域"><el-select v-model="draft.region" clearable placeholder="默认地域（北京）">
              <el-option v-for="region in regions" :key="region.value" :value="region.value" :label="region.label" />
            </el-select></el-form-item>
            <el-form-item label="工作空间标识" :error="errors.workspaceId"><el-input v-model="draft.workspaceId" maxlength="63" @input="errors.workspaceId = ''" />
              <p class="field-hint">德国、日本地域必须填写；其他地域按服务商账户配置。</p>
            </el-form-item>
          </template>
          <p v-if="selected === 'kimi'" class="hint">请使用 Kimi API 开放平台凭据。</p>
          <div class="actions">
            <el-button type="primary" :loading="busy === 'save'" :disabled="disabled" @click="save">保存服务商配置</el-button>
            <el-button :loading="busy === 'test'" :disabled="disabled || !summary?.configured || dirty" @click="testConnection">测试连接</el-button>
            <el-button :loading="busy === 'activate'" :disabled="disabled || !tested || dirty || summary?.active" @click="activate">启用此服务商</el-button>
          </div>
          <p v-if="dirty" class="hint">有未保存的修改，请先保存再测试或启用。</p>
        </el-form>
        <p v-if="feedback" role="status" class="feedback" :class="{ error: feedbackError }">{{ feedback }}</p>
      </section>
      <section class="config-panel" aria-label="机器人试运行">
        <div class="panel-heading"><h2>机器人试运行</h2><span>{{ state.botEnabled ? '机器人已开启' : '机器人已关闭' }}</span></div>
        <el-switch :model-value="state.botEnabled" aria-label="目标进展机器人" :loading="busy === 'bot'"
          :disabled="Boolean(busy) || (!state.botEnabled && (!state.encryptionReady || !state.activeProvider))" @change="toggleBot" />
        <p class="hint">启用服务商后可开启机器人。只有已保存试运行名单内的人员可使用；空名单不向任何人开放。</p>
        <p v-if="botError" role="status" class="error">{{ botError }}</p>
        <el-form label-position="top" :disabled="Boolean(busy)" @submit.prevent="saveAllowlist">
          <el-form-item label="试运行人员" :error="usersError">
            <el-select v-model="userIds" multiple filterable remote :reserve-keyword="false" fit-input-width popper-class="ai-user-options" :remote-method="searchUsers" :loading="usersLoading"
              placeholder="搜索 HRM 姓名或工号" collapse-tags collapse-tags-tooltip :max-collapse-tags="3">
              <el-option v-for="user in users" :key="user.id" :value="user.id" :label="`${user.name}（${user.employeeNo || '无工号'}）${user.deptName || ''}`" />
              <el-option v-for="id in userIds.filter((id) => !users.some((user) => user.id === id))" :key="id" :value="id" :label="`已选人员（${id}）`" />
            </el-select>
          </el-form-item>
          <el-button type="primary" :loading="busy === 'allowlist'" :disabled="Boolean(busy)" @click="saveAllowlist">保存试运行名单</el-button>
        </el-form>
        <p v-if="allowlistFeedback" role="status">{{ allowlistFeedback }}</p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.ai-config { padding: 24px; max-width: 1000px; min-width: 0; margin: 0 auto; box-sizing: border-box; }
.config-panel { padding: 22px; margin-bottom: 18px; border: 1px solid var(--el-border-color-light); border-radius: 8px; background: white; min-width: 0; }
.panel-heading, .provider-status, .actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.panel-heading { justify-content: space-between; }
h2 { margin: 0; font-size: 16px; }
.hint, .field-hint, .provider-status { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; }
.field-hint { margin: 6px 0 0; width: 100%; }
.el-select { width: 100%; min-width: 0; }
.actions .el-button { margin-left: 0; }
.feedback { margin-bottom: 0; }
.error { color: var(--el-color-danger); }
p, span { overflow-wrap: anywhere; }
.retry { margin-top: 12px; }
:global(.ai-user-options) { max-width: calc(100vw - 24px); }
@media (max-width: 768px) {
  .ai-config { padding: 12px; }
  .config-panel { padding: 16px; }
  .actions { gap: 8px; }
  .actions .el-button { flex: 1 1 100%; }
}
</style>
