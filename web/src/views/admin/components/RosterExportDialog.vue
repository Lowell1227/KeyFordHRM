<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { usersApi, type RosterExportModule } from '@/api/users.api';
import type { UserQuery } from '@/types/api.types';
import { useExport } from '@/composables/useExport';

const visible = defineModel<boolean>({ default: false });
const props = defineProps<{ query: UserQuery; total: number }>();
const modules = ref<RosterExportModule[]>([]);
const selected = ref<string[]>([]);
const initialized = ref(false);
const fieldsLoading = ref(false);
const fieldsError = ref('');
const exportError = ref('');
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
      ? selected.value.filter(key => available.some(field => field.key === key))
      : available.filter(field => field.defaultSelected).map(field => field.key);
    initialized.value = true;
  } catch {
    if (generation === loadGeneration) fieldsError.value = '导出字段加载失败，请重试。';
  } finally {
    if (generation === loadGeneration) fieldsLoading.value = false;
  }
}

watch(visible, value => {
  if (value) void loadFields();
  else ++loadGeneration;
});

async function exportRoster() {
  if (busy.value || fieldsError.value || !selected.value.length) return;
  exportError.value = '';
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()).replace(/-/g, '');
  try {
    await exporter.download(() => usersApi.exportRoster({
      ...props.query,
      columns: fields.value.filter(field => selected.value.includes(field.key)).map(field => field.key).join(','),
    }), `花名册-${date}.xlsx`);
    visible.value = false;
  } catch (error) {
    exportError.value = error instanceof Error ? error.message : '导出失败，请重试。';
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
    <div v-loading="fieldsLoading" class="roster-export-modules" aria-label="导出模块">
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
    <p v-if="exportError" class="roster-export-error" role="alert">{{ exportError }}</p>
    <template #footer>
      <el-button :disabled="exporter.loading.value" @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="exporter.loading.value" :disabled="busy || !!fieldsError || !selected.length" @click="exportRoster">导出 Excel</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
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
@media (max-width: 600px) {
  .roster-export-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 8px; padding-left: 12px; }
  .roster-export-modules { max-height: 52vh; padding-right: 4px; }
}
</style>
