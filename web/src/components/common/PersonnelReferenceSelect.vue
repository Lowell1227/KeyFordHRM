<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { personnelReferenceDataApi, type PersonnelReferenceData, type PersonnelReferenceKind } from '@/api/personnel-reference-data.api';
import { useAuthStore } from '@/stores/auth.store';
import { canReadPersonnelReferenceData, canWritePersonnelReferenceData } from '@/utils/personnel-reference-permissions';

const props = defineProps<{
  modelValue?: string | null;
  kind: PersonnelReferenceKind;
  label?: string;
  disabled?: boolean;
  placeholder?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const auth = useAuthStore();
const label = computed(() => props.label || (props.kind === 'work_location' ? '工作地点' : '职系'));
const canRead = computed(() => canReadPersonnelReferenceData(auth.user, props.kind));
const canWrite = computed(() => !props.disabled && canWritePersonnelReferenceData(auth.user));
const manageHref = computed(() => `/basic-data?tab=${props.kind === 'work_location' ? 'work-locations' : 'job-families'}`);
const rows = ref<PersonnelReferenceData[]>([]);
const loading = ref(false);
const loadError = ref('');
const options = computed(() => rows.value.filter(row => row.isActive || row.name === props.modelValue));
const current = computed(() => rows.value.find(row => row.name === props.modelValue));
const dialogOpen = ref(false);
const name = ref('');
const saveError = ref('');
const saving = ref(false);
const selectRef = ref<{ blur: () => void }>();
const inputRef = ref<{ focus: () => void }>();
let requestVersion = 0;

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
  if (value && !rows.value.some(row => row.isActive && row.name === value)) return;
  emit('update:modelValue', value || '');
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
  emit('update:modelValue', existing.name);
  dialogOpen.value = false;
  return true;
}

async function save() {
  if (saving.value || !canWrite.value) return;
  const value = name.value.trim();
  if (!value || value.length > 100) { saveError.value = `请填写 1–100 字${label.value}名称`; return; }
  saving.value = true;
  saveError.value = '';
  try {
    if ((loadError.value || loading.value) && !await load()) {
      saveError.value = '暂时无法核对已有名称，请稍后重试；输入已保留。';
      return;
    }
    const existing = rows.value.find(row => row.name === value);
    if (existing) { useExisting(existing); return; }
    const created = await personnelReferenceDataApi.create(props.kind, { name: value });
    rows.value = [...rows.value.filter(row => row.id !== created.id), created];
    emit('update:modelValue', created.name);
    dialogOpen.value = false;
  } catch {
    // A concurrent create may have won the unique-name race; reuse its active option.
    const freshRows = await load();
    const existing = freshRows?.find(row => row.name === value);
    if (existing) useExisting(existing);
    else saveError.value = `${label.value}保存失败，请稍后重试；输入已保留。`;
  } finally {
    saving.value = false;
  }
}

function close(done: () => void) { if (!saving.value) done(); }
function refreshOnReturn() { if (document.visibilityState === 'visible') void load(); }
watch(() => [props.kind, canRead.value], () => { rows.value = []; void load(); }, { immediate: true });
onMounted(() => {
  window.addEventListener('focus', refreshOnReturn);
  document.addEventListener('visibilitychange', refreshOnReturn);
});
onBeforeUnmount(() => {
  requestVersion++;
  window.removeEventListener('focus', refreshOnReturn);
  document.removeEventListener('visibilitychange', refreshOnReturn);
});
</script>

<template>
  <div class="personnel-reference-select">
    <el-select
      ref="selectRef" :model-value="modelValue || undefined" :disabled="disabled" :loading="loading"
      :placeholder="placeholder || `选择${label}`" :aria-label="label" filterable clearable popper-class="personnel-reference-options"
      :no-data-text="`暂无启用${label}`" @update:model-value="select" @visible-change="visible => visible && load()"
    >
      <el-option v-if="modelValue && !current" :value="modelValue" :label="modelValue" :title="modelValue" disabled>
        <span>{{ modelValue }}（原值，未维护）</span>
      </el-option>
      <el-option v-for="row in options" :key="row.id" :value="row.name" :label="row.name" :title="row.name" :disabled="!row.isActive">
        <span>{{ row.name }}{{ row.isActive ? '' : '（已停用）' }}</span>
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
    <span v-else-if="modelValue && !loading && (!current || !current.isActive)" class="personnel-reference-select__note">
      {{ current ? '原值已停用' : '原值尚未维护' }}，保留当前填写内容。
    </span>
    <el-dialog
      v-model="dialogOpen" :title="`新增${label}`" width="min(440px, calc(100vw - 24px))" append-to-body
      :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving" :before-close="close"
      @opened="inputRef?.focus()"
    >
      <el-form label-position="top" @submit.prevent="save">
        <el-form-item :label="`${label}名称`" :error="saveError">
          <el-input ref="inputRef" v-model="name" :aria-label="`${label}名称`" maxlength="100" show-word-limit :disabled="saving" @input="saveError = ''" />
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
