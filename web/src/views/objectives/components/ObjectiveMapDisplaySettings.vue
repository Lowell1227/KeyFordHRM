<script setup lang="ts">
import { Sort, View } from '@element-plus/icons-vue';
import type { ObjectiveMapDisplayOptions } from '../objective-map-settings';

const props = defineProps<{ modelValue: ObjectiveMapDisplayOptions }>();

const emit = defineEmits<{
  'update:modelValue': [value: ObjectiveMapDisplayOptions];
}>();

function updateOption(key: keyof ObjectiveMapDisplayOptions, value: unknown) {
  emit('update:modelValue', { ...props.modelValue, [key]: Boolean(value) });
}
</script>

<template>
  <div class="objective-map-display-settings">
    <span class="objective-map-display-settings__sort">
      <el-icon aria-hidden="true"><Sort /></el-icon>
      排序：按对齐数量
    </span>
    <span class="objective-map-display-settings__divider" aria-hidden="true" />
    <el-popover placement="bottom-end" :width="214" trigger="click">
      <template #reference>
        <button
          type="button"
          data-testid="objective-map-display-settings"
          class="objective-map-display-settings__trigger"
        >
          <el-icon aria-hidden="true"><View /></el-icon>
          显示设置
        </button>
      </template>
      <div class="objective-map-display-settings__panel">
        <el-checkbox
          :model-value="modelValue.showCompany"
          @change="updateOption('showCompany', $event)"
        >显示公司或上级目标</el-checkbox>
        <el-checkbox
          :model-value="modelValue.showDepartment"
          @change="updateOption('showDepartment', $event)"
        >显示部门目标</el-checkbox>
        <el-checkbox
          :model-value="modelValue.showOwner"
          @change="updateOption('showOwner', $event)"
        >显示负责人</el-checkbox>
        <el-checkbox
          :model-value="modelValue.showProgress"
          @change="updateOption('showProgress', $event)"
        >显示进度</el-checkbox>
        <el-checkbox
          :model-value="modelValue.showConnections"
          @change="updateOption('showConnections', $event)"
        >显示连接线</el-checkbox>
      </div>
    </el-popover>
  </div>
</template>

<style scoped>
.objective-map-display-settings {
  min-height: 48px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  color: #778299;
  background: #fff;
  border: 1px solid #e7ebf2;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgb(35 55 88 / 10%);
  font-size: 14px;
  white-space: nowrap;
}

.objective-map-display-settings__sort,
.objective-map-display-settings__trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.objective-map-display-settings__divider {
  width: 1px;
  height: 18px;
  margin: 0 10px;
  background: #e3e7ee;
}

.objective-map-display-settings__trigger {
  min-height: 34px;
  padding: 0;
  border: 0;
  color: #3a465c;
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.objective-map-display-settings__trigger:hover {
  color: #1f66d9;
}

.objective-map-display-settings__trigger:focus-visible {
  outline: 2px solid #195dcc;
  outline-offset: 3px;
}

.objective-map-display-settings__panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.objective-map-display-settings__panel :deep(.el-checkbox) {
  margin-right: 0;
}
</style>
