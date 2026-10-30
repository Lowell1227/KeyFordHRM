<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { personnelReferenceDataApi, type PersonnelReferenceData, type PersonnelReferenceKind } from '@/api/personnel-reference-data.api';
import { useAuthStore } from '@/stores/auth.store';
import { canReadPersonnelReferenceData, canWritePersonnelReferenceData } from '@/utils/personnel-reference-permissions';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import QueryFilterPanel from '@/components/common/QueryFilterPanel.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import ListPagination from '@/components/common/ListPagination.vue';

const props = defineProps<{ kind: PersonnelReferenceKind; compact?: boolean }>();
const auth = useAuthStore();
const label = computed(() => props.kind === 'work_location' ? '工作地点' : '职系');
const canRead = computed(() => canReadPersonnelReferenceData(auth.user, props.kind));
const canWrite = computed(() => canWritePersonnelReferenceData(auth.user));
const rows = ref<PersonnelReferenceData[]>([]);
const loading = ref(false);
const saving = ref(false);
const loadError = ref('');
const keyword = ref('');
const status = ref('');
const page = ref(1);
const pageSize = ref(20);
const filtered = computed(() => rows.value.filter(row => row.name.includes(keyword.value.trim())
  && (!status.value || String(row.isActive) === status.value)));
const visibleRows = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));
const dialogOpen = ref(false);
const selected = ref<PersonnelReferenceData>();
const name = ref('');
const saveError = ref('');
const inputRef = ref<{ focus: () => void }>();
let requestVersion = 0;

async function load() {
  const version = ++requestVersion;
  if (!canRead.value) { rows.value = []; loading.value = false; return; }
  loading.value = true;
  loadError.value = '';
  try {
    const result = await personnelReferenceDataApi.findAll(props.kind, true);
    if (version !== requestVersion) return;
    rows.value = result;
    page.value = Math.min(page.value, Math.max(1, Math.ceil(filtered.value.length / pageSize.value)));
  } catch {
    if (version === requestVersion) loadError.value = `${label.value}加载失败，请重试。`;
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}

function edit(row?: PersonnelReferenceData) {
  if (!canWrite.value || saving.value) return;
  selected.value = row;
  name.value = row?.name || '';
  saveError.value = '';
  dialogOpen.value = true;
}

async function save() {
  if (!canWrite.value || saving.value) return;
  const value = name.value.trim();
  if (!value || value.length > 100) { saveError.value = `请填写 1–100 字${label.value}名称`; return; }
  if (rows.value.some(row => row.name === value && row.id !== selected.value?.id)) {
    saveError.value = `该${label.value}名称已存在，请使用其他名称。`;
    return;
  }
  saving.value = true;
  saveError.value = '';
  try {
    if (selected.value) await personnelReferenceDataApi.update(props.kind, selected.value.id, { name: value });
    else await personnelReferenceDataApi.create(props.kind, { name: value });
    dialogOpen.value = false;
    ElMessage.success(`${label.value}已保存`);
    await load();
  } catch {
    saveError.value = `${label.value}保存失败，请核对名称或稍后重试；输入已保留。`;
  } finally {
    saving.value = false;
  }
}

async function toggle(row: PersonnelReferenceData) {
  if (!canWrite.value || saving.value) return;
  saving.value = true;
  const action = row.isActive ? '停用' : '启用';
  try {
    try {
      await ElMessageBox.confirm(row.isActive
        ? `停用“${row.name}”后不能新选，已有任职和岗位的原值仍保留。`
        : `启用“${row.name}”后可在填写${label.value}时选择。`, `${action}${label.value}`, {
        confirmButtonText: `${action}${label.value}`, cancelButtonText: '取消', type: row.isActive ? 'warning' : 'info',
      });
    } catch { return; }
    await personnelReferenceDataApi.update(props.kind, row.id, { isActive: !row.isActive });
    ElMessage.success(`${label.value}已${action}`);
    await load();
  } catch {
    loadError.value = `${label.value}${action}失败，请重试。`;
  } finally {
    saving.value = false;
  }
}

function close(done: () => void) { if (!saving.value) done(); }
function resetFilters() { keyword.value = ''; status.value = ''; page.value = 1; }
function formatDate(value: string) { return value ? new Date(value).toLocaleDateString('zh-CN') : '—'; }
watch([keyword, status, pageSize], () => { page.value = 1; });
watch(() => [props.kind, canRead.value], () => { rows.value = []; void load(); }, { immediate: true });
</script>

<template>
  <BusinessListPage variant="record" :loading="loading" class="personnel-reference-panel" :class="{ 'personnel-reference-panel--compact': compact }">
    <template #primary-action>
      <el-button v-if="canWrite" type="primary" :disabled="saving" @click="edit()">新增{{ label }}</el-button>
    </template>
    <template v-if="canRead" #filters>
      <QueryFilterPanel>
        <el-form inline @submit.prevent="page = 1">
          <el-form-item :label="`${label}名称`">
            <el-input v-model="keyword" :aria-label="`搜索${label}名称`" clearable :placeholder="`搜索${label}名称`" />
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="status" aria-label="资料状态" placeholder="全部状态" class="personnel-reference-panel__status">
              <el-option label="全部状态" value="" /><el-option label="启用" value="true" /><el-option label="停用" value="false" />
            </el-select>
          </el-form-item>
          <el-form-item><el-button @click="resetFilters">重置</el-button></el-form-item>
        </el-form>
      </QueryFilterPanel>
    </template>
    <template #feedback>
      <el-alert v-if="!canRead" title="暂无查看此资料的权限" type="info" :closable="false" />
      <div v-else-if="loadError" class="personnel-reference-panel__error" role="alert">
        <span>{{ loadError }}</span><el-button link type="primary" :loading="loading" @click="load">重试</el-button>
      </div>
      <el-alert v-else-if="!canWrite" :title="`当前可查看${label}；新增、改名及启停用需具备员工档案编辑权限。`" type="info" :closable="false" />
    </template>
    <template v-if="canRead" #desktop-list>
      <el-table v-loading="loading" :data="visibleRows" height="100%" class="app-table" :empty-text="loadError ? '暂时无法读取资料' : `暂无${label}`">
        <el-table-column :label="`${label}名称`" prop="name" min-width="220" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><el-tag :type="row.isActive ? 'success' : 'info'">{{ row.isActive ? '启用' : '停用' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="更新时间" min-width="120">
          <template #default="{ row }">{{ formatDate(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column v-if="canWrite" label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="saving" @click="edit(row as PersonnelReferenceData)">修改名称</el-button>
            <el-button link :disabled="saving" @click="toggle(row as PersonnelReferenceData)">{{ row.isActive ? '停用' : '启用' }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>
    <template v-if="canRead" #mobile-list>
      <div v-loading="loading" class="personnel-reference-panel__cards">
        <el-empty v-if="!loading && !visibleRows.length" :description="loadError ? '暂时无法读取资料' : `暂无${label}`" />
        <MobileResultCard v-for="row in visibleRows" :key="row.id">
          <template #title>{{ row.name }}</template>
          <template #status><el-tag :type="row.isActive ? 'success' : 'info'">{{ row.isActive ? '启用' : '停用' }}</el-tag></template>
          <div class="mobile-result-field"><span class="mobile-result-field__label">更新时间</span><span class="mobile-result-field__value">{{ formatDate(row.updatedAt) }}</span></div>
          <template v-if="canWrite" #actions>
            <el-button link type="primary" :disabled="saving" @click="edit(row)">修改名称</el-button>
            <el-button link :disabled="saving" @click="toggle(row)">{{ row.isActive ? '停用' : '启用' }}</el-button>
          </template>
        </MobileResultCard>
      </div>
    </template>
    <template v-if="canRead" #pagination>
      <ListPagination v-model:current-page="page" v-model:page-size="pageSize" :total="filtered.length" />
    </template>
    <template #detail>
      <el-dialog v-model="dialogOpen" :title="selected ? `修改${label}名称` : `新增${label}`" width="min(440px, calc(100vw - 24px))"
        :close-on-click-modal="false" :show-close="!saving" :close-on-press-escape="!saving" :before-close="close" @opened="inputRef?.focus()">
        <el-form label-position="top" @submit.prevent="save">
          <el-form-item :label="`${label}名称`" :error="saveError">
            <el-input ref="inputRef" v-model="name" :aria-label="`${label}名称`" maxlength="100" show-word-limit :disabled="saving" @input="saveError = ''" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button :disabled="saving" @click="dialogOpen = false">取消</el-button>
          <el-button type="primary" :loading="saving" :disabled="saving" @click="save">保存{{ label }}</el-button>
        </template>
      </el-dialog>
    </template>
  </BusinessListPage>
</template>

<style scoped>
.personnel-reference-panel--compact { flex: 1; min-height: 0; }
.personnel-reference-panel__status { width: 140px; }
.personnel-reference-panel__cards { display: grid; gap: 10px; }
.personnel-reference-panel__error { display: flex; align-items: baseline; gap: 12px; padding: 12px 16px; color: var(--el-color-danger); font-size: 13px; }
:deep(.el-table .cell) { overflow-wrap: anywhere; }
</style>
