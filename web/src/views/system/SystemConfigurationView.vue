<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { systemConfigurationApi, type SystemConfigurationField, type SystemConfigurationView } from '@/api/system-configuration.api';
import RecruitmentMailboxesPanel from './RecruitmentMailboxesPanel.vue';

const route = useRoute();
const setting = computed(() => String(route.params.setting ?? ''));
const isMailboxCollection = computed(() => setting.value === 'recruitment-mail' && route.query.mailbox !== 'recruitment-mail');
const isMailbox = computed(() => setting.value === 'recruitment-mail' || setting.value.startsWith('recruitment-mail:'));
const config = ref<SystemConfigurationView>();
const draft = reactive<Record<string, string | boolean>>({});
const errors = reactive<Record<string, string>>({});
const loading = ref(false);
const loadError = ref('');
const busy = ref('');
const feedback = ref('');
const feedbackError = ref(false);
const conflict = ref(false);
const retainedInputs = ref(false);
const sampleInstanceId = ref('');
const sourceLabels = { deployment: '部署配置', database: '系统内保存', none: '尚未配置' };
const verificationLabels = { unknown: '无核验记录', untested: '当前版本待核验', passed: '当前版本核验通过', failed: '当前版本核验失败' };
const testLabel = computed(() => config.value?.testKind === 'connection' ? '测试连接'
  : config.value?.testKind === 'scope' ? '核验获准样本' : '核对配置');
const dirty = computed(() => Boolean(config.value?.fields.some(field => field.type === 'secret'
  ? Boolean(draft[field.key]) : draft[field.key] !== (field.value ?? (field.type === 'boolean' ? false : '')))));
const disabled = computed(() => loading.value || Boolean(busy.value));
const secretBlocked = computed(() => config.value?.encryptionReady === false && config.value.fields.some(field => field.type === 'secret'));
const canApply = computed(() => config.value && !dirty.value && !conflict.value && !disabled.value
  && config.value.revision > 0 && config.value.revision !== config.value.appliedRevision
  && config.value.verification === 'passed');
const usesDingTalkApp = computed(() => ['dingtalk-login', 'dingtalk-notifications', 'dingtalk-calendar', 'recruitment-demand', 'payroll-attendance'].includes(setting.value));
const differences = computed(() => !retainedInputs.value ? [] : (config.value?.fields ?? []).flatMap(field => {
  if (field.type === 'secret') return [];
  const current = field.value ?? (field.type === 'boolean' ? false : '');
  const retained = draft[field.key] ?? (field.type === 'boolean' ? false : '');
  return current === retained ? [] : [{ key: field.key, label: field.label,
    current: comparisonValue(field, current), retained: comparisonValue(field, retained) }];
}));
const fieldGuidance: Record<string, string> = {
  DINGTALK_CORP_ID: '从钉钉开放平台的本企业信息取得 CorpId，须与当前 HRM 企业应用所属企业一致。',
  DINGTALK_APP_KEY: '从钉钉开放平台中用于 HRM 登录的企业内部应用取得 AppKey；各钉钉功能共用此应用身份。',
  DINGTALK_APP_SECRET: '从同一 HRM 企业内部应用的凭证页面取得 AppSecret，勿使用另一个目标助手机器人的凭据。',
  DINGTALK_AGENT_ID: '从同一 HRM 企业内部应用的基础信息取得 AgentId，用于该应用的工作通知。',
  DINGTALK_REDIRECT_URI: '填写当前 HRM 访问地址加 /auth/callback，并与钉钉开放平台中该应用的登录回调设置保持一致。',
  DINGTALK_RECRUITMENT_PROCESS_CODE: '由获准管理员从目标招聘需求审批表单取得 processCode；填写表单标识，不填写表单名称。',
  DINGTALK_RECRUITMENT_DEPARTMENT_CONTROL_ID: '从同一审批表单设计或接口返回取得部门控件标识（componentId），不要填写部门名称。',
  DINGTALK_RECRUITMENT_POSITION_CONTROL_ID: '从同一审批表单取得岗位控件标识（componentId），不要填写具体岗位名称。',
  DINGTALK_RECRUITMENT_HEADCOUNT_CONTROL_ID: '从同一审批表单取得需求人数控件标识（componentId），不要填写本次招聘人数。',
  RECRUITMENT_MAIL_NAME: '自行填写便于识别的名称，用于收件时选择邮箱和追溯来源；不会修改邮箱账号。',
  RECRUITMENT_MAIL_PROVIDER: '选择该账号所属的邮箱服务商；系统使用对应的安全 IMAP 预设接收简历，无需填写 SMTP 发信参数。',
  RECRUITMENT_MAIL_ACCOUNT: '填写完整邮箱地址，须是已获准用于接收简历的邮箱账号。',
  RECRUITMENT_MAIL_ENABLED: '开启后仍需保存、测试并应用；实际读取时，在简历收件页选择该邮箱再点击读取。',
  RECRUITMENT_MAIL_FOLDER: '普通收件箱通常为 INBOX，可选用下方收件箱入口或手工填写专用目录的准确 IMAP 路径。仅填写已获准读取的文件夹，显示名称与 IMAP 路径可能不同。',
  RECRUITMENT_MAIL_AUTHORIZED_FROM: '选择获准开始接收简历的时间，只读取此后收到的邮件。按本机时区选择，保存时自动换算为 UTC；不会因保存或应用自动导入历史邮件。',
};
function fieldHelp(field: SystemConfigurationField): string {
  if (isMailbox.value && field.key === 'RECRUITMENT_MAIL_PASSWORD') {
    const provider = draft.RECRUITMENT_MAIL_PROVIDER;
    if (provider === 'qq') return '在 QQ 邮箱网页设置的客户端服务中开启 IMAP，并生成客户端授权码填入此处。不要填写网页登录密码。';
    if (provider === 'netease163' || provider === 'netease126') return `在网易 ${provider === 'netease163' ? '163' : '126'} 邮箱网页设置的 POP3/SMTP/IMAP 服务中开启 IMAP，生成客户端授权码填入此处；不要填写网页登录密码。若客户端身份被拒绝，先核对邮箱服务设置。`;
    return '在阿里企业邮箱的第三方客户端安全设置中开启 IMAP，取得客户端密码或授权码；若企业策略限制客户端访问，请邮箱管理员先授权。不要填写网页登录密码。';
  }
  return field.help || fieldGuidance[field.key] || '';
}
function comparisonValue(field: SystemConfigurationField, value: string | boolean): string {
  if (field.type === 'boolean') return value === true ? '开启' : '关闭';
  if (field.type === 'select') return field.options?.find(option => option.value === value)?.label || String(value || '未填写');
  return String(value || '未填写');
}
function useCurrentValue(key: string) {
  const field = config.value?.fields.find(item => item.key === key && item.type !== 'secret');
  if (field) { draft[key] = field.value ?? (field.type === 'boolean' ? false : ''); errors[key] = ''; }
}
function useInbox() { draft.RECRUITMENT_MAIL_FOLDER = 'INBOX'; errors.RECRUITMENT_MAIL_FOLDER = ''; }
let requestVersion = 0;

function clearErrors() { for (const key of Object.keys(errors)) delete errors[key]; }
function hydrate(value: SystemConfigurationView) {
  for (const key of Object.keys(draft)) delete draft[key];
  for (const field of value.fields) draft[field.key] = field.type === 'secret' ? '' : field.value ?? (field.type === 'boolean' ? false : '');
}
async function load(preserveInputs = false) {
  if (busy.value) return;
  const version = ++requestVersion;
  loading.value = true; loadError.value = ''; feedback.value = '';
  retainedInputs.value = false;
  if (!preserveInputs) { config.value = undefined; clearErrors(); sampleInstanceId.value = ''; }
  try {
    const result = await systemConfigurationApi.get(setting.value);
    if (version !== requestVersion) return;
    config.value = result;
    retainedInputs.value = preserveInputs;
    if (!preserveInputs) hydrate(result);
    conflict.value = false;
    if (preserveInputs) { feedbackError.value = false; feedback.value = '已读取最新版本，输入已保留。请核对当前字段后重新保存。'; }
  } catch {
    if (version !== requestVersion) return;
    loadError.value = '配置读取失败，请核对管理员资格后重试。';
  } finally { if (version === requestVersion) loading.value = false; }
}
async function syncRevision() { await load(true); }
function handleFailure(error: unknown, action: string) {
  feedbackError.value = true;
  const response = (error as { response?: { status?: number; data?: { data?: { fieldErrors?: Record<string, unknown> } } } })?.response;
  const status = response?.status;
  const fieldErrors = response?.data?.data?.fieldErrors;
  if (fieldErrors) for (const field of config.value?.fields ?? []) {
    const message = fieldErrors[field.key];
    if (typeof message === 'string') errors[field.key] = message;
  }
  if (status === 409) {
    retainedInputs.value = false;
    conflict.value = true;
    feedback.value = '配置版本或依赖已变化，输入已保留。请读取最新版本，核对后再保存和核验。';
  } else feedback.value = `${action}失败，输入已保留。请核对配置及管理员资格后重试。`;
}
async function save() {
  if (!config.value || disabled.value || conflict.value || secretBlocked.value) return;
  clearErrors(); feedback.value = '';
  const values: Record<string, string | boolean> = {};
  for (const field of config.value.fields) {
    const value = draft[field.key] ?? (field.type === 'boolean' ? false : '');
    if (field.type === 'select' && !field.options?.some(option => option.value === value)) errors[field.key] = `请选择${field.label}`;
    if (field.type === 'datetime' && value) {
      if (!Number.isFinite(Date.parse(String(value)))) errors[field.key] = `请选择有效的${field.label}`;
      else values[field.key] = new Date(String(value)).toISOString();
    } else if (field.type !== 'secret' || String(value).length) values[field.key] = value;
  }
  if (Object.keys(errors).length) return;
  busy.value = 'save';
  try {
    config.value = await systemConfigurationApi.save(setting.value, { expectedRevision: config.value.revision, values });
    hydrate(config.value); retainedInputs.value = false; feedbackError.value = false;
    feedback.value = '配置已保存，运行设置尚未改变。请核验当前版本后应用配置。';
  } catch (error) { handleFailure(error, '保存配置'); }
  finally { busy.value = ''; }
}
async function testConfiguration() {
  if (!config.value || disabled.value || dirty.value || conflict.value) return;
  clearErrors(); feedback.value = '';
  if (config.value.testKind === 'connection' || config.value.testKind === 'scope') {
    for (const field of config.value.fields) if (field.required && field.type !== 'boolean'
      && !String(draft[field.key] ?? '').trim() && !(field.type === 'secret' && field.configured)) errors[field.key] = `请填写${field.label}`;
  }
  if (config.value.requiresSample && !sampleInstanceId.value.trim()) { errors.sampleInstanceId = '请填写获准的样本实例 ID'; return; }
  if (Object.keys(errors).length) return;
  busy.value = 'test';
  try {
    config.value = await systemConfigurationApi.test(setting.value, { expectedRevision: config.value.revision,
      ...(config.value.requiresSample ? { sampleInstanceId: sampleInstanceId.value.trim() } : {}) });
    feedbackError.value = config.value.verification !== 'passed';
    feedback.value = config.value.verificationMessage || (feedbackError.value ? '核验未通过，请检查配置。' : '当前版本核验通过，可应用配置。');
  } catch (error) { handleFailure(error, testLabel.value); }
  finally { busy.value = ''; }
}
async function apply() {
  if (!config.value || !canApply.value) return;
  busy.value = 'apply'; feedback.value = '';
  try {
    config.value = await systemConfigurationApi.apply(setting.value, { expectedRevision: config.value.revision });
    feedbackError.value = false;
    feedback.value = '配置已应用。后续业务使用生效版本；本次没有同步、导入或发送业务数据。';
  } catch (error) { handleFailure(error, '应用配置'); }
  finally { busy.value = ''; }
}
async function allowNavigation() {
  if (busy.value) return false;
  if (!dirty.value) return true;
  try { await ElMessageBox.confirm('有未保存的配置，离开后这些输入将丢失。', '离开配置维护', { confirmButtonText: '放弃输入并离开', cancelButtonText: '继续编辑', type: 'warning' }); return true; }
  catch { return false; }
}
onBeforeRouteLeave(allowNavigation);
onBeforeRouteUpdate(allowNavigation);
watch([setting, isMailboxCollection], () => {
  if (isMailboxCollection.value) { requestVersion++; config.value = undefined; return; }
  void load();
}, { immediate: true });
onBeforeUnmount(() => { requestVersion++; });
</script>

<template>
  <RecruitmentMailboxesPanel v-if="isMailboxCollection" />
  <main v-else class="system-configuration" aria-label="配置维护" data-testid="system-configuration-editor">
    <header class="configuration-title">
      <div><h2>{{ config?.title ?? '配置维护' }}</h2><p v-if="config">{{ config.description }}</p></div>
      <RouterLink :to="isMailbox ? '/system/configurations/recruitment-mail' : '/system'">{{ isMailbox ? '返回邮箱列表' : '返回配置总览' }}</RouterLink>
    </header>
    <p v-if="loading" role="status">正在读取配置…</p>
    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" />
    <el-button v-if="loadError" class="retry" :disabled="disabled" @click="load()">重新读取配置</el-button>
    <template v-if="config">
      <dl class="configuration-metadata" aria-label="保存与生效状态">
        <div><dt>配置来源</dt><dd>{{ sourceLabels[config.source] }}</dd></div>
        <div><dt>已保存版本</dt><dd>{{ config.revision || '尚未保存' }}</dd></div>
        <div><dt>已应用版本</dt><dd>{{ config.appliedRevision || '未应用系统内配置' }}</dd></div>
        <div><dt>上次核验</dt><dd>{{ verificationLabels[config.verification] }}<time v-if="config.verifiedAt" :datetime="config.verifiedAt">{{ new Date(config.verifiedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }}</time></dd></div>
      </dl>
      <section v-if="retainedInputs" class="configuration-differences" aria-label="最新配置差异" data-testid="configuration-differences">
        <h3>核对最新配置与保留输入</h3>
        <p>系统当前保存值与下方保留输入存在差异时，请逐项核对。再次保存会按保留输入写入新版本。</p>
        <dl v-if="differences.length">
          <div v-for="field in differences" :key="field.key"><dt>{{ field.label }}</dt>
            <dd>当前保存值：{{ field.current }}</dd><dd>保留输入：{{ field.retained }}</dd>
            <dd><el-button link type="primary" :disabled="disabled" @click="useCurrentValue(field.key)">采用当前保存值</el-button></dd>
          </div>
        </dl>
        <p v-else>非凭据字段与最新保存值一致。</p>
        <p>凭据不显示；输入框留空会保留当前已保存凭据，已填写的新凭据仍按保留输入保存。</p>
      </section>
      <p v-if="config.verificationMessage" class="hint">{{ config.verificationMessage }}</p>
      <p v-if="usesDingTalkApp" class="related-link">企业应用身份统一维护：<RouterLink to="/system/configurations/dingtalk-app">维护共享钉钉应用</RouterLink>。各业务仍需分别核对权限和开关。</p>
      <p v-if="setting === 'ai-resume'" class="related-link">解析使用 DeepSeek 的已验证凭据：<RouterLink to="/system/ai-services?provider=deepseek&feature=resume">维护 DeepSeek 凭据</RouterLink>。解析开关独立于目标进展机器人。</p>
      <p v-if="setting === 'payroll-access'" class="related-link"><RouterLink to="/system/payroll-grants">维护发薪主体授权</RouterLink>。启用开关不授予工资访问或发放权限。</p>
      <p v-if="setting === 'dingtalk-notifications'" class="related-link"><RouterLink to="/cycles?configuration=dingtalk-notifications">维护绩效通知业务总开关</RouterLink>。</p>
      <el-alert v-if="secretBlocked" title="凭据加密尚未就绪，请联系部署管理员配置主密钥后再保存。" type="warning" :closable="false" />
      <el-form class="configuration-form" label-position="top" :disabled="disabled" @submit.prevent="save">
        <el-form-item v-for="field in config.fields" :key="field.key" :label="field.label" :required="field.required" :error="errors[field.key]">
          <el-select v-if="field.type === 'select'" :fit-input-width="true" :model-value="String(draft[field.key] ?? '')" :aria-label="field.label" :placeholder="'选择' + field.label" @update:model-value="value => { draft[field.key] = value; errors[field.key] = ''; }">
            <el-option v-for="option in field.options" :key="option.value" :value="option.value" :label="option.label" />
          </el-select>
          <el-switch v-else-if="field.type === 'boolean'" :model-value="draft[field.key] === true" :aria-label="field.label" @update:model-value="value => { draft[field.key] = value === true; errors[field.key] = ''; }" />
          <el-date-picker v-else-if="field.type === 'datetime'" :model-value="String(draft[field.key] ?? '')" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" format="YYYY-MM-DD HH:mm" :aria-label="field.label" placeholder="选择读取起始时间" @update:model-value="value => { draft[field.key] = typeof value === 'string' ? value : ''; errors[field.key] = ''; }" />
          <el-input v-else :model-value="String(draft[field.key] ?? '')" :type="field.type === 'secret' ? 'password' : field.type === 'textarea' ? 'textarea' : 'text'" :rows="field.type === 'textarea' ? 3 : undefined" :aria-label="field.label" :autocomplete="field.type === 'secret' ? 'new-password' : 'off'" :placeholder="field.type === 'secret' && field.configured ? '已保存，留空保留现有凭据' : ''" @update:model-value="value => { draft[field.key] = value; errors[field.key] = ''; }" />
          <p v-if="field.type === 'secret'" class="field-hint">{{ field.configured ? '凭据已保存，不回显；留空保留原值。' : '尚未保存凭据。保存后输入框清空。' }}</p>
          <p v-if="fieldHelp(field)" class="field-hint">{{ fieldHelp(field) }}</p>
          <el-button v-if="isMailbox && field.key === 'RECRUITMENT_MAIL_FOLDER'" link type="primary" :disabled="disabled" @click="useInbox">使用收件箱 INBOX</el-button>
        </el-form-item>
        <el-form-item v-if="config.requiresSample" label="获准的样本实例 ID" :error="errors.sampleInstanceId">
          <el-input v-model="sampleInstanceId" aria-label="获准的样本实例 ID" autocomplete="off" @input="errors.sampleInstanceId = ''" />
          <p class="field-hint">仅核验明确获准的已知审批样本，不导入招聘需求。</p>
        </el-form-item>
        <div class="configuration-actions">
          <el-button type="primary" native-type="submit" data-testid="configuration-save" :loading="busy === 'save'" :disabled="disabled || conflict || secretBlocked">保存配置</el-button>
          <el-button data-testid="configuration-test" :loading="busy === 'test'" :disabled="disabled || dirty || conflict" @click="testConfiguration">{{ testLabel }}</el-button>
          <el-button data-testid="configuration-apply" :loading="busy === 'apply'" :disabled="!canApply" @click="apply">应用配置</el-button>
        </div>
      </el-form>
      <p v-if="dirty" class="hint" role="status">有未保存的修改，请先保存，再核验和应用。</p>
      <p v-if="feedback" :class="['configuration-feedback', { 'is-error': feedbackError }]" :role="feedbackError ? 'alert' : 'status'">{{ feedback }}</p>
      <el-button v-if="conflict" :disabled="disabled" @click="syncRevision">读取最新版本并保留输入</el-button>
      <p class="hint">保存只保留草稿；核验只检查当前版本；应用后才供后续业务使用。应用不会自动读取邮件、同步审批、发送消息、创建日程或获取考勤。</p>
      <p v-if="config.testKind === 'configuration'" class="hint">本项仅核对配置完整性，不代表第三方连接或业务权限已验收。</p>
    </template>
  </main>
</template>

<style scoped>
.system-configuration { max-width: 920px; padding: 20px; margin: 0 auto; color: var(--el-text-color-primary); }
.configuration-title { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
.configuration-title h2 { margin: 0; font-size: 20px; }
.configuration-title p { margin: 8px 0 0; line-height: 1.6; color: var(--el-text-color-regular); }
a { color: var(--el-color-primary); text-underline-offset: 3px; overflow-wrap: anywhere; }
.configuration-title > a { flex: none; }
.configuration-metadata { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; padding: 14px; border: 1px solid var(--el-border-color-light); border-radius: 6px; }
.configuration-metadata dt { color: var(--el-text-color-secondary); font-size: 12px; }
.configuration-metadata dd { margin: 6px 0 0; font-size: 13px; overflow-wrap: anywhere; }
time { display: block; margin-top: 4px; font-size: 12px; }
.configuration-form { max-width: 680px; margin-top: 20px; }
.configuration-form :deep(.el-date-editor) { width: 100%; }
.field-hint { width: 100%; margin: 5px 0 0; font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.5; overflow-wrap: anywhere; }
.hint, .related-link, .configuration-feedback { font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.hint { color: var(--el-text-color-secondary); }
.configuration-feedback.is-error { color: var(--el-color-danger-dark-2); }
.configuration-differences { padding: 14px; border: 1px solid var(--el-color-warning-light-5); border-radius: 6px; background: var(--el-color-warning-light-9); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.configuration-differences h3 { margin: 0; font-size: 14px; }
.configuration-differences p { margin: 6px 0; }
.configuration-differences dl { margin: 10px 0; }
.configuration-differences dl > div + div { margin-top: 10px; }
.configuration-differences dt { font-weight: 600; }
.configuration-differences dd { margin-left: 0; white-space: pre-wrap; }
.configuration-actions { position: sticky; bottom: 0; display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 0; background: var(--el-bg-color); border-top: 1px solid var(--el-border-color-light); z-index: 1; }
.configuration-actions :deep(.el-button + .el-button) { margin-left: 0; }
.retry { margin-top: 12px; }
@media (max-width: 600px) {
  .system-configuration { padding: 14px; }
  .configuration-title { flex-wrap: wrap; }
  .configuration-metadata { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .configuration-actions { bottom: 0; padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
}
</style>
