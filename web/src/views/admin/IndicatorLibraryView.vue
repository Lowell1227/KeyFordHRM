<script setup lang="ts">
import { ref, reactive, computed, onMounted, nextTick } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Download, Upload, Document } from '@element-plus/icons-vue';
import type { UploadFile } from 'element-plus';
import { indicatorsApi } from '@/api/indicators.api';
import ChartCard from '@/components/common/ChartCard.vue';
import { useExport } from '@/composables/useExport';
import { usePagination } from '@/composables/usePagination';
import type { Indicator, IndicatorQuery, CreateIndicatorBody } from '@/types/api.types';
import type { IndicatorType } from '@/types/enums';

const TYPE_OPTIONS: { label: string; value: IndicatorType }[] = [
  { label: '量化KPI', value: 'kpi' },
  { label: '态度行为', value: 'attitude' },
  { label: '加分项', value: 'bonus' },
  { label: '扣分项', value: 'penalty' },
  { label: '一票否决', value: 'veto' },
];

const ACTIVE_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '启用', value: 'true' },
  { label: '停用', value: 'false' },
];

const TYPE_LABEL_MAP: Record<IndicatorType, string> = {
  kpi: '量化KPI',
  attitude: '态度行为',
  bonus: '加分项',
  penalty: '扣分项',
  veto: '一票否决',
};

const queryForm = reactive<IndicatorQuery>({
  type: undefined,
  category: '',
  groupName: '',
  keyword: '',
});

const activeFilter = ref<'all' | 'true' | 'false'>('all');

const list = ref<Indicator[]>([]);
const filterOptionsSource = ref<Indicator[]>([]);
const loading = ref(false);

const dialogVisible = ref(false);
const dialogTitle = ref('新建指标');
const editingId = ref<string | null>(null);
const saving = ref(false);
const formRef = ref<InstanceType<typeof import('element-plus')['ElForm']> | null>(null);

const emptyForm = (): CreateIndicatorBody => ({
  name: '',
  code: '',
  category: '',
  type: 'kpi',
  description: '',
  scoringStandard: '',
  dataSource: '',
  dataCaliber: '',
  targetValue: undefined,
  unit: '',
  groupName: '',
  isActive: true,
});

const form = reactive<CreateIndicatorBody>(emptyForm());

const rules = {
  name: [{ required: true, message: '请输入指标名称', trigger: 'blur' }],
  type: [{ required: true, message: '请选择指标类型', trigger: 'change' }],
};

const importDialogVisible = ref(false);
const importFile = ref<File | null>(null);
const importLoading = ref(false);
const importResult = ref<{ imported: number; failed: Array<{ row: number; reason: string }> } | null>(null);

const exportTool = useExport({ filename: 'indicators-export.xlsx' });
const templateTool = useExport({ filename: 'indicators-template.xlsx' });

const {
  page,
  pageSize,
  total,
  pageSizeOptions,
  setPage,
  setPageSize,
  setTotal,
  withParams,
} = usePagination({ defaultPageSize: 20 });

const activeLabel = computed(() => (isActive?: boolean) => {
  if (isActive === true) return '启用';
  if (isActive === false) return '停用';
  return '-';
});

const categoryOptions = computed(() => buildUniqueOptions('category'));
const groupOptions = computed(() => buildUniqueOptions('groupName'));

function buildUniqueOptions(field: 'category' | 'groupName') {
  const map = new Map<string, string>();
  [...filterOptionsSource.value, ...list.value].forEach((item) => {
    const value = item[field]?.trim();
    if (value) map.set(value, value);
  });
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

function buildQuery(): IndicatorQuery {
  const q: IndicatorQuery = {};
  if (queryForm.type) q.type = queryForm.type;
  if (queryForm.category?.trim()) q.category = queryForm.category.trim();
  if (queryForm.groupName?.trim()) q.groupName = queryForm.groupName.trim();
  if (queryForm.keyword?.trim()) q.keyword = queryForm.keyword.trim();
  if (activeFilter.value !== 'all') {
    q.isActive = activeFilter.value === 'true';
  }
  return q;
}

async function loadFilterOptions() {
  try {
    const res = await indicatorsApi.findAll({ page: 1, pageSize: 100, isActive: true });
    filterOptionsSource.value = res.items;
  } catch {
    filterOptionsSource.value = [];
  }
}

async function loadList() {
  loading.value = true;
  try {
    const res = await indicatorsApi.findAll(withParams(buildQuery() as Record<string, unknown>));
    list.value = res.items;
    setTotal(res.total);
    if (page.value > 1 && res.items.length === 0) {
      setPage(Math.max(1, Math.ceil(res.total / pageSize.value)) || 1);
      await loadList();
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '获取指标列表失败');
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  setPage(1);
  loadList();
}

function resetQuery() {
  queryForm.type = undefined;
  queryForm.category = '';
  queryForm.groupName = '';
  queryForm.keyword = '';
  activeFilter.value = 'all';
  setPage(1);
  loadList();
}

function openCreate() {
  dialogTitle.value = '新建指标';
  editingId.value = null;
  Object.assign(form, emptyForm());
  importResult.value = null;
  dialogVisible.value = true;
  nextTick(() => formRef.value?.clearValidate());
}

function openEdit(row: Indicator) {
  dialogTitle.value = '编辑指标';
  editingId.value = row.id;
  Object.assign(form, {
    name: row.name,
    code: row.code ?? '',
    category: row.category ?? '',
    type: row.type,
    description: row.description ?? '',
    scoringStandard: row.scoringStandard ?? '',
    dataSource: row.dataSource ?? '',
    dataCaliber: row.dataCaliber ?? '',
    targetValue: row.targetValue,
    unit: row.unit ?? '',
    groupName: row.groupName ?? '',
    isActive: row.isActive,
  });
  importResult.value = null;
  dialogVisible.value = true;
  nextTick(() => formRef.value?.clearValidate());
}

function closeDialog() {
  dialogVisible.value = false;
  Object.assign(form, emptyForm());
  editingId.value = null;
}

async function saveIndicator() {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
  } catch {
    return;
  }

  const payload: CreateIndicatorBody = {
    name: form.name.trim(),
    code: form.code?.trim() || undefined,
    category: form.category?.trim() || undefined,
    type: form.type,
    description: form.description?.trim() || undefined,
    scoringStandard: form.scoringStandard?.trim() || undefined,
    dataSource: form.dataSource?.trim() || undefined,
    dataCaliber: form.dataCaliber?.trim() || undefined,
    targetValue: form.targetValue,
    unit: form.unit?.trim() || undefined,
    groupName: form.groupName?.trim() || undefined,
    isActive: form.isActive,
  };

  saving.value = true;
  try {
    if (editingId.value) {
      await indicatorsApi.update(editingId.value, payload);
      ElMessage.success('更新成功');
    } else {
      await indicatorsApi.create(payload);
      ElMessage.success('创建成功');
    }
    closeDialog();
    await loadList();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function toggleActive(row: Indicator) {
  try {
    await ElMessageBox.confirm(
      `确定要${row.isActive ? '停用' : '启用'}指标「${row.name}」吗？`,
      '确认',
      { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    await indicatorsApi.update(row.id, { isActive: !row.isActive });
    ElMessage.success('操作成功');
    await loadList();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
  }
}

function openImport() {
  importFile.value = null;
  importResult.value = null;
  importDialogVisible.value = true;
}

function closeImport() {
  importDialogVisible.value = false;
  importFile.value = null;
  importResult.value = null;
}

function handleImportChange(uploadFile: UploadFile) {
  const raw = uploadFile.raw;
  if (!raw) return;
  if (!raw.name.toLowerCase().endsWith('.xlsx')) {
    ElMessage.warning('仅支持 .xlsx 文件');
    importFile.value = null;
    return;
  }
  importFile.value = raw;
}

async function submitImport() {
  if (!importFile.value) {
    ElMessage.warning('请选择要导入的 Excel 文件');
    return;
  }
  importLoading.value = true;
  try {
    const res = await indicatorsApi.import(importFile.value);
    importResult.value = res;
    if (res.imported > 0) {
      ElMessage.success(`成功导入 ${res.imported} 条指标`);
    }
    if (res.failed.length > 0) {
      ElMessage.warning(`导入失败 ${res.failed.length} 条`);
    }
    if (res.imported > 0) {
      await loadList();
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '导入失败');
  } finally {
    importLoading.value = false;
  }
}

function downloadTemplate() {
  templateTool.download(() => indicatorsApi.getImportTemplate(), 'indicators-template.xlsx');
}

function handleExport() {
  exportTool.download(() => indicatorsApi.export(buildQuery()), 'indicators-export.xlsx');
}

onMounted(() => {
  loadFilterOptions();
  loadList();
});
</script>

<template>
  <div class="indicator-library-view page-stack">
    <ChartCard class="filter-card">
      <el-form :model="queryForm" class="query-form">
        <div class="filter-panel">
          <el-form-item label="关键词" class="query-item query-item--keyword">
            <el-input
              v-model="queryForm.keyword"
              placeholder="搜索指标名称或编码"
              clearable
              class="query-control query-control--keyword"
              @keyup.enter="handleSearch"
            />
          </el-form-item>

          <div class="filter-panel__actions">
            <el-button type="primary" @click="handleSearch">查询</el-button>
            <el-button @click="resetQuery">重置</el-button>
          </div>

          <div class="filter-panel__filters">
            <el-form-item label="指标类型" class="query-item">
              <el-select v-model="queryForm.type" placeholder="全部类型" clearable class="query-control">
                <el-option
                  v-for="opt in TYPE_OPTIONS"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="考核维度" class="query-item">
              <el-select
                v-model="queryForm.category"
                placeholder="全部维度"
                clearable
                filterable
                allow-create
                class="query-control"
              >
                <el-option
                  v-for="opt in categoryOptions"
                  :key="opt"
                  :label="opt"
                  :value="opt"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="分组" class="query-item">
              <el-select
                v-model="queryForm.groupName"
                placeholder="全部分组"
                clearable
                filterable
                allow-create
                class="query-control"
              >
                <el-option
                  v-for="opt in groupOptions"
                  :key="opt"
                  :label="opt"
                  :value="opt"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="状态" class="query-item query-item--status">
              <el-select v-model="activeFilter" placeholder="全部状态" class="query-control">
                <el-option
                  v-for="opt in ACTIVE_OPTIONS"
                  :key="String(opt.value)"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </el-form-item>
          </div>
        </div>
      </el-form>
    </ChartCard>

    <ChartCard :padded="false">
      <template #title>指标库</template>
      <template #extra>
        <div class="table-actions">
          <el-button data-testid="indicator-create" type="primary" :icon="Plus" @click="openCreate">新建指标</el-button>
          <el-button data-testid="indicator-import" :icon="Upload" @click="openImport">导入</el-button>
          <el-button :icon="Download" @click="downloadTemplate">下载导入模板</el-button>
          <el-button :icon="Document" :loading="exportTool.loading.value" @click="handleExport">导出</el-button>
        </div>
      </template>

      <el-table v-loading="loading" class="app-table" :data="list" row-key="id">
        <el-table-column prop="name" label="指标名称" min-width="180" show-overflow-tooltip />
        <el-table-column prop="code" label="编码" min-width="140" show-overflow-tooltip />
        <el-table-column prop="type" label="类型" width="110">
          <template #default="{ row }">
            {{ TYPE_LABEL_MAP[(row as Indicator).type] }}
          </template>
        </el-table-column>
        <el-table-column prop="category" label="考核维度" min-width="120" show-overflow-tooltip />
        <el-table-column prop="groupName" label="分组" min-width="120" show-overflow-tooltip />
        <el-table-column prop="dataSource" label="数据来源" min-width="140" show-overflow-tooltip />
        <el-table-column prop="dataCaliber" label="数据口径" min-width="140" show-overflow-tooltip />
        <el-table-column prop="targetValue" label="目标值" width="110">
          <template #default="{ row }">
            {{ (row as Indicator).targetValue != null ? `${(row as Indicator).targetValue}${(row as Indicator).unit ? (row as Indicator).unit : ''}` : '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="isActive" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="(row as Indicator).isActive ? 'success' : 'info'" size="small">
              {{ activeLabel((row as Indicator).isActive) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row as Indicator)">编辑</el-button>
            <el-button
              link
              :type="(row as Indicator).isActive ? 'danger' : 'success'"
              size="small"
              @click="toggleActive(row as Indicator)"
            >
              {{ (row as Indicator).isActive ? '停用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="app-pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="pageSizeOptions"
          :total="total"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="loadList"
          @size-change="(size: number) => { setPageSize(size); loadList(); }"
        />
      </div>
    </ChartCard>

    <!-- 新建/编辑弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      data-testid="indicator-dialog"
      :title="dialogTitle"
      width="640px"
      destroy-on-close
      :close-on-click-modal="false"
      @close="closeDialog"
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="100px"
        class="indicator-form"
      >
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="指标名称" prop="name">
              <el-input v-model="form.name" data-testid="indicator-name" placeholder="请输入指标名称" maxlength="100" show-word-limit />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="编码">
              <el-input v-model="form.code" placeholder="唯一编码，选填" maxlength="50" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="指标类型" prop="type">
              <el-select v-model="form.type" placeholder="请选择类型" style="width: 100%">
                <el-option
                  v-for="opt in TYPE_OPTIONS"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="考核维度">
              <el-input v-model="form.category" placeholder="如：财务、运营、创新业务" maxlength="50" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="分组">
              <el-input v-model="form.groupName" placeholder="分组名称" maxlength="50" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="单位">
              <el-input v-model="form.unit" placeholder="如：%、万元" maxlength="20" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="参考目标值">
              <el-input-number v-model="form.targetValue" :precision="2" :step="1" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="启用状态">
              <el-switch v-model="form.isActive" active-text="启用" inactive-text="停用" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="评分标准">
          <el-input
            v-model="form.scoringStandard"
            type="textarea"
            :rows="3"
            placeholder="请输入评分标准"
            maxlength="500"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="指标描述">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            placeholder="请输入指标描述"
            maxlength="500"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="数据来源">
          <el-input
            v-model="form.dataSource"
            type="textarea"
            :rows="2"
            placeholder="如：ERP 销售报表、财务系统"
            maxlength="500"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="数据口径">
          <el-input
            v-model="form.dataCaliber"
            type="textarea"
            :rows="2"
            placeholder="如：以财务确认收入为准，剔除退货"
            maxlength="500"
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeDialog">取消</el-button>
        <el-button data-testid="indicator-save" type="primary" :loading="saving" @click="saveIndicator">保存</el-button>
      </template>
    </el-dialog>

    <!-- 导入弹窗 -->
    <el-dialog
      v-model="importDialogVisible"
      data-testid="indicator-import-dialog"
      title="批量导入指标"
      width="560px"
      destroy-on-close
      :close-on-click-modal="false"
      @close="closeImport"
    >
      <div class="import-body">
        <el-alert
          title="请下载导入模板，按模板格式填写后上传 .xlsx 文件"
          type="info"
          :closable="false"
          show-icon
          class="import-tip"
        />
        <el-upload
          drag
          action="#"
          :auto-upload="false"
          accept=".xlsx"
          :limit="1"
          :on-change="handleImportChange"
          :on-remove="() => importFile = null"
          class="import-uploader"
        >
          <el-icon class="el-icon--upload"><Upload /></el-icon>
          <div class="el-upload__text">拖拽文件到此处或 <em>点击上传</em></div>
          <template #tip>
            <div class="el-upload__tip">仅支持 .xlsx，单个文件不超过 5MB</div>
          </template>
        </el-upload>

        <div v-if="importResult" class="import-result">
          <el-divider />
          <div class="result-summary">
            <el-statistic title="导入成功" :value="importResult.imported" />
            <el-statistic title="导入失败" :value="importResult.failed.length" />
          </div>
          <el-alert
            v-if="importResult.failed.length === 0"
            title="全部导入成功"
            type="success"
            :closable="false"
            show-icon
          />
          <div v-else class="error-list">
            <p class="error-title">失败明细：</p>
            <el-scrollbar max-height="180px">
              <div
                v-for="(item, idx) in importResult.failed"
                :key="idx"
                class="error-item"
              >
                <span class="error-row">第 {{ item.row }} 行</span>
                <span class="error-reason">{{ item.reason }}</span>
              </div>
            </el-scrollbar>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="closeImport">关闭</el-button>
        <el-button type="primary" :loading="importLoading" :disabled="!importFile" @click="submitImport">开始导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.filter-card :deep(.chart-card__body) {
  padding: 14px 16px;
}

.query-form {
  width: 100%;
}

.filter-panel {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) auto;
  gap: 12px 16px;
  align-items: end;
}

.filter-panel__filters {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: flex-end;
  padding-top: 2px;
}

.filter-panel__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-bottom: 1px;
}

.query-item {
  margin-bottom: 0;
}

.query-item :deep(.el-form-item__label) {
  height: 20px;
  margin-bottom: 4px;
  color: #697386;
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
}

.query-item :deep(.el-form-item__content) {
  line-height: 1;
}

.query-control {
  width: 190px;
}

.query-control--keyword {
  width: 100%;
}

.query-item--keyword {
  min-width: 320px;
}

.query-item--status .query-control {
  width: 150px;
}

.query-form :deep(.el-input__wrapper),
.query-form :deep(.el-select__wrapper) {
  min-height: 34px;
  border-radius: 6px;
  background: #fff;
}

.query-form :deep(.el-input__inner),
.query-form :deep(.el-select__placeholder),
.query-form :deep(.el-select__selected-item) {
  font-size: 13px;
}

.table-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.indicator-form :deep(.el-input-number .el-input__inner) {
  text-align: left;
}

.import-body {
  padding: 0 8px;
}

.import-tip {
  margin-bottom: 16px;
}

.import-uploader {
  width: 100%;
}

.import-result {
  margin-top: 8px;
}

.result-summary {
  display: flex;
  gap: 24px;
  margin-bottom: 16px;
}

.error-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-color-danger);
}

.error-list {
  background: var(--el-fill-color-light);
  border-radius: 4px;
  padding: 12px;
}

.error-item {
  display: flex;
  gap: 12px;
  padding: 6px 0;
  font-size: 13px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.error-item:last-child {
  border-bottom: none;
}

.error-row {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
  width: 80px;
}

.error-reason {
  color: var(--el-color-danger);
  word-break: break-all;
}

@media (max-width: 768px) {
  .filter-card :deep(.chart-card__body) {
    padding: 12px;
  }

  .filter-panel {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .filter-panel__filters {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .filter-panel__actions {
    order: 3;
    justify-content: stretch;
    padding-bottom: 0;
  }

  .filter-panel__actions .el-button {
    flex: 1;
  }

  .query-item,
  .query-item--keyword,
  .query-control,
  .query-control--keyword {
    min-width: 0;
    width: 100%;
  }

  .table-actions {
    width: 100%;
  }

  .result-summary {
    flex-direction: column;
    gap: 12px;
  }
}
</style>
