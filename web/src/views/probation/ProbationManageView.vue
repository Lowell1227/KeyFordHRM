<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import { probationApi } from '@/api/probation.api';
import ProbationList from './components/ProbationList.vue';
import UserSelect from '@/components/common/UserSelect.vue';
import {
  PROBATION_INDICATOR_TYPE_LABELS,
  PROBATION_STATUS_META,
} from '@/types/enums';
import type {
  ProbationReview,
  ProbationReviewIndicator,
} from '@/types/api.types';
import type { ProbationReviewStatus, ProbationIndicatorType } from '@/types/enums';

const dialogVisible = ref(false);
const dialogTitle = computed(() => (form.id ? '编辑试用期考核' : '发起试用期考核'));
const saving = ref(false);

const emptyForm = () => ({
  id: '',
  employeeId: '',
  managerId: '',
  plannedRegularDate: '',
  indicators: [] as ProbationReviewIndicatorFormItem[],
});

interface ProbationReviewIndicatorFormItem {
  id?: string;
  name: string;
  type: ProbationIndicatorType;
  weight: number;
  description?: string;
  targetValue?: string;
  sortOrder: number;
}

const form = reactive(emptyForm());

const typeOptions: ProbationIndicatorType[] = ['work_objective', 'values'];

function openCreate() {
  Object.assign(form, emptyForm());
  // 默认给一组 80/20 样例指标，方便 HR 快速填写
  form.indicators = [
    { name: '', type: 'work_objective', weight: 0.8, sortOrder: 0 },
    { name: '', type: 'values', weight: 0.2, sortOrder: 1 },
  ];
  dialogVisible.value = true;
}

function openEdit(row: ProbationReview) {
  Object.assign(form, {
    id: row.id,
    employeeId: row.employeeId,
    managerId: row.managerId,
    plannedRegularDate: row.plannedRegularDate ?? '',
    indicators: row.indicators.map((ind) => ({
      id: ind.id,
      name: ind.name,
      type: ind.type,
      weight: ind.weight,
      description: ind.description ?? '',
      targetValue: ind.targetValue ?? '',
      sortOrder: ind.sortOrder,
    })),
  });
  dialogVisible.value = true;
}

function addIndicator() {
  form.indicators.push({
    name: '',
    type: 'work_objective',
    weight: 0,
    sortOrder: form.indicators.length,
  });
}

function removeIndicator(index: number) {
  form.indicators.splice(index, 1);
}

function validateWeights(): string | null {
  const workSum = form.indicators
    .filter((i) => i.type === 'work_objective')
    .reduce((sum, i) => sum + (Number(i.weight) || 0), 0);
  const valuesSum = form.indicators
    .filter((i) => i.type === 'values')
    .reduce((sum, i) => sum + (Number(i.weight) || 0), 0);
  if (Math.abs(workSum - 0.8) > 0.001) {
    return `工作目标权重之和须为 80%，当前 ${(workSum * 100).toFixed(1)}%`;
  }
  if (Math.abs(valuesSum - 0.2) > 0.001) {
    return `价值观权重之和须为 20%，当前 ${(valuesSum * 100).toFixed(1)}%`;
  }
  return null;
}

function validateForm(): boolean {
  if (!form.employeeId) {
    ElMessage.warning('请选择试用期员工');
    return false;
  }
  if (!form.managerId) {
    ElMessage.warning('请选择主管');
    return false;
  }
  if (form.indicators.length === 0) {
    ElMessage.warning('请至少填写一项考核指标');
    return false;
  }
  for (const ind of form.indicators) {
    if (!ind.name) {
      ElMessage.warning('请填写指标名称');
      return false;
    }
  }
  const weightErr = validateWeights();
  if (weightErr) {
    ElMessage.warning(weightErr);
    return false;
  }
  return true;
}

async function handleSave() {
  if (!validateForm()) return;
  saving.value = true;
  try {
    const payload = {
      employeeId: form.employeeId,
      managerId: form.managerId,
      plannedRegularDate: form.plannedRegularDate || undefined,
      indicators: form.indicators.map((ind, idx) => ({
        name: ind.name,
        type: ind.type,
        weight: ind.weight,
        description: ind.description,
        targetValue: ind.targetValue,
        sortOrder: idx,
      })),
    };
    if (form.id) {
      await probationApi.update(form.id, payload);
    } else {
      await probationApi.create(payload);
    }
    ElMessage.success(form.id ? '更新成功' : '发起成功');
    dialogVisible.value = false;
  } finally {
    saving.value = false;
  }
}

function statusLabel(status: ProbationReviewStatus): string {
  return PROBATION_STATUS_META[status]?.label ?? status;
}
</script>

<template>
  <ProbationList mode="manage" @edit="openEdit">
    <template #header-extra>
      <el-button data-testid="probation-create" type="primary" :icon="Plus" @click="openCreate">发起试用期考核</el-button>
    </template>
  </ProbationList>

  <el-dialog
    v-model="dialogVisible"
    data-testid="probation-dialog"
    :title="dialogTitle"
    width="720"
    destroy-on-close
    :close-on-click-modal="false"
  >
    <el-form label-position="top">
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="试用期员工">
            <UserSelect
              v-model="form.employeeId"
              placeholder="搜索姓名/工号选择试用期员工"
              status="probation"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="主管">
            <UserSelect
              v-model="form.managerId"
              placeholder="搜索姓名/工号选择主管"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="计划转正日期">
        <el-date-picker
          v-model="form.plannedRegularDate"
          type="date"
          placeholder="选择计划转正日期"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
      </el-form-item>

      <div class="indicators-section">
        <div class="section-header">
          <span class="section-title">考核指标</span>
          <el-button type="primary" link @click="addIndicator">+ 添加指标</el-button>
        </div>
        <p class="section-tip">工作目标权重之和须为 80%，价值观权重之和须为 20%</p>

        <div
          v-for="(ind, idx) in form.indicators"
          :key="idx"
          class="indicator-row"
        >
          <el-row :gutter="12">
            <el-col :span="7">
              <el-input v-model="ind.name" placeholder="指标名称" maxlength="200" show-word-limit />
            </el-col>
            <el-col :span="5">
              <el-select v-model="ind.type" placeholder="类型" style="width: 100%">
                <el-option
                  v-for="t in typeOptions"
                  :key="t"
                  :label="PROBATION_INDICATOR_TYPE_LABELS[t]"
                  :value="t"
                />
              </el-select>
            </el-col>
            <el-col :span="5">
              <el-input-number
                v-model="ind.weight"
                :min="0"
                :max="1"
                :precision="4"
                placeholder="权重"
                style="width: 100%"
              />
            </el-col>
            <el-col :span="5">
              <el-input v-model="ind.targetValue" placeholder="目标值/标准" maxlength="500" />
            </el-col>
            <el-col :span="2">
              <el-button type="danger" link @click="removeIndicator(idx)">删除</el-button>
            </el-col>
          </el-row>
          <el-input
            v-model="ind.description"
            type="textarea"
            :rows="2"
            placeholder="指标说明（可选）"
            maxlength="2000"
            show-word-limit
            class="indicator-desc"
          />
        </div>
      </div>
    </el-form>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.indicators-section {
  margin-top: 8px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.section-title {
  font-weight: 600;
}

.section-tip {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin: 0 0 12px;
}

.indicator-row {
  margin-bottom: 12px;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

.indicator-desc {
  margin-top: 8px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
