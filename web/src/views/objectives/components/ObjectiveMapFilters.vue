<script setup lang="ts">
import { Calendar } from '@element-plus/icons-vue';
import type { AssessmentCycle } from '@/types/api.types';
import type { ObjectiveMapScope } from '../objective-map-layout';

const props = defineProps<{
  cycles: AssessmentCycle[];
  cycleId: string;
  scope: ObjectiveMapScope;
  scopeCounts: Record<ObjectiveMapScope, number>;
  reviewOnly: boolean;
  reviewCount: number;
}>();

const emit = defineEmits<{
  'update:cycleId': [value: string];
  'update:scope': [value: ObjectiveMapScope];
  'update:reviewOnly': [value: boolean];
}>();

const scopes: Array<{ key: ObjectiveMapScope; label: string }> = [
  { key: 'mine', label: '我的目标' },
  { key: 'team', label: '下属目标' },
  { key: 'organization', label: '我负责组织的目标' },
  { key: 'other', label: '其他目标' },
];
</script>

<template>
  <div data-testid="objective-map-filters" class="objective-map-filters">
    <div class="objective-map-filters__cycle">
      <el-icon aria-hidden="true"><Calendar /></el-icon>
      <span class="objective-map-filters__cycle-label">周期：</span>
      <el-select
        :model-value="cycleId"
        data-testid="objective-map-cycle"
        aria-label="目标周期"
        :placeholder="cycles.length ? '选择考核周期' : '暂无考核周期'"
        :disabled="cycles.length === 0"
        class="objective-map-filters__cycle-select"
        @update:model-value="emit('update:cycleId', String($event ?? ''))"
      >
        <el-option v-if="cycles.length === 0" label="暂无考核周期" value="" disabled />
        <el-option v-for="cycle in cycles" :key="cycle.id" :label="cycle.name" :value="cycle.id" />
      </el-select>
    </div>

    <span class="objective-map-filters__divider" aria-hidden="true" />

    <button
      v-for="item in scopes"
      :key="item.key"
      type="button"
      class="objective-map-filters__scope"
      :class="{ 'is-active': scope === item.key }"
      :data-testid="`objective-map-scope-${item.key}`"
      :aria-pressed="scope === item.key"
      :disabled="scope !== item.key && props.scopeCounts[item.key] === 0"
      @click="emit('update:scope', item.key)"
    >
      {{ item.label }}
    </button>

    <span class="objective-map-filters__divider" aria-hidden="true" />

    <button
      type="button"
      data-testid="objective-map-review-only"
      class="objective-map-filters__review"
      :class="{ 'is-active': reviewOnly }"
      :aria-pressed="reviewOnly"
      @click="emit('update:reviewOnly', !reviewOnly)"
    >
      待我审核 {{ reviewCount }}
    </button>
  </div>
</template>

<style scoped>
.objective-map-filters {
  min-width: max-content;
  min-height: 48px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  color: #28334a;
  background: #fff;
  border: 1px solid #e7ebf2;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgb(35 55 88 / 10%);
}

.objective-map-filters__cycle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  font-weight: 600;
}

.objective-map-filters__cycle .el-icon {
  margin-right: 3px;
  color: #24314b;
  font-size: 17px;
}

.objective-map-filters__cycle-label {
  flex-shrink: 0;
}

.objective-map-filters__cycle-select {
  width: 166px;
}

.objective-map-filters__cycle-select :deep(.el-select__wrapper) {
  min-height: 32px;
  padding: 4px 8px;
  background: transparent;
  box-shadow: none;
}

.objective-map-filters__divider {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: #e2e7f0;
}

.objective-map-filters__scope {
  min-height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  color: #3b465c;
  background: #f5f7fb;
  font: inherit;
  font-size: 14px;
  white-space: nowrap;
  cursor: pointer;
}

.objective-map-filters__scope:hover:not(:disabled) {
  color: #1e63d8;
  background: #edf4ff;
}

.objective-map-filters__scope.is-active {
  color: #fff;
  background: #2f7df4;
}

.objective-map-filters__scope:disabled {
  color: #aeb6c5;
  cursor: not-allowed;
}

.objective-map-filters__scope:focus-visible {
  outline: 2px solid #195dcc;
  outline-offset: 2px;
}

.objective-map-filters__review {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid #f0c36c;
  border-radius: 6px;
  color: #9a6400;
  background: #fff9ec;
  font: inherit;
  font-size: 14px;
  white-space: nowrap;
  cursor: pointer;
}

.objective-map-filters__review:hover,
.objective-map-filters__review.is-active {
  color: #fff;
  background: #d99016;
  border-color: #d99016;
}

.objective-map-filters__review:focus-visible {
  outline: 2px solid #a96700;
  outline-offset: 2px;
}

@media (max-width: 1360px) {
  .objective-map-filters {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    justify-content: flex-start;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-inline: contain;
  }
}
</style>
