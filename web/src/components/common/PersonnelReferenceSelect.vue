<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { isAxiosError } from 'axios';
import { personnelReferenceDataApi, type PersonnelReferenceData, type PersonnelReferenceKind } from '@/api/personnel-reference-data.api';
import { useAuthStore } from '@/stores/auth.store';
import { canReadPersonnelReferenceData, canWritePersonnelReferenceData } from '@/utils/personnel-reference-permissions';
import { personnelReferenceKinds } from '@/utils/personnel-reference-kinds';

const props = defineProps<{
  modelValue?: string | null;
  referenceId?: string | null;
  kind: PersonnelReferenceKind;
  label?: string;
  disabled?: boolean;
  placeholder?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; 'update:referenceId': [value: string | null] }>();
const auth = useAuthStore();
const definition = computed(() => personnelReferenceKinds[props.kind]);
const label = computed(() => props.label || definition.value.label);
const nameLabel = computed(() => label.value.endsWith('名称') ? label.value : `${label.value}名称`);
const canRead = computed(() => canReadPersonnelReferenceData(auth.user, props.kind));
const canWrite = computed(() => !props.disabled && canWritePersonnelReferenceData(auth.user));
const manageHref = computed(() => `/basic-data?tab=${definition.value.tab}`);
const rows = ref<PersonnelReferenceData[]>([]);
const loading = ref(false);
const loadError = ref('');
const legacyValue = '__unlinked_historical_value__';
const current = computed(() => rows.value.find(row => definition.value.allowCustom ? row.name === props.modelValue : row.id === props.referenceId));
const options = computed(() => rows.value.filter(row => row.isActive || row.id === current.value?.id));
const selectedValue = computed(() => definition.value.allowCustom ? props.modelValue || undefined
  : props.referenceId || (props.modelValue ? legacyValue : undefined));
const optionLabel = (row: PersonnelReferenceData) => !definition.value.allowCustom && row.id === props.referenceId
  ? props.modelValue || row.name : row.name;
const dialogOpen = ref(false);
const name = ref('');
const saveError = ref('');
const saving = ref(false);
const selectRef = ref<{ blur: () => void }>();
const inputRef = ref<{ focus: () => void }>();
let requestVersion = 0;
let contextVersion = 0;

async function load(): Promise<PersonnelReferenceData[] | null> {
  const version = ++requestVersion;
  if (!canRead.value) { rows.value = []; loading.value = false; return null; }
  loading.value = true;
  loadError.value = '';
  try {
    const result = await personnelReferenceDataApi.findAll(props.kind, true);
    if (version === requestVersion) rows.value = result;
    return version === requestVersion ? result : null;
  } catch {
    if (version === requestVersion) loadError.value = `${label.value}加载失败，当前填写内容已保留。`;
    return null;
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}

function select(value: string | undefined | null) {
  if (props.disabled) return;
  if (!value) {
    emit('update:referenceId', null);
    emit('update:modelValue', '');
    return;
  }
  if (definition.value.allowCustom) {
    emit('update:modelValue', value);
    return;
  }
  const row = rows.value.find(item => item.isActive && item.id === value);
  if (!row) return;
  emit('update:referenceId', row.id);
  emit('update:modelValue', row.name);
}

function openCreate() {
  if (!canWrite.value || saving.value) return;
  selectRef.value?.blur();
  name.value = '';
  saveError.value = '';
  dialogOpen.value = true;
}

function useExisting(existing: PersonnelReferenceData): boolean {
  if (!existing.isActive) {
    saveError.value = `同名${label.value}已停用，请在管理页启用后再选用。`;
    return false;
  }
  if (!definition.value.allowCustom) emit('update:referenceId', existing.id);
  emit('update:modelValue', existing.name);
  dialogOpen.value = false;
  return true;
}

async function save() {
  if (saving.value || !canWrite.value) return;
  const value = name.value.trim();
  if (!value || value.length > definition.value.maxLength) { saveError.value = `请填写 1–${definition.value.maxLength} 字${label.value}名称`; return; }
  saving.value = true;
  saveError.value = '';
  const kind = props.kind;
  const context = contextVersion;
  const currentValue = props.modelValue;
  const currentId = props.referenceId;
  const isCurrent = () => context === contextVersion && kind === props.kind && currentValue === props.modelValue
    && currentId === props.referenceId && canWrite.value;
  try {
    if ((loadError.value || loading.value) && !await load()) {
      if (isCurrent()) saveError.value = '暂时无法核对已有名称，请稍后重试；输入已保留。';
      return;
    }
    if (!isCurrent()) return;
    const existing = rows.value.find(row => row.name === value);
    if (existing) { useExisting(existing); return; }
    const created = await personnelReferenceDataApi.create(kind, { name: value });
    if (!isCurrent()) return;
    rows.value = [...rows.value.filter(row => row.id !== created.id), created];
    if (!definition.value.allowCustom) emit('update:referenceId', created.id);
    emit('update:modelValue', created.name);
    dialogOpen.value = false;
  } catch (error) {
    if (!isCurrent()) return;
    const fieldError = isAxiosError(error) ? error.response?.data?.data?.fieldErrors?.name : undefined;
    if (typeof fieldError === 'string') { saveError.value = fieldError; return; }
    // A concurrent create may have won the unique-name race; reuse its active option.
    const freshRows = await load();
    if (!isCurrent()) return;
    const existing = freshRows?.find(row => row.name === value);
    if (existing) useExisting(existing);
    else saveError.value = `${label.value}保存失败，请稍后重试；输入已保留。`;
  } finally {
    if (context === contextVersion) saving.value = false;
  }
}

function close(done: () => void) { if (!saving.value) done(); }
function refreshOnReturn() { if (document.visibilityState === 'visible') void load(); }
watch(() => [props.kind, canRead.value], () => {
  contextVersion++;
  rows.value = []; dialogOpen.value = false; saving.value = false; name.value = ''; saveError.value = '';
  void load();
}, { immediate: true });
onMounted(() => {
  window.addEventListener('focus', refreshOnReturn);
  document.addEventListener('visibilitychange', refreshOnReturn);
});
onBeforeUnmount(() => {
  requestVersion++;
  contextVersion++;
  window.removeEventListener('focus', refreshOnReturn);
  document.removeEventListener('visibilitychange', refreshOnReturn);
});
</script>

<template>
  <div class="personnel-reference-select">
    <el-select
      ref="selectRef" :model-value="selectedValue" :disabled="disabled" :loading="loading"
      :placeholder="placeholder || (definition.allowCustom ? `选择或填写${label}` : `选择${label}`)" :aria-label="label" filterable clearable :allow-create="definition.allowCustom" :default-first-option="definition.allowCustom" popper-class="personnel-reference-options"
      :no-data-text="`暂无启用${label}`" @update:model-value="select" @visible-change="visible => visible && load()"
    >
      <el-option v-if="(modelValue || referenceId) && !current" :value="definition.allowCustom ? modelValue || '' : referenceId || legacyValue" :label="modelValue || '原选项已不可用'" :title="modelValue || ''" :disabled="!definition.allowCustom">
        <span>{{ modelValue || '原选项已不可用' }}{{ definition.allowCustom ? '' : '（原值，未维护）' }}</span>
      </el-option>
      <el-option v-for="row in options" :key="row.id" :value="definition.allowCustom ? row.name : row.id" :label="optionLabel(row)" :title="row.name" :disabled="!row.isActive">
        <span>{{ optionLabel(row) }}{{ row.isActive ? '' : '（已停用）' }}</span>
      </el-option>
      <template v-if="canWrite" #footer>
        <div class="personnel-reference-select__footer">
          <el-button link type="primary" @click="openCreate">新增{{ label }}</el-button>
          <a :href="manageHref" target="_blank" rel="noopener noreferrer">管理{{ label }}</a>
        </div>
      </template>
    </el-select>
    <div v-if="loadError" class="personnel-reference-select__error" role="alert">
      <span>{{ loadError }}</span><el-button link type="primary" :loading="loading" @click="load">重试</el-button>
    </div>
    <span v-else-if="!definition.allowCustom && modelValue && !loading && (!current || !current.isActive)" class="personnel-reference-select__note">
      {{ current ? '原值已停用' : '原值尚未维护' }}，保留当前填写内容。
    </span>
    <el-dialog
      v-model="dialogOpen" :title="`新增${label}`" width="min(440px, calc(100vw - 24px))" append-to-body
      :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving" :before-close="close"
      @opened="inputRef?.focus()"
    >
      <el-form label-position="top" @submit.prevent="save">
        <el-form-item :label="nameLabel" :error="saveError">
          <el-input ref="inputRef" v-model="name" :aria-label="nameLabel" :maxlength="definition.maxLength" show-word-limit :disabled="saving" @input="saveError = ''" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="saving" @click="save">保存并选用</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.personnel-reference-select { display: grid; gap: 4px; width: 100%; min-width: 0; }
.personnel-reference-select__footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.personnel-reference-select__footer a { color: var(--el-color-primary); text-decoration: none; font-size: 12px; }
.personnel-reference-select__note { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.personnel-reference-select__error { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; color: var(--el-color-danger); font-size: 12px; line-height: 1.5; }
:global(.personnel-reference-options .el-select-dropdown__item) { height: auto; min-height: 34px; white-space: normal; line-height: 20px; padding-top: 7px; padding-bottom: 7px; overflow-wrap: anywhere; }
</style>
