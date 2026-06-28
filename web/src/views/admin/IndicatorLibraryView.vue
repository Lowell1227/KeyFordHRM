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

type TargetValueMode = 'number' | 'percent' | 'fixed';

const TYPE_OPTIONS: { label: string; value: IndicatorType }[] = [
  { label: '量化KPI', value: 'kpi' },
  { label: '非量化KPI', value: 'attitude' },
  { label: '加分项', value: 'bonus' },
  { label: '扣分项', value: 'penalty' },
];

const ACTIVE_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '启用', value: 'true' },
  { label: '停用', value: 'false' },
];

const TARGET_MODE_OPTIONS: { label: string; value: TargetValueMode }[] = [
  { label: '数值', value: 'number' },
  { label: '百分比', value: 'percent' },
  { label: '固定值', value: 'fixed' },
];

const NUMERIC_UNIT_OPTIONS = ['', '个', '次', '天', '小时', '万元', '元', '分'];
const FIXED_TARGET_OPTIONS = ['合格', '良好', '优秀', '达标', '完成', '通过'];

const TYPE_LABEL_MAP: Record<IndicatorType, string> = {
  kpi: '量化KPI',
  attitude: '非量化KPI',
  bonus: '加分项',
  penalty: '扣分项',
  veto: '一票否决',
};

const CODE_PREFIX_MAP: Record<IndicatorType, string> = {
  kpi: 'KPI',
  attitude: 'NKPI',
  bonus: 'BONUS',
  penalty: 'PENALTY',
  veto: 'VETO',
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
  targetValueText: '',
  unit: '',
  groupName: '',
  isActive: true,
});

const form = reactive<CreateIndicatorBody>(emptyForm());
const targetValueMode = ref<TargetValueMode>('percent');

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

const targetValueDisplay = computed(() => (item: Pick<Indicator, 'targetValue' | 'targetValueText' | 'unit'>) => {
  if (item.targetValueText) return item.targetValueText;
  if (item.targetValue != null) return `${item.targetValue}${item.unit ? item.unit : ''}`;
  return '-';
});

const formTargetValueText = computed(() => {
  if (targetValueMode.value === 'fixed') return form.targetValueText?.trim() || '-';
  if (form.targetValue == null) return '-';
  const unit = targetValueMode.value === 'percent' ? '%' : form.unit || '';
  return `${form.targetValue}${unit}`;
});

const previewItems = computed(() => [
  { label: '指标类型', value: TYPE_LABEL_MAP[form.type] || '-' },
  { label: '考核维度', value: form.category?.trim() || '-' },
  { label: '分组', value: form.groupName?.trim() || '-' },
  { label: '参考目标值', value: formTargetValueText.value },
  { label: '数据来源', value: form.dataSource?.trim() || '-' },
  { label: '启用状态', value: form.isActive ? '启用' : '停用' },
]);

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
  generateCode(true);
  targetValueMode.value = 'percent';
  applyTargetMode();
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
    targetValueText: row.targetValueText ?? '',
    unit: row.unit ?? '',
    groupName: row.groupName ?? '',
    isActive: row.isActive,
  });
  targetValueMode.value = inferTargetMode(row);
  importResult.value = null;
  dialogVisible.value = true;
  nextTick(() => formRef.value?.clearValidate());
}

function closeDialog() {
  dialogVisible.value = false;
  Object.assign(form, emptyForm());
  editingId.value = null;
}

function buildAutoCode(type: IndicatorType): string {
  const prefix = CODE_PREFIX_MAP[type] || 'IND';
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${stamp}-${suffix}`;
}

function generateCode(force = false) {
  if (!force && form.code?.trim()) return;
  form.code = buildAutoCode(form.type);
}

async function saveIndicator(continueCreate = false) {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
  } catch {
    return;
  }

  generateCode();
  const targetPayload = buildTargetPayload();
  const payload: CreateIndicatorBody = {
    name: form.name.trim(),
    code: form.code?.trim() || undefined,
    category: form.category?.trim() || undefined,
    type: form.type,
    description: form.description?.trim() || undefined,
    scoringStandard: form.scoringStandard?.trim() || undefined,
    dataSource: form.dataSource?.trim() || undefined,
    dataCaliber: form.dataCaliber?.trim() || undefined,
    ...targetPayload,
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
    await loadList();
    if (continueCreate && !editingId.value) {
      Object.assign(form, emptyForm());
      targetValueMode.value = 'percent';
      applyTargetMode();
      await nextTick();
      formRef.value?.clearValidate();
      return;
    }
    closeDialog();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

function handleTypeChange() {
  if (form.type === 'kpi') {
    targetValueMode.value = 'percent';
  } else if (form.type === 'attitude') {
    targetValueMode.value = 'fixed';
  } else {
    targetValueMode.value = 'number';
  }
  applyTargetMode();
}

function inferTargetMode(item: Pick<CreateIndicatorBody, 'targetValue' | 'targetValueText' | 'unit'>): TargetValueMode {
  if (item.targetValueText) return 'fixed';
  if (item.unit === '%') return 'percent';
  return 'number';
}

function applyTargetMode() {
  if (targetValueMode.value === 'percent') {
    form.unit = '%';
    form.targetValueText = '';
    if (form.targetValue == null) form.targetValue = 100;
    return;
  }
  if (targetValueMode.value === 'fixed') {
    form.targetValue = undefined;
    form.unit = '';
    if (!form.targetValueText) form.targetValueText = '合格';
    return;
  }
  form.targetValueText = '';
  if (form.unit === '%') form.unit = '';
  if (form.targetValue == null) form.targetValue = 1;
}

function buildTargetPayload(): Pick<CreateIndicatorBody, 'targetValue' | 'targetValueText' | 'unit'> {
  if (targetValueMode.value === 'fixed') {
    return {
      targetValue: undefined,
      targetValueText: form.targetValueText?.trim() || undefined,
      unit: undefined,
    };
  }
  return {
    targetValue: form.targetValue,
    targetValueText: undefined,
    unit: targetValueMode.value === 'percent' ? '%' : form.unit?.trim() || undefined,
  };
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
            {{ targetValueDisplay(row as Indicator) }}
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
      width="min(960px, calc(100vw - 32px))"
      destroy-on-close
      :close-on-click-modal="false"
      class="indicator-dialog"
      @close="closeDialog"
    >
      <div class="indicator-editor">
        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          label-position="top"
          class="indicator-form"
        >
          <section class="form-section">
            <div class="form-section__header">
              <h3>基础信息</h3>
              <p>先确定指标是什么，后续模板和绩效任务会自动带入这些基础字段。</p>
            </div>
            <div class="form-grid form-grid--two">
              <el-form-item label="指标名称" prop="name">
                <el-input v-model="form.name" data-testid="indicator-name" placeholder="请输入指标名称" maxlength="100" show-word-limit />
              </el-form-item>
              <el-form-item label="编码">
                <el-input v-model="form.code" placeholder="系统自动生成，可手动调整" maxlength="50" />
              </el-form-item>
              <el-form-item label="指标类型" prop="type">
                <el-select v-model="form.type" placeholder="请选择类型" style="width: 100%" @change="handleTypeChange">
                  <el-option
                    v-for="opt in TYPE_OPTIONS"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="考核维度">
                <el-select v-model="form.category" placeholder="如：财务、运营、创新业务" filterable allow-create clearable style="width: 100%">
                  <el-option
                    v-for="opt in categoryOptions"
                    :key="opt"
                    :label="opt"
                    :value="opt"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="分组">
                <el-select v-model="form.groupName" placeholder="选择或输入分组" filterable allow-create clearable style="width: 100%">
                  <el-option
                    v-for="opt in groupOptions"
                    :key="opt"
                    :label="opt"
                    :value="opt"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="启用状态">
                <el-switch v-model="form.isActive" active-text="启用" inactive-text="停用" />
              </el-form-item>
            </div>
          </section>

          <section class="form-section">
            <div class="form-section__header">
              <h3>评价规则</h3>
              <p>指标描述用于解释这个指标本身，评分标准用于说明怎么算分。</p>
            </div>
            <el-form-item label="指标描述">
              <el-input
                v-model="form.description"
                type="textarea"
                :rows="3"
                placeholder="例如：衡量销售回款是否按计划完成"
                maxlength="500"
                show-word-limit
              />
            </el-form-item>
            <el-form-item label="评分标准">
              <el-input
                v-model="form.scoringStandard"
                type="textarea"
                :rows="3"
                placeholder="例如：实际回款金额 / 计划回款金额 * 100%，低于80%需说明原因"
                maxlength="500"
                show-word-limit
              />
            </el-form-item>
          </section>

          <section class="form-section">
            <div class="form-section__header">
              <h3>数据与目标</h3>
              <p>选择目标值类型后，单位和默认值会自动处理，减少手工填写。</p>
            </div>
            <el-form-item label="参考目标值" class="target-value-field">
              <el-select
                v-model="targetValueMode"
                class="target-mode-select"
                @change="applyTargetMode"
              >
                <el-option
                  v-for="opt in TARGET_MODE_OPTIONS"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
              <el-input-number
                v-if="targetValueMode !== 'fixed'"
                v-model="form.targetValue"
                :precision="2"
                :step="targetValueMode === 'percent' ? 5 : 1"
                class="target-number-input"
              />
              <el-select
                v-if="targetValueMode === 'number'"
                v-model="form.unit"
                class="target-unit-select"
                placeholder="单位"
                clearable
                filterable
                allow-create
              >
                <el-option
                  v-for="unit in NUMERIC_UNIT_OPTIONS"
                  :key="unit || 'none'"
                  :label="unit || '无单位'"
                  :value="unit"
                />
              </el-select>
              <span v-else-if="targetValueMode === 'percent'" class="target-unit-text">%</span>
              <el-select
                v-else
                v-model="form.targetValueText"
                class="target-fixed-select"
                filterable
                allow-create
                default-first-option
                placeholder="选择固定值"
              >
                <el-option
                  v-for="opt in FIXED_TARGET_OPTIONS"
                  :key="opt"
                  :label="opt"
                  :value="opt"
                />
              </el-select>
            </el-form-item>
            <div class="form-grid form-grid--two">
              <el-form-item label="数据来源">
                <el-input
                  v-model="form.dataSource"
                  type="textarea"
                  :rows="2"
                  placeholder="如：ERP销售报表、财务系统"
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
            </div>
          </section>
        </el-form>

        <aside class="indicator-preview">
          <div class="indicator-preview__eyebrow">实时预览</div>
          <h3>{{ form.name || '未命名指标' }}</h3>
          <p>{{ form.description || '填写指标描述后，这里会显示给模板和绩效任务参考。' }}</p>
          <div class="preview-list">
            <div v-for="item in previewItems" :key="item.label" class="preview-item">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>
          <div class="preview-rule">
            <span>评分标准</span>
            <p>{{ form.scoringStandard || '暂未填写' }}</p>
          </div>
        </aside>
      </div>
      <template #footer>
        <div class="indicator-dialog-footer">
          <div class="indicator-dialog-footer__hint">
            保存后可直接用于考核模板和绩效任务。
          </div>
          <div class="indicator-dialog-footer__actions">
            <el-button @click="closeDialog">取消</el-button>
            <el-button v-if="!editingId" :loading="saving" @click="saveIndicator(true)">保存并继续新建</el-button>
            <el-button data-testid="indicator-save" type="primary" :loading="saving" @click="saveIndicator(false)">保存</el-button>
          </div>
        </div>
      </template>
    </el-dialog>

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

.indicator-dialog :deep(.el-dialog__body) {
  padding: 12px 20px 0;
}

.indicator-dialog :deep(.el-dialog__header) {
  padding: 18px 22px 10px;
  border-bottom: 1px solid #eef2f7;
}

.indicator-dialog :deep(.el-dialog__title) {
  color: #172033;
  font-size: 18px;
  font-weight: 800;
}

.indicator-dialog :deep(.el-dialog__footer) {
  padding: 12px 20px 16px;
  border-top: 1px solid #eef2f7;
  background: #fff;
}

.indicator-editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 20px;
  align-items: start;
  max-height: 68vh;
  overflow: auto;
  padding-right: 4px;
}

.indicator-form {
  min-width: 0;
}

.form-section {
  padding: 16px 18px;
  border: 1px solid #e6eaf2;
  border-radius: 8px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
}

.form-section + .form-section {
  margin-top: 14px;
}

.form-section__header {
  margin-bottom: 14px;
}

.form-section__header h3 {
  margin: 0;
  color: #1f2937;
  font-size: 15px;
  font-weight: 700;
  line-height: 22px;
}

.form-section__header p {
  margin: 4px 0 0;
  color: #8a94a6;
  font-size: 12px;
  line-height: 18px;
}

.form-grid {
  display: grid;
  gap: 0 14px;
}

.form-grid--two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.indicator-form :deep(.el-input-number .el-input__inner) {
  text-align: left;
}

.indicator-form :deep(.el-form-item__label) {
  color: #697386;
  font-size: 13px;
  font-weight: 600;
}

.target-value-field :deep(.el-form-item__content) {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
}

.target-mode-select {
  width: 104px;
  flex: 0 0 auto;
}

.target-number-input {
  width: 150px;
  flex: 0 0 auto;
}

.target-unit-select {
  width: 96px;
  flex: 0 0 auto;
}

.target-fixed-select {
  width: 220px;
}

.target-unit-text {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-light);
}

.indicator-preview {
  position: sticky;
  top: 0;
  padding: 18px;
  border: 1px solid #dfe7f5;
  border-radius: 8px;
  background: linear-gradient(180deg, #f8fbff 0%, #ffffff 100%);
  box-shadow: 0 12px 28px rgba(34, 72, 132, 0.08);
}

.indicator-preview__eyebrow {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  color: #2f63ff;
  background: #edf3ff;
  font-size: 12px;
  font-weight: 700;
}

.indicator-preview h3 {
  margin: 12px 0 6px;
  color: #172033;
  font-size: 18px;
  font-weight: 800;
  line-height: 26px;
  word-break: break-word;
}

.indicator-preview > p {
  margin: 0 0 14px;
  color: #6b7280;
  font-size: 13px;
  line-height: 20px;
  word-break: break-word;
}

.preview-list {
  display: grid;
  gap: 8px;
}

.preview-item {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid #edf1f7;
}

.preview-item span,
.preview-rule span {
  flex: 0 0 auto;
  color: #8a94a6;
  font-size: 12px;
}

.preview-item strong {
  min-width: 0;
  color: #273244;
  font-size: 13px;
  font-weight: 700;
  text-align: right;
  word-break: break-word;
}

.preview-rule {
  margin-top: 14px;
  padding: 12px;
  border-radius: 6px;
  background: #f5f7fb;
}

.preview-rule p {
  margin: 6px 0 0;
  color: #273244;
  font-size: 13px;
  line-height: 20px;
  word-break: break-word;
}

.indicator-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.indicator-dialog-footer__hint {
  color: #8a94a6;
  font-size: 12px;
  line-height: 18px;
  text-align: left;
}

.indicator-dialog-footer__actions {
  display: flex;
  flex: 0 0 auto;
  gap: 10px;
  justify-content: flex-end;
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

  .indicator-editor {
    grid-template-columns: 1fr;
    max-height: none;
    padding-right: 0;
  }

  .form-grid--two {
    grid-template-columns: 1fr;
  }

  .indicator-preview {
    position: static;
  }

  .indicator-dialog :deep(.el-dialog) {
    margin: 8px auto;
  }

  .indicator-dialog :deep(.el-dialog__body) {
    max-height: calc(100vh - 148px);
    overflow-y: auto;
    padding: 10px 12px 0;
  }

  .indicator-dialog-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .indicator-dialog-footer__actions {
    width: 100%;
  }

  .indicator-dialog-footer__actions .el-button {
    flex: 1;
    min-height: 40px;
    margin-left: 0;
  }

  .result-summary {
    flex-direction: column;
    gap: 12px;
  }
}
</style>
