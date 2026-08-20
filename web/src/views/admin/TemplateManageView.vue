<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import axios from 'axios';
import { Plus, CopyDocument, View, EditPen, QuestionFilled, Delete } from '@element-plus/icons-vue';
import { templatesApi } from '@/api/templates.api';
import { indicatorsApi } from '@/api/indicators.api';
import { departmentsApi } from '@/api/departments.api';
import { usersApi } from '@/api/users.api';
import DeptTree from '@/components/common/DeptTree.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import CollapsibleFilterPanel from '@/components/common/CollapsibleFilterPanel.vue';
import { formatDateTime } from '@/utils/date';
import type {
  AssessmentTemplate,
  TemplateListItem,
  TemplateDimension,
  TemplateIndicator,
  Indicator,
  Department,
  User,
} from '@/types/api.types';
import type { DimensionType } from '@/types/enums';

interface EditableIndicator extends Omit<TemplateIndicator, 'weight'> {
  weight: number; // 百分比 0-100
}

interface EditableDimension extends Omit<TemplateDimension, 'weight' | 'indicators'> {
  weight: number; // 百分比 0-100
  indicators: EditableIndicator[];
}

interface TemplateForm {
  id?: string;
  name: string;
  description: string;
  applicableDepts: string[];
  applicableUsers: string[];
  maxScore: number;
  isActive: boolean;
  dimensions: EditableDimension[];
}

const DIMENSION_TYPES: { label: string; value: DimensionType }[] = [
  { label: 'KPI', value: 'kpi' },
  { label: '非量化KPI', value: 'attitude' },
  { label: '加分项', value: 'bonus' },
  { label: '扣分项', value: 'penalty' },
];

const listLoading = ref(false);
const submitLoading = ref(false);
const templates = ref<TemplateListItem[]>([]);
const selectedTemplates = ref<TemplateListItem[]>([]);
const total = ref(0);
const query = reactive({ page: 1, pageSize: 10, keyword: '', isActive: true });

const departments = ref<Department[]>([]);
const users = ref<User[]>([]);
const indicators = ref<Indicator[]>([]);
const userLoading = ref(false);

const dialogVisible = ref(false);
const dialogTitle = ref('新建模板');
const isView = ref(false);
const applicableUsersExpanded = ref(false);
const formRef = ref<any>(null);
const form = reactive<TemplateForm>({
  name: '',
  description: '',
  applicableDepts: [],
  applicableUsers: [],
  maxScore: 100,
  isActive: true,
  dimensions: [],
});

const deptMap = computed(() => {
  const map = new Map<string, string>();
  departments.value.forEach((d) => map.set(d.id, d.name));
  return map;
});

const userMap = computed(() => {
  const map = new Map<string, string>();
  users.value.forEach((u) => map.set(u.id, u.name));
  return map;
});

const weightError = computed(() => validateWeights(form.dimensions));

const coreDimensionWeightTotal = computed(() =>
  sumWeights(form.dimensions.filter((dim) => dim.type === 'kpi' || dim.type === 'attitude')),
);

const indicatorMap = computed(() => {
  const map = new Map<string, Indicator>();
  indicators.value.forEach((item) => map.set(item.id, item));
  return map;
});

function toPercentWeight(weight: number | string): number {
  return Number((Number(weight) * 100).toFixed(2));
}

function toApiWeight(weight: number): number {
  return Number((weight / 100).toFixed(4));
}

function emptyForm(): TemplateForm {
  return {
    name: '',
    description: '',
    applicableDepts: [],
    applicableUsers: [],
    maxScore: 100,
    isActive: true,
    dimensions: [],
  };
}

function createEmptyDimension(type: DimensionType = 'kpi'): EditableDimension {
  return {
    name: type === 'kpi' ? 'KPI维度' : type === 'attitude' ? '非量化KPI' : type === 'bonus' ? '加分项' : '扣分项',
    type,
    weight: 0,
    sortOrder: form.dimensions.length,
    indicators: [],
  };
}

function createEmptyIndicator(): EditableIndicator {
  return {
    name: '',
    targetValueText: '',
    weight: 0,
    sortOrder: 0,
  };
}

function validateWeights(dimensions: EditableDimension[]): string | null {
  const coreDimensions = dimensions.filter((d) => d.type === 'kpi' || d.type === 'attitude');
  if (coreDimensions.length === 0) return null; // 没有核心维度时不校验

  const coreWeightSum = coreDimensions.reduce((sum, d) => sum + (Number(d.weight) || 0), 0);
  if (Math.abs(coreWeightSum - 100) > 0.01) {
    return `维度权重合计应为 100%，当前 ${coreWeightSum.toFixed(2)}%`;
  }

  for (const dim of coreDimensions) {
    const indicatorSum = dim.indicators.reduce((sum, i) => sum + (Number(i.weight) || 0), 0);
    if (Math.abs(indicatorSum - 100) > 0.01) {
      return `维度「${dim.name || '未命名'}」的指标权重合计应为 100%，当前 ${indicatorSum.toFixed(2)}%`;
    }
  }
  return null;
}

function sumWeights(items: Array<{ weight?: number }>): number {
  return Number(items.reduce((sum, item) => sum + (Number(item.weight) || 0), 0).toFixed(2));
}

function indicatorWeightTotal(dim: EditableDimension): number {
  return sumWeights(dim.indicators);
}

function formatWeightTotal(value: number): string {
  return `${value.toFixed(2)}%`;
}

function isWeightComplete(value: number): boolean {
  return Math.abs(value - 100) <= 0.01;
}

function totalTagType(value: number): 'success' | 'danger' {
  return isWeightComplete(value) ? 'success' : 'danger';
}

function formatScope(row: TemplateListItem): string {
  const deptNames = row.applicableDepts.map((id) => deptMap.value.get(id) ?? id);
  const userCount = row.applicableUsers.length;
  if (deptNames.length && userCount) {
    return `${deptNames.join('、')}；${userCount} 人`;
  }
  if (deptNames.length) return deptNames.join('、');
  return `${userCount} 人`;
}

function isTemplateLocked(row: TemplateListItem): boolean {
  return Boolean(row.isLocked);
}

function editStateLabel(row: TemplateListItem): string {
  const count = row.lockedUsageCount ?? 0;
  return isTemplateLocked(row) && count > 0 ? `已锁定（${count}次使用）` : isTemplateLocked(row) ? '已锁定' : '可编辑';
}

async function loadList() {
  listLoading.value = true;
  try {
    const res = await templatesApi.findAll({ ...query });
    templates.value = res.items;
    total.value = res.total;
    selectedTemplates.value = [];
  } catch (e) {
    templates.value = [];
    total.value = 0;
    selectedTemplates.value = [];
  } finally {
    listLoading.value = false;
  }
}

function handleSelectionChange(rows: TemplateListItem[]) {
  selectedTemplates.value = rows;
}

async function loadDepartments() {
  try {
    departments.value = await departmentsApi.findAll({ isActive: true });
  } catch {
    departments.value = [];
  }
}

async function loadUsers(keyword = '') {
  userLoading.value = true;
  try {
    const res = await usersApi.findAll({ page: 1, pageSize: 100, keyword });
    mergeUsers(res.items);
  } catch {
    if (!keyword) users.value = [];
  } finally {
    userLoading.value = false;
  }
}

async function loadIndicators() {
  try {
    const res = await indicatorsApi.findAll({ page: 1, pageSize: 100, isActive: true });
    indicators.value = res.items;
  } catch {
    indicators.value = [];
  }
}

function mergeUsers(items: User[]) {
  const map = new Map(users.value.map((user) => [user.id, user]));
  items.forEach((user) => map.set(user.id, user));
  users.value = Array.from(map.values());
}

async function ensureUsersLoaded(userIds: string[]) {
  const missing = new Set(userIds.filter((id) => !userMap.value.has(id)));
  if (missing.size === 0) return;

  const pageSize = 100;
  for (let pageNo = 1; missing.size > 0; pageNo += 1) {
    const res = await usersApi.findAll({ page: pageNo, pageSize });
    mergeUsers(res.items);
    res.items.forEach((user) => missing.delete(user.id));

    if (res.items.length === 0 || users.value.length >= res.total) break;
  }
}

function openCreate() {
  isView.value = false;
  applicableUsersExpanded.value = false;
  dialogTitle.value = '新建模板';
  Object.assign(form, emptyForm());
  addDimension('kpi', false);
  addDimension('attitude', false);
  dialogVisible.value = true;
  loadUsers();
}

async function openView(row: TemplateListItem) {
  isView.value = true;
  applicableUsersExpanded.value = false;
  dialogTitle.value = '查看模板';
  await loadDetail(row.id);
  dialogVisible.value = true;
}

async function openEdit(row: TemplateListItem) {
  isView.value = false;
  applicableUsersExpanded.value = false;
  dialogTitle.value = '编辑模板';
  await loadDetail(row.id);
  dialogVisible.value = true;
}

async function loadDetail(id: string) {
  try {
    const detail = await templatesApi.findOne(id);
    Object.assign(form, fromApiTemplate(detail));
    await ensureUsersLoaded(detail.applicableUsers);
  } catch {
    Object.assign(form, emptyForm());
  }
}

function fromApiTemplate(template: AssessmentTemplate): TemplateForm {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? '',
    applicableDepts: template.applicableDepts ?? [],
    applicableUsers: template.applicableUsers ?? [],
    maxScore: Number(template.maxScore) || 100,
    isActive: template.isActive,
    dimensions: (template.dimensions ?? []).map((dim, dIdx) => ({
      id: dim.id,
      name: dim.name,
      type: dim.type,
      weight: toPercentWeight(dim.weight),
      sortOrder: dim.sortOrder ?? dIdx,
      indicators: (dim.indicators ?? []).map((ind, iIdx) => ({
        id: ind.id,
        indicatorId: ind.indicatorId,
        name: ind.name,
        description: ind.description,
        scoringStandard: ind.scoringStandard,
        dataSource: ind.dataSource,
        dataCaliber: ind.dataCaliber,
        targetValue: ind.targetValue != null ? Number(ind.targetValue) : undefined,
        targetValueText: ind.targetValueText,
        unit: ind.unit,
        weight: toPercentWeight(ind.weight),
        sortOrder: ind.sortOrder ?? iIdx,
      })),
    })),
  };
}

function toApiPayload(formValue: TemplateForm): {
  name: string;
  description: string;
  applicableDepts: string[];
  applicableUsers: string[];
  maxScore: number;
  isActive: boolean;
  dimensions: TemplateDimension[];
} {
  return {
    name: formValue.name,
    description: formValue.description,
    applicableDepts: formValue.applicableDepts,
    applicableUsers: formValue.applicableUsers,
    maxScore: formValue.maxScore,
    isActive: formValue.isActive,
    dimensions: formValue.dimensions.map((dim, dIdx) => ({
      id: dim.id,
      name: dim.name,
      type: dim.type,
      weight: toApiWeight(dim.weight),
      sortOrder: dIdx,
      indicators: dim.indicators.map((ind, iIdx) => ({
        id: ind.id,
        indicatorId: ind.indicatorId,
        name: ind.name,
        description: ind.description,
        scoringStandard: ind.scoringStandard,
        dataSource: ind.dataSource,
        dataCaliber: ind.dataCaliber,
        targetValue: ind.targetValue,
        targetValueText: ind.targetValueText,
        unit: ind.unit,
        weight: toApiWeight(ind.weight),
        sortOrder: iIdx,
      })),
    })),
  };
}

function addDimension(type: DimensionType = 'kpi', prepend = true) {
  const dimension = createEmptyDimension(type);
  if (prepend) {
    form.dimensions.unshift(dimension);
  } else {
    form.dimensions.push(dimension);
  }
}

function removeDimension(index: number) {
  form.dimensions.splice(index, 1);
}

function addIndicator(dimIndex: number) {
  form.dimensions[dimIndex].indicators.push(createEmptyIndicator());
}

function indicatorOptionsFor(dim: EditableDimension): Indicator[] {
  return indicators.value.filter((item) => item.type === dim.type);
}

function applyLibraryIndicator(dimIndex: number, indicatorIndex: number, indicatorId?: string) {
  const row = form.dimensions[dimIndex].indicators[indicatorIndex];
  row.indicatorId = indicatorId;
  if (!indicatorId) return;

  const indicator = indicatorMap.value.get(indicatorId);
  if (!indicator) return;

  row.name = indicator.name;
  row.description = indicator.description;
  row.scoringStandard = indicator.scoringStandard;
  row.dataSource = indicator.dataSource;
  row.dataCaliber = indicator.dataCaliber;
  row.targetValue = indicator.targetValue;
  row.targetValueText = indicator.targetValueText;
  row.unit = indicator.unit;
}

function removeIndicator(dimIndex: number, indIndex: number) {
  form.dimensions[dimIndex].indicators.splice(indIndex, 1);
}

async function handleDuplicate(row: TemplateListItem) {
  try {
    await ElMessageBox.confirm(`确定复制模板「${row.name}」吗？`, '复制模板', { type: 'info' });
    const duplicated = await templatesApi.duplicate(row.id);
    ElMessage.success('复制成功');
    await loadList();
    // 直接打开编辑副本
    await openEdit({ ...row, id: duplicated.id, name: duplicated.name, version: duplicated.version });
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(e instanceof Error ? e.message : '复制失败');
    }
  }
}

async function handleBatchDelete() {
  if (selectedTemplates.value.length === 0) {
    ElMessage.warning('请先选择要删除的模板');
    return;
  }

  try {
    await ElMessageBox.confirm(
      `确定删除已选的 ${selectedTemplates.value.length} 个模板吗？删除后模板会从列表隐藏，并且不会再参与新考核周期匹配；已生成的历史考核记录不受影响。`,
      '删除模板',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    );

    const result = await templatesApi.removeMany(selectedTemplates.value.map((item) => item.id));
    ElMessage.success(`已删除 ${result.deletedCount} 个模板`);
    if (templates.value.length === selectedTemplates.value.length && query.page > 1) {
      query.page -= 1;
    }
    await loadList();
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(e instanceof Error ? e.message : '删除失败');
    }
  }
}

async function handleSubmit() {
  if (isView.value) {
    dialogVisible.value = false;
    return;
  }

  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  const weightErr = weightError.value;
  if (weightErr) {
    ElMessage.error(weightErr);
    return;
  }

  if (form.applicableDepts.length === 0 && form.applicableUsers.length === 0) {
    ElMessage.warning('适用范围至少选择一个部门或人员');
    return;
  }

  const payload = toApiPayload(form);
  submitLoading.value = true;
  try {
    if (form.id) {
      await templatesApi.update(form.id, payload);
      ElMessage.success('更新成功');
    } else {
      await templatesApi.create(payload);
      ElMessage.success('创建成功');
    }
    dialogVisible.value = false;
    await loadList();
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 409) {
      ElMessageBox.alert(
        '这个模板已经被考核周期使用过，系统需要保留当时的模板内容，避免已生成的考核任务和历史结果被改动。你可以点击列表里的「复制」，生成一个新模板后再调整指标和权重。',
        '模板已锁定',
        {
          type: 'warning',
          confirmButtonText: '知道了',
        },
      );
    }
  } finally {
    submitLoading.value = false;
  }
}

function handleDialogClose() {
  formRef.value?.resetFields();
}

onMounted(() => {
  loadDepartments();
  loadUsers();
  loadIndicators();
  loadList();
});
</script>

<template>
  <div class="template-manage-view page-stack app-list-page">
    <ChartCard class="list-page-header-card">
      <template #title>考核模板</template>
      <template #extra>
        <el-button
          type="danger"
          plain
          :icon="Delete"
          :disabled="selectedTemplates.length === 0"
          @click="handleBatchDelete"
        >
          删除所选
        </el-button>
        <el-button type="primary" :icon="Plus" data-testid="template-create" @click="openCreate">新建模板</el-button>
      </template>

      <CollapsibleFilterPanel class="page-filter-panel">
        <div class="filter-row">
        <el-input
          v-model="query.keyword"
          placeholder="搜索模板名称"
          clearable
          style="width: 220px"
          @keyup.enter="query.page = 1; loadList()"
        />
        <el-select
          v-model="query.isActive"
          placeholder="状态"
          clearable
          style="width: 140px"
          @change="query.page = 1; loadList()"
        >
          <el-option label="启用" :value="true" />
          <el-option label="停用" :value="false" />
        </el-select>
        <el-button type="primary" @click="query.page = 1; loadList()">查询</el-button>
        </div>
      </CollapsibleFilterPanel>
    </ChartCard>

    <ChartCard :padded="false" class="list-result-card">
      <el-table
        v-loading="listLoading"
        class="app-table"
        :data="templates"
        height="100%"
        row-key="id"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="48" />
        <el-table-column prop="name" label="模板名称" min-width="180" />
        <el-table-column width="160">
          <template #header>
            <span class="table-header-help">
              编辑状态
              <el-popover
                trigger="click"
                placement="top"
                width="300"
                content="表示模板是否还能直接修改。已锁定说明模板已经随考核周期发起生成过历史快照，为保证已生成任务和历史结果一致，不能直接改原模板，建议复制后编辑副本。"
              >
                <template #reference>
                  <el-icon class="header-help-icon"><QuestionFilled /></el-icon>
                </template>
              </el-popover>
            </span>
          </template>
          <template #default="{ row }">
            <el-tag :type="isTemplateLocked(row as TemplateListItem) ? 'warning' : 'success'" size="small">
              {{ editStateLabel(row as TemplateListItem) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column min-width="240">
          <template #header>
            <span class="table-header-help">
              适用范围
              <el-popover
                trigger="click"
                placement="top"
                width="320"
                content="部门和人员不是交集关系。发起考核时先按指定人员匹配模板；未被人员规则命中的员工，再按所属部门匹配。列表里的部门加人员表示覆盖范围，可理解为部门覆盖人员加额外指定人员。"
              >
                <template #reference>
                  <el-icon class="header-help-icon"><QuestionFilled /></el-icon>
                </template>
              </el-popover>
            </span>
          </template>
          <template #default="{ row }">
            <span class="scope-text">{{ formatScope(row as TemplateListItem) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="dimensionCount" label="维度数" width="100" />
        <el-table-column label="最近更新" width="150">
          <template #default="{ row }">
            {{ formatDateTime((row as TemplateListItem).updatedAt ?? (row as TemplateListItem).createdAt) }}
          </template>
        </el-table-column>
        <el-table-column width="130">
          <template #header>
            <span class="table-header-help">
              启用状态
              <el-popover
                trigger="click"
                placement="top"
                width="280"
                content="表示模板是否参与新的考核周期匹配。停用后不再用于后续新周期；已经生成过的历史周期和任务不受影响。它和编辑状态是两个独立概念。"
              >
                <template #reference>
                  <el-icon class="header-help-icon"><QuestionFilled /></el-icon>
                </template>
              </el-popover>
            </span>
          </template>
          <template #default="{ row }">
            <el-tag :type="(row as TemplateListItem).isActive ? 'success' : 'info'" size="small">
              {{ (row as TemplateListItem).isActive ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="version" label="版本" width="80" />
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link :icon="View" size="small" @click="openView(row as TemplateListItem)">查看</el-button>
            <el-button v-if="isTemplateLocked(row as TemplateListItem)" link :icon="EditPen" size="small" disabled>编辑</el-button>
            <el-button
              v-else
              link
              :icon="EditPen"
              size="small"
              @click="openEdit(row as TemplateListItem)"
            >
              编辑
            </el-button>
            <el-button link :icon="CopyDocument" size="small" @click="handleDuplicate(row as TemplateListItem)">复制</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="app-pager">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @change="loadList"
        />
      </div>
    </ChartCard>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="960px"
      destroy-on-close
      :close-on-click-modal="false"
      @close="handleDialogClose"
    >
      <el-form
        ref="formRef"
        :model="form"
        label-width="90px"
        :disabled="isView"
        class="template-form"
      >
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item
              label="模板名称"
              prop="name"
              :rules="[{ required: true, message: '请输入模板名称', trigger: 'blur' }]"
            >
              <el-input v-model="form.name" data-testid="template-name" placeholder="例如：Q4 绩效考核模板" maxlength="50" show-word-limit />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="满分">
              <el-input-number v-model="form.maxScore" :min="1" :max="1000" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="描述" prop="description">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="模板说明（可选）" />
        </el-form-item>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="适用部门">
              <DeptTree
                v-model="form.applicableDepts"
                :departments="departments"
                multiple
                check-strictly
                placeholder="选择适用部门"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="适用人员">
              <el-select-v2
                v-model="form.applicableUsers"
                :class="['applicable-user-select', { 'is-expanded': applicableUsersExpanded }]"
                :options="users.map(u => ({ label: `${u.name} (${u.employeeNo || u.phone || u.id})`, value: u.id }))"
                placeholder="搜索并选择人员"
                multiple
                :collapse-tags="!applicableUsersExpanded"
                :collapse-tags-tooltip="!applicableUsersExpanded"
                :max-collapse-tags="3"
                filterable
                remote
                :remote-method="loadUsers"
                :loading="userLoading"
                clearable
                style="width: 100%"
              />
              <div v-if="form.applicableUsers.length > 3" class="selected-summary">
                <span>已选 {{ form.applicableUsers.length }} 人</span>
                <el-button link type="primary" size="small" @click="applicableUsersExpanded = !applicableUsersExpanded">
                  {{ applicableUsersExpanded ? '收起' : '展开全部' }}
                </el-button>
              </div>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="启用状态">
          <el-switch v-model="form.isActive" active-text="启用" inactive-text="停用" />
        </el-form-item>

        <el-divider content-position="left">维度与指标</el-divider>

        <div v-if="!isView" class="dimension-actions">
          <el-button
            type="primary"
            size="small"
            :icon="Plus"
            data-testid="template-add-dimension"
            @click="addDimension('kpi')"
          >
            添加维度
          </el-button>
          <span v-if="weightError" class="weight-error-inline">{{ weightError }}</span>
          <span v-else-if="form.dimensions.length > 0" class="weight-ok-inline">权重校验通过</span>
        </div>

        <div v-if="form.dimensions.length > 0" class="weight-summary-bar">
          <el-tag :type="totalTagType(coreDimensionWeightTotal)" effect="light">
            维度权重合计：{{ formatWeightTotal(coreDimensionWeightTotal) }} / 100%
          </el-tag>
        </div>

        <div v-if="form.dimensions.length === 0" class="empty-dimensions">
          <el-empty description="暂无维度，请点击上方添加" :image-size="80" />
        </div>

        <div class="dimensions-list">
          <el-card
            v-for="(dim, dimIndex) in form.dimensions"
            :key="dimIndex"
            shadow="never"
            class="dimension-card"
          >
            <template #header>
              <div class="dimension-header">
                <div class="dimension-title">
                  <el-input
                    v-model="dim.name"
                    placeholder="维度名称"
                    style="width: 180px"
                    :disabled="isView"
                  />
                  <el-select
                    v-model="dim.type"
                    placeholder="维度类型"
                    style="width: 130px; margin-left: 12px"
                    :disabled="isView"
                  >
                    <el-option
                      v-for="t in DIMENSION_TYPES"
                      :key="t.value"
                      :label="t.label"
                      :value="t.value"
                    />
                  </el-select>
                  <el-input-number
                    v-model="dim.weight"
                    :data-testid="`dimension-weight-${dimIndex}`"
                    :min="0"
                    :max="100"
                    :precision="2"
                    placeholder="权重%"
                    style="width: 130px; margin-left: 12px"
                    :disabled="isView"
                  />
                  <div class="dimension-weight-total">
                    <el-tag size="small" :type="totalTagType(indicatorWeightTotal(dim))" effect="plain">
                      本维度指标合计：{{ formatWeightTotal(indicatorWeightTotal(dim)) }} / 100%
                    </el-tag>
                  </div>
                </div>
                <el-button
                  v-if="!isView"
                  type="danger"
                  link
                  size="small"
                  @click="removeDimension(dimIndex)"
                >
                  删除维度
                </el-button>
              </div>
            </template>

            <el-table :data="dim.indicators" size="small" :border="true">
              <el-table-column label="关联指标库" min-width="220">
                <template #default="{ $index }">
                  <el-select
                    v-model="dim.indicators[$index].indicatorId"
                    filterable
                    clearable
                    placeholder="选择指标库指标"
                    style="width: 100%"
                    :disabled="isView"
                    @change="(value?: string) => applyLibraryIndicator(dimIndex, $index, value)"
                  >
                    <el-option
                      v-for="indicator in indicatorOptionsFor(dim)"
                      :key="indicator.id"
                      :label="`${indicator.name}${indicator.code ? `（${indicator.code}）` : ''}`"
                      :value="indicator.id"
                    >
                      <div class="indicator-option">
                        <span>{{ indicator.name }}</span>
                        <span v-if="indicator.code" class="indicator-option-code">{{ indicator.code }}</span>
                      </div>
                    </el-option>
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="指标名称" min-width="160">
                <template #default="{ $index }">
                  <el-input v-model="dim.indicators[$index].name" placeholder="指标名称" :disabled="isView" />
                </template>
              </el-table-column>
              <el-table-column label="权重%" width="110">
                <template #default="{ $index }">
                 <el-input-number
                   v-model="dim.indicators[$index].weight"
                    :data-testid="`indicator-weight-${dimIndex}-${$index}`"
                    :min="0"
                    :max="100"
                    :precision="2"
                    controls-position="right"
                    style="width: 90px"
                    :disabled="isView"
                  />
                </template>
              </el-table-column>
              <el-table-column label="评分标准" min-width="160">
                <template #default="{ $index }">
                  <el-input v-model="dim.indicators[$index].scoringStandard" placeholder="评分标准" :disabled="isView" />
                </template>
              </el-table-column>
              <el-table-column label="数据来源" min-width="140">
                <template #default="{ $index }">
                  <el-input v-model="dim.indicators[$index].dataSource" placeholder="数据来源" :disabled="isView" />
                </template>
              </el-table-column>
              <el-table-column label="数据口径" min-width="140">
                <template #default="{ $index }">
                  <el-input v-model="dim.indicators[$index].dataCaliber" placeholder="数据口径" :disabled="isView" />
                </template>
              </el-table-column>
              <el-table-column label="目标值" width="100">
                <template #default="{ $index }">
                  <el-input
                    v-if="dim.indicators[$index].targetValueText"
                    v-model="dim.indicators[$index].targetValueText"
                    placeholder="固定值"
                    :disabled="isView"
                  />
                  <el-input-number
                    v-else
                    v-model="dim.indicators[$index].targetValue"
                    :precision="2"
                    controls-position="right"
                    style="width: 90px"
                    :disabled="isView"
                  />
                </template>
              </el-table-column>
              <el-table-column label="单位" width="90">
                <template #default="{ $index }">
                  <el-input v-model="dim.indicators[$index].unit" placeholder="单位" :disabled="isView" />
                </template>
              </el-table-column>
              <el-table-column v-if="!isView" label="操作" width="80" fixed="right">
                <template #default="{ $index }">
                  <el-button type="danger" link size="small" @click="removeIndicator(dimIndex, $index)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>

            <div v-if="!isView" class="indicator-actions">
              <el-button type="primary" link size="small" :icon="Plus" @click="addIndicator(dimIndex)">
                添加指标
              </el-button>
            </div>
          </el-card>
        </div>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">{{ isView ? '关闭' : '取消' }}</el-button>
        <el-button v-if="!isView" type="primary" :loading="submitLoading" data-testid="template-submit" @click="handleSubmit">
          {{ form.id ? '保存' : '创建' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.filter-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.scope-text {
  color: #666;
  font-size: 13px;
}

.applicable-user-select {
  width: 100%;
}

:deep(.applicable-user-select .el-select__wrapper) {
  min-height: 32px;
}

:deep(.applicable-user-select.is-expanded .el-select__wrapper) {
  align-items: flex-start;
  max-height: 168px;
  overflow-y: auto;
}

.selected-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  color: #909399;
  font-size: 12px;
  line-height: 1.4;
}

.template-form {
  max-height: 70vh;
  overflow-y: auto;
  padding-right: 8px;
}

.table-header-help {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.header-help-icon {
  color: #909399;
  cursor: pointer;
  font-size: 14px;
}

.header-help-icon:hover {
  color: #409eff;
}

.dimension-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.weight-summary-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: -4px 0 16px;
}

.weight-error-inline {
  color: #f56c6c;
  font-size: 13px;
}

.weight-ok-inline {
  color: #67c23a;
  font-size: 13px;
}

.empty-dimensions {
  margin: 24px 0;
}

.dimensions-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dimension-card {
  background: #fafafa;
}

.dimension-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dimension-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.dimension-title :deep(.el-input),
.dimension-title :deep(.el-select) {
  margin-left: 0 !important;
}

.dimension-title :deep(.el-input-number) {
  margin-left: 0 !important;
}

.dimension-weight-total {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.indicator-actions {
  margin-top: 10px;
}

.indicator-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.indicator-option-code {
  color: #909399;
  font-size: 12px;
}

:deep(.el-dialog__body) {
  padding-top: 10px;
  padding-bottom: 10px;
}
</style>
