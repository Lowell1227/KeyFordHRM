<script setup lang="ts">
import { reactive, watch } from 'vue';
import { Plus, Delete } from '@element-plus/icons-vue';
import IndicatorOperationTimeline from './IndicatorOperationTimeline.vue';
import type {
  FlowRecord,
  IndicatorInstance,
  IndicatorProposalItem,
  SubmitIndicatorProposalBody,
} from '@/types/api.types';

const props = defineProps<{
  instances: IndicatorInstance[];
  flowRecords?: FlowRecord[];
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'submit', body: SubmitIndicatorProposalBody): void;
}>();

const form = reactive<SubmitIndicatorProposalBody>({
  items: [],
  note: '',
});

watch(
  () => props.instances,
  (instances) => {
    form.items = instances.length
      ? instances.map(toFormItem)
      : [createEmptyItem()];
  },
  { immediate: true, deep: true },
);

function createEmptyItem(): IndicatorProposalItem {
  return {
    name: '',
    description: '',
    scoringStandard: '',
    dataSource: '',
    dataCaliber: '',
    weight: 1,
    indicatorType: 'kpi',
    dimensionName: 'KPI维度',
    dimensionWeight: 1,
  };
}

function toFormItem(instance: IndicatorInstance): IndicatorProposalItem {
  return {
    templateIndicatorId: instance.templateIndicatorId,
    name: instance.name,
    description: instance.description,
    scoringStandard: instance.scoringStandard,
    dataSource: instance.dataSource,
    dataCaliber: instance.dataCaliber,
    targetValue: instance.targetValue,
    targetValueText: instance.targetValueText,
    unit: instance.unit,
    weight: instance.weight,
    indicatorType: instance.indicatorType,
    dimensionName: instance.dimensionName || 'KPI维度',
    dimensionWeight: instance.dimensionWeight,
    sortOrder: instance.sortOrder,
  };
}

function addItem() {
  form.items.unshift({
    ...createEmptyItem(),
    weight: form.items.length ? Number((1 / (form.items.length + 1)).toFixed(4)) : 1,
  });
}

function removeItem(index: number) {
  if (form.items.length === 1) {
    form.items[0] = createEmptyItem();
    return;
  }
  form.items.splice(index, 1);
}

function trimItem(item: IndicatorProposalItem, index: number): IndicatorProposalItem {
  return {
    name: item.name?.trim() ?? '',
    description: item.description?.trim() || undefined,
    scoringStandard: item.scoringStandard?.trim() || undefined,
    dataSource: item.dataSource?.trim() || undefined,
    dataCaliber: item.dataCaliber?.trim() || undefined,
    targetValue: item.targetValue,
    targetValueText: item.targetValueText?.trim() || undefined,
    unit: item.unit?.trim() || undefined,
    weight: Number(item.weight ?? 0),
    indicatorType: item.indicatorType ?? 'kpi',
    dimensionName: item.dimensionName?.trim() || 'KPI维度',
    dimensionWeight: Number(item.dimensionWeight ?? 1),
    sortOrder: index,
  };
}

function handleSubmit() {
  const items = form.items.map(trimItem).filter((item) => item.name);
  emit('submit', {
    items,
    note: form.note?.trim() || undefined,
  });
}
</script>

<template>
  <el-card shadow="never" class="indicator-proposal">
    <template #header>
      <div class="card-header">
        <span>本周期指标草稿</span>
        <el-tag type="warning" effect="plain">目标制定中</el-tag>
      </div>
    </template>

    <el-alert
      class="proposal-tip"
      type="info"
      :closable="false"
      show-icon
      title="这里编辑的就是本周期指标。当前为草稿状态，主管定稿后会流转到“待员工确认指标”，确认后的同一批指标用于自评和评分。"
    />

    <div class="proposal-list">
      <div v-for="(item, index) in form.items" :key="index" class="proposal-row">
        <el-input v-model="item.name" placeholder="指标名称" maxlength="100" show-word-limit />
        <el-input v-model="item.description" placeholder="目标说明，例如：按期完成项目关键节点" maxlength="300" show-word-limit />
        <el-input v-model="item.scoringStandard" placeholder="评分标准" maxlength="300" show-word-limit />
        <el-input-number
          v-model="item.weight"
          :min="0"
          :max="1"
          :step="0.05"
          :precision="4"
          controls-position="right"
          placeholder="权重"
        />
        <el-button :icon="Delete" text type="danger" @click="removeItem(index)">删除</el-button>
      </div>
    </div>

    <el-button :icon="Plus" link type="primary" @click="addItem">添加指标</el-button>

    <el-input
      v-model="form.note"
      class="proposal-note"
      type="textarea"
      :rows="3"
      maxlength="1000"
      show-word-limit
      placeholder="补充说明，例如本周期重点项目、资源支持需求、需要主管确认的口径"
    />

    <div class="proposal-actions">
      <el-button type="primary" :loading="loading" @click="handleSubmit">保存指标草稿</el-button>
    </div>

    <IndicatorOperationTimeline :records="flowRecords" />
  </el-card>
</template>

<style scoped>
.indicator-proposal {
  margin-bottom: 16px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.proposal-tip {
  margin-bottom: 14px;
}

.proposal-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.proposal-row {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(190px, 1.1fr) minmax(190px, 1.1fr) 120px auto;
  gap: 10px;
  align-items: center;
}

.proposal-row :deep(.el-input-number) {
  width: 100%;
}

.proposal-note {
  margin-top: 12px;
}

.proposal-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

@media (max-width: 900px) {
  .proposal-row {
    grid-template-columns: 1fr;
  }

  .proposal-actions {
    justify-content: flex-start;
  }
}
</style>
