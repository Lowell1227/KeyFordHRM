<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Lock } from '@element-plus/icons-vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth.store';
import { isLocalPreview } from '@/utils/preview-mode';
import { usersApi, type RosterExportModule } from '@/api/users.api';
import type { UserQuery } from '@/types/api.types';
import { useExport } from '@/composables/useExport';

const visible = defineModel<boolean>({ default: false });
const props = defineProps<{ query: UserQuery; total: number }>();
const auth = useAuthStore();
const router = useRouter();
function openAccountPasswordSettings() {
  if (!isLocalPreview) return;
  clearPasswords(); visible.value = false;
  void router.push({ path: '/change-password', query: { purpose: 'export' } });
}
const modules = ref<RosterExportModule[]>([]);
const selected = ref<string[]>([]);
const initialized = ref(false);
const fieldsLoading = ref(false);
const fieldsError = ref('');
const exportError = ref('');
const accountPassword = ref('');
const filePassword = ref('');
const confirmFilePassword = ref('');
const passwordErrors = ref<Record<string, string>>({});
const sensitiveLabels = computed(() => modules.value.flatMap(module => module.fields).filter(field => ['idNumber', 'bankAccount'].includes(field.key) && selected.value.includes(field.key)).map(field => field.label));
const sensitive = computed(() => sensitiveLabels.value.length > 0);
function clearPasswords(clearErrors = true) {
  accountPassword.value = ''; filePassword.value = ''; confirmFilePassword.value = ''; if (clearErrors) passwordErrors.value = {};
}
watch(sensitive, () => { clearPasswords(); exportError.value = ''; });
const exporter = useExport();
let loadGeneration = 0;

const fields = computed(() => modules.value.flatMap(module => module.fields));
const busy = computed(() => fieldsLoading.value || exporter.loading.value);
const selectedCount = (module: RosterExportModule) => module.fields.filter(field => selected.value.includes(field.key)).length;

function selectModule(module: RosterExportModule, checked: unknown) {
  const keys = new Set(module.fields.map(field => field.key));
  selected.value = checked
    ? [...new Set([...selected.value, ...keys])]
    : selected.value.filter(key => !keys.has(key));
}

async function loadFields() {
  const generation = ++loadGeneration;
  fieldsLoading.value = true;
  fieldsError.value = '';
  exportError.value = '';
  modules.value = [];
  try {
    const result = await usersApi.rosterExportFields();
    if (generation !== loadGeneration) return;
    modules.value = result;
    const available = result.flatMap(module => module.fields);
    selected.value = initialized.value
      ? [...new Set(selected.value.map(key => key === 'organization' ? 'companyText' : key))]
        .filter(key => available.some(field => field.key === key))
      : available.filter(field => field.defaultSelected).map(field => field.key);
    initialized.value = true;
  } catch {
    if (generation === loadGeneration) fieldsError.value = '导出字段加载失败，请重试。';
  } finally {
    if (generation === loadGeneration) fieldsLoading.value = false;
  }
}

watch(visible, value => {
  clearPasswords();
  if (value) void loadFields();
  else ++loadGeneration;
});

async function exportRoster() {
  if (busy.value || fieldsError.value || !selected.value.length) return;
  exportError.value = '';
  passwordErrors.value = {};
  if (sensitive.value) {
    if (!accountPassword.value) passwordErrors.value.account = '请输入当前账号密码';
    if (filePassword.value.length < 4 || filePassword.value.length > 64 || !filePassword.value.trim()) passwordErrors.value.file = '请输入4至64位Excel打开密码';
    else if (filePassword.value === accountPassword.value) passwordErrors.value.file = '不能与账号密码相同';
    if (filePassword.value !== confirmFilePassword.value) passwordErrors.value.confirm = '两次打开密码不一致';
    if (Object.keys(passwordErrors.value).length) return;
  }
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()).replace(/-/g, '');
  try {
    await exporter.download(() => usersApi.exportRoster({
      ...props.query,
      columns: fields.value.filter(field => selected.value.includes(field.key)).map(field => field.key).join(','),
    }, sensitive.value ? { accountPassword: accountPassword.value, filePassword: filePassword.value } : undefined), `花名册-${date}.xlsx`);
    visible.value = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : '导出失败，请重试。';
    if (sensitive.value && /账号密码|个人中心|15分钟/.test(message)) passwordErrors.value.account = message;
    else exportError.value = message;
  } finally {
    clearPasswords(false);
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="导出花名册" width="min(760px, 94vw)" class="roster-export-dialog"
    :close-on-click-modal="!exporter.loading.value" :close-on-press-escape="!exporter.loading.value"
    :show-close="!exporter.loading.value" align-center>
    <p class="roster-export-count">预计导出 {{ total }} 条记录</p>
    <div class="roster-export-tools">
      <strong>选择字段（{{ selected.length }}）</strong>
      <el-button link type="primary" :disabled="busy || !!fieldsError" @click="selected = fields.map(field => field.key)">全选</el-button>
      <el-button link :disabled="busy || !!fieldsError" @click="selected = []">清空</el-button>
    </div>
    <div v-loading="fieldsLoading" class="roster-export-modules" :style="sensitive ? { maxHeight: '20vh' } : undefined" aria-label="导出模块">
      <div v-if="fieldsError" class="roster-export-error" role="alert">
        <span>{{ fieldsError }}</span><el-button link type="primary" @click="loadFields">重试</el-button>
      </div>
      <section v-for="module in modules" :key="module.key" class="roster-export-module" :aria-label="module.label">
        <div class="roster-export-module-title">
          <el-checkbox :model-value="selectedCount(module) === module.fields.length"
            :indeterminate="selectedCount(module) > 0 && selectedCount(module) < module.fields.length"
            :disabled="busy" :aria-label="`选择${module.label}模块`" @change="value => selectModule(module, value)">
            {{ module.label }}
          </el-checkbox>
          <small>{{ selectedCount(module) }}/{{ module.fields.length }}</small>
        </div>
        <el-checkbox-group v-model="selected" class="roster-export-fields" :disabled="busy" :aria-label="`${module.label}字段`">
          <el-checkbox v-for="field in module.fields" :key="field.key" :value="field.key">{{ field.label }}</el-checkbox>
        </el-checkbox-group>
        <small v-if="module.fields.some(field => field.key === 'contractHistory')" class="roster-export-note">单独工作表，每份合同一行</small>
      </section>
    </div>
    <section v-if="sensitive" class="roster-export-passwords" aria-label="安全验证">
      <div class="roster-export-security-heading">
        <el-icon><Lock /></el-icon><h3>安全验证</h3><span>含{{ sensitiveLabels.join('、') }}</span>
      </div>
      <p class="roster-export-note">验证本人账号，为Excel设置独立的打开密码。</p>
      <p class="roster-export-account">当前账号：{{ auth.user?.name }}<span v-if="auth.user?.employeeNo">（{{ auth.user.employeeNo }}）</span></p>
      <p v-if="isLocalPreview" class="roster-export-note">预览账号与正式账号独立。快捷进入预览后，请先设置当前预览账号密码。</p>
      <el-button v-if="isLocalPreview" link type="primary" :disabled="busy" class="roster-export-settings" @click="openAccountPasswordSettings">设置当前账号密码</el-button>
      <div class="roster-export-password-grid">
        <div class="roster-export-account-password roster-export-password-field">
          <label for="roster-account-verification">当前账号密码</label>
          <el-input id="roster-account-verification" v-model="accountPassword" type="password" show-password autocomplete="current-password" form="roster-export-verification-only" name="roster-account-verification" :disabled="busy" :maxlength="128" aria-label="当前账号密码" :aria-invalid="!!passwordErrors.account" />
          <p v-if="passwordErrors.account" class="roster-export-field-error" role="alert">{{ passwordErrors.account }}</p>
        </div>
        <div class="roster-export-password-field">
          <label for="roster-file-open-password">Excel打开密码</label>
          <el-input id="roster-file-open-password" v-model="filePassword" type="password" show-password autocomplete="one-time-code" form="roster-export-file-only" name="roster-file-open-password" data-lpignore="true" data-1p-ignore :disabled="busy" :maxlength="64" placeholder="至少4位，可用纯数字" aria-label="Excel打开密码" :aria-invalid="!!passwordErrors.file" />
          <p v-if="passwordErrors.file" class="roster-export-field-error" role="alert">{{ passwordErrors.file }}</p>
        </div>
        <div class="roster-export-password-field">
          <label for="roster-file-confirm-password">再次输入打开密码</label>
          <el-input id="roster-file-confirm-password" v-model="confirmFilePassword" type="password" show-password autocomplete="one-time-code" form="roster-export-file-only" name="roster-file-confirm-password" data-lpignore="true" data-1p-ignore :disabled="busy" :maxlength="64" aria-label="再次输入打开密码" :aria-invalid="!!passwordErrors.confirm" />
          <p v-if="passwordErrors.confirm" class="roster-export-field-error" role="alert">{{ passwordErrors.confirm }}</p>
        </div>
      </div>
      <small>本操作不会修改账号密码。文件打开密码仅用于本次导出，系统不保存。</small>
    </section>
    <p v-if="exportError" class="roster-export-error" role="alert">{{ exportError }}</p>
    <template #footer>
      <el-button :disabled="exporter.loading.value" @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="exporter.loading.value" :disabled="busy || !!fieldsError || !selected.length" @click="exportRoster">导出 Excel</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
:global(.roster-export-dialog) { max-height: 92vh; display: flex; flex-direction: column; }
:global(.roster-export-dialog .el-dialog__body) { overflow-y: auto; min-height: 0; }
.roster-export-count { margin: 0 0 12px; color: var(--el-text-color-secondary); }
.roster-export-tools { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.roster-export-tools strong { margin-right: auto; }
.roster-export-modules { max-height: min(56vh, 510px); min-height: 100px; overflow-y: auto; overscroll-behavior: contain; padding-right: 8px; }
.roster-export-module { padding: 12px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.roster-export-module:first-child { padding-top: 0; }
.roster-export-module:last-child { border-bottom: 0; }
.roster-export-module-title { display: flex; align-items: center; gap: 10px; }
.roster-export-module-title :deep(.el-checkbox__label) { font-weight: 600; }
.roster-export-module-title small, .roster-export-note { color: var(--el-text-color-secondary); }
.roster-export-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px 12px; padding-left: 24px; }
.roster-export-fields :deep(.el-checkbox) { margin-right: 0; height: auto; min-height: 32px; white-space: normal; }
.roster-export-fields :deep(.el-checkbox__label) { line-height: 1.5; overflow-wrap: anywhere; }
.roster-export-note { display: block; padding-left: 24px; }
.roster-export-error { color: var(--el-color-danger); display: flex; align-items: center; gap: 12px; overflow-wrap: anywhere; }
.roster-export-passwords { margin-top: 16px; padding: 16px; border: 1px solid var(--el-color-primary-light-7); border-radius: 8px; background: var(--el-color-primary-light-9); }
.roster-export-security-heading { display: flex; align-items: center; gap: 8px; color: var(--el-color-primary); margin-bottom: 8px; }
.roster-export-security-heading h3 { margin: 0; font-size: 14px; font-weight: 600; }
.roster-export-security-heading > span { margin-left: auto; font-size: 12px; color: var(--el-text-color-secondary); }
.roster-export-password-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; }
.roster-export-account-password { grid-column: 1 / -1; }
.roster-export-account { margin: 0 0 8px; font-size: 13px; color: var(--el-text-color-regular); }
.roster-export-settings { margin-bottom: 12px; }
.roster-export-password-field { margin-bottom: 16px; }
.roster-export-password-field label { display: block; margin-bottom: 8px; font-size: 14px; color: var(--el-text-color-regular); }
.roster-export-field-error { color: var(--el-color-danger); font-size: 12px; line-height: 1.5; margin: 4px 0 0; }
.roster-export-passwords > small { display: block; color: var(--el-text-color-secondary); line-height: 1.5; }
.roster-export-passwords :deep(.el-form-item) { margin-bottom: 16px; }
.roster-export-passwords .roster-export-note { padding-left: 0; margin: 0 0 12px; }
@media (max-width: 600px) {
  .roster-export-passwords { padding: 12px; }
  .roster-export-password-grid { grid-template-columns: minmax(0, 1fr); }
  .roster-export-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 8px; padding-left: 12px; }
  .roster-export-modules { max-height: 52vh; padding-right: 4px; }
}
</style>
