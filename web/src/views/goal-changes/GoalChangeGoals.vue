<script setup lang="ts">
import { computed } from 'vue';
import { Delete } from '@element-plus/icons-vue';
import type { GoalChangeItem } from '@/api/goal-changes.api';
import { percent } from './goal-change-labels';

const props = defineProps<{
  beforeGoals: GoalChangeItem[]; modelValue: GoalChangeItem[]; editable: boolean;
  errors: Array<{ name?: string; weight?: string; targetValue?: string }>;
}>();
const emit = defineEmits<{ 'update:modelValue': [goals: GoalChangeItem[]] }>();
function update(index: number, key: keyof GoalChangeItem, value: string | number | null) {
  emit('update:modelValue', props.modelValue.map((goal, i) => i === index ? { ...goal, [key]: value } : goal));
}
function changeNumber(index: number, key: 'weight' | 'targetValue', event: Event) {
  const value = (event.target as HTMLInputElement).value;
  update(index, key, key === 'weight' ? (value === '' ? NaN : Number(value) / 100) : value === '' ? null : Number(value));
}
function add() {
  const template = props.beforeGoals.find(goal => goal.indicatorType === 'kpi') ?? props.beforeGoals[0];
  if (!template) return;
  emit('update:modelValue', [...props.modelValue, {
    sourceInstanceId: null, name: '', description: null, scoringStandard: null,
    targetValue: null, targetValueText: null, unit: null, weight: 0, indicatorType: template.indicatorType,
    dimensionName: template.dimensionName, dimensionWeight: template.dimensionWeight,
    sortOrder: Math.max(-1, ...props.beforeGoals.map(goal => goal.sortOrder), ...props.modelValue.map(goal => goal.sortOrder)) + 1,
  }]);
}
function sameDimension(a: GoalChangeItem, b: GoalChangeItem) {
  return a.indicatorType === b.indicatorType && a.dimensionName === b.dimensionName && a.dimensionWeight === b.dimensionWeight;
}
const dimensions = computed(() => props.beforeGoals.filter((goal, index, all) => all.findIndex(item => sameDimension(item, goal)) === index));
function selectDimension(index: number, selected: number) {
  const template = dimensions.value[selected];
  if (!template || props.modelValue[index]?.sourceInstanceId !== null) return;
  emit('update:modelValue', props.modelValue.map((goal, i) => i === index ? { ...goal, indicatorType: template.indicatorType,
    dimensionName: template.dimensionName, dimensionWeight: template.dimensionWeight } : goal));
}
function beforeState(goal: GoalChangeItem) {
  const after = props.modelValue.find(item => item.sourceInstanceId !== null && item.sourceInstanceId === goal.sourceInstanceId);
  if (!after) return '已删除';
  return JSON.stringify(after) === JSON.stringify(goal) ? '未变更' : '已调整';
}
function changed(goal: GoalChangeItem, field: keyof GoalChangeItem) {
  const before = props.beforeGoals.find(item => goal.sourceInstanceId !== null && item.sourceInstanceId === goal.sourceInstanceId);
  return !before || before[field] !== goal[field];
}
const typeLabels = { kpi: 'KPI', attitude: '态度项', bonus: '加分项', penalty: '扣分项', veto: '否决项' };
</script>

<template>
  <div class="goal-diff">
    <section class="diff-column" data-testid="goal-change-before" aria-label="变更前目标">
      <h3>变更前</h3>
      <article v-for="(goal, index) in beforeGoals" :key="`${goal.sourceInstanceId}-${index}`" class="goal-item">
        <header><strong>{{ goal.name }}</strong><el-tag size="small" :type="beforeState(goal) === '已删除' ? 'danger' : 'info'">{{ beforeState(goal) }}</el-tag></header>
        <dl>
          <dt>目标描述</dt><dd>{{ goal.description || '未填写' }}</dd>
          <dt>评分标准</dt><dd>{{ goal.scoringStandard || '未填写' }}</dd>
          <dt>目标值</dt><dd>{{ goal.targetValue ?? '未填写' }} {{ goal.unit }}</dd>
          <dt>目标值说明</dt><dd>{{ goal.targetValueText || '未填写' }}</dd>
          <dt>权重</dt><dd>{{ percent(goal.weight) }}%</dd>
          <dt>类型 / 维度</dt><dd>{{ typeLabels[goal.indicatorType] }} / {{ goal.dimensionName || '未分组' }}（{{ percent(goal.dimensionWeight) }}%）</dd>
        </dl>
      </article>
      <el-empty v-if="!beforeGoals.length" description="无原目标" />
    </section>
    <section class="diff-column" data-testid="goal-change-after" aria-label="变更后目标">
      <div class="column-heading"><h3>变更后</h3><el-button v-if="editable" type="primary" link :disabled="!beforeGoals.length || modelValue.length >= 100" @click="add">添加目标</el-button></div>
      <article v-for="(goal, index) in modelValue" :key="`${goal.sourceInstanceId}-${index}`" class="goal-item">
        <header><strong>目标 {{ index + 1 }}</strong><el-tag v-if="goal.sourceInstanceId === null" size="small" type="success">新增</el-tag>
          <el-tooltip v-if="editable" content="删除目标" placement="top"><el-button :aria-label="`删除目标 ${index + 1}`" type="danger" link
            @click="emit('update:modelValue', modelValue.filter((_, i) => i !== index))"><el-icon><Delete /></el-icon></el-button></el-tooltip>
        </header>
        <el-form v-if="editable" label-position="top" @submit.prevent>
          <el-form-item v-if="goal.sourceInstanceId === null && dimensions.length > 1" label="目标维度">
            <el-select :model-value="dimensions.findIndex(item => sameDimension(item, goal))" :aria-label="`目标维度 ${index + 1}`"
              @update:model-value="selectDimension(index, Number($event))">
              <el-option v-for="(dimension, optionIndex) in dimensions" :key="optionIndex" :value="optionIndex"
                :label="`${typeLabels[dimension.indicatorType]} · ${dimension.dimensionName || '未分组'}（${percent(dimension.dimensionWeight)}%）`" />
            </el-select>
          </el-form-item>
          <el-form-item label="目标名称" :error="errors[index]?.name" required :class="{ changed: changed(goal, 'name') }">
            <el-input :model-value="goal.name" :aria-label="`目标名称 ${index + 1}`" maxlength="200" @update:model-value="update(index, 'name', $event)" />
          </el-form-item>
          <el-form-item label="目标描述" :class="{ changed: changed(goal, 'description') }"><el-input :model-value="goal.description ?? ''" :aria-label="`目标描述 ${index + 1}`" type="textarea" :rows="2" maxlength="10000" @update:model-value="update(index, 'description', $event || null)" /></el-form-item>
          <el-form-item label="评分标准" :class="{ changed: changed(goal, 'scoringStandard') }"><el-input :model-value="goal.scoringStandard ?? ''" :aria-label="`评分标准 ${index + 1}`" type="textarea" :rows="2" maxlength="10000" @update:model-value="update(index, 'scoringStandard', $event || null)" /></el-form-item>
          <div class="numeric-fields">
            <el-form-item label="目标值" :error="errors[index]?.targetValue" :class="{ changed: changed(goal, 'targetValue') }"><input type="number" step="any" :value="goal.targetValue ?? ''" :aria-label="`目标值 ${index + 1}`" @input="changeNumber(index, 'targetValue', $event)"></el-form-item>
            <el-form-item label="单位" :class="{ changed: changed(goal, 'unit') }"><el-input :model-value="goal.unit ?? ''" :aria-label="`单位 ${index + 1}`" maxlength="30" @update:model-value="update(index, 'unit', $event || null)" /></el-form-item>
          </div>
          <el-form-item label="目标值说明" :class="{ changed: changed(goal, 'targetValueText') }"><el-input :model-value="goal.targetValueText ?? ''" :aria-label="`目标值说明 ${index + 1}`" maxlength="100" @update:model-value="update(index, 'targetValueText', $event || null)" /></el-form-item>
          <el-form-item label="权重（%）" :error="errors[index]?.weight" required :class="{ changed: changed(goal, 'weight') }"><input type="number" min="0" max="100" step="0.01" :value="Number.isFinite(goal.weight) ? percent(goal.weight) : ''" :aria-label="`目标权重 ${index + 1}`" @input="changeNumber(index, 'weight', $event)"></el-form-item>
          <small>{{ typeLabels[goal.indicatorType] }} · {{ goal.dimensionName || '未分组' }} · 维度权重 {{ percent(goal.dimensionWeight) }}%</small>
        </el-form>
        <dl v-else>
          <dt>目标名称</dt><dd :class="{ changed: changed(goal, 'name') }">{{ goal.name }}</dd>
          <dt>目标描述</dt><dd :class="{ changed: changed(goal, 'description') }">{{ goal.description || '未填写' }}</dd>
          <dt>评分标准</dt><dd :class="{ changed: changed(goal, 'scoringStandard') }">{{ goal.scoringStandard || '未填写' }}</dd>
          <dt>目标值</dt><dd :class="{ changed: changed(goal, 'targetValue') || changed(goal, 'unit') }">{{ goal.targetValue ?? '未填写' }} {{ goal.unit }}</dd>
          <dt>目标值说明</dt><dd :class="{ changed: changed(goal, 'targetValueText') }">{{ goal.targetValueText || '未填写' }}</dd>
          <dt>权重</dt><dd :class="{ changed: changed(goal, 'weight') }">{{ percent(goal.weight) }}%</dd>
          <dt>类型 / 维度</dt><dd>{{ typeLabels[goal.indicatorType] }} / {{ goal.dimensionName || '未分组' }}（{{ percent(goal.dimensionWeight) }}%）</dd>
        </dl>
      </article>
      <el-empty v-if="!modelValue.length" description="无变更后目标" />
    </section>
  </div>
</template>

<style scoped>
.goal-diff { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; align-items: start; }
.diff-column { min-width: 0; }
h3 { font-size: 15px; margin: 0; line-height: 32px; }
.column-heading, header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
header { margin-bottom: 12px; }
header strong { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.goal-item { padding: 12px; margin: 8px 0 16px; border: 1px solid var(--el-border-color); border-radius: 6px; }
dl { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 10px; font-size: 13px; margin: 0; }
dt, small { color: var(--el-text-color-secondary); }
dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.changed { background: var(--el-color-warning-light-9); }
.numeric-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
input { width: 100%; min-width: 0; height: 32px; box-sizing: border-box; border: 1px solid var(--el-border-color); border-radius: 4px; padding: 0 10px; font: inherit; color: inherit; background: var(--el-bg-color); }
small { display: block; overflow-wrap: anywhere; line-height: 20px; }
@media(max-width:768px) { .goal-diff { grid-template-columns: minmax(0, 1fr); gap: 16px; } }
</style>
