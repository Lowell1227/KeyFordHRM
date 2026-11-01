<script setup lang="ts">
import type { ReviewDifferenceGroup } from './employee-review-differences';
defineProps<{ groups: ReviewDifferenceGroup[] }>();
</script>

<template>
  <div class="employee-review-differences">
    <section v-for="group in groups" :key="group.key" :data-contract-key="group.kind ? group.key : undefined" :class="{ 'employee-review-contract': group.kind }">
      <h3><el-tag v-if="group.kind" :type="group.kind === '移除' ? 'danger' : group.kind === '新增' ? 'success' : 'warning'" effect="plain">{{ group.kind }}</el-tag>{{ group.title }}</h3>
      <div class="review-difference-heading" aria-hidden="true"><span>变更项目</span><span>变更前</span><span>变更后</span></div>
      <dl class="review-difference-fields">
        <div v-for="field in group.fields" :key="field.key" :data-change-key="field.key" class="review-difference-row">
          <dt>{{ field.label }}<el-tag size="small" effect="plain" :type="field.kind === '清空' || field.kind === '移除' ? 'danger' : 'info'">{{ field.kind }}</el-tag></dt>
          <dd><span class="review-difference-mobile-label">变更前</span>{{ field.before }}</dd>
          <dd><span class="review-difference-mobile-label">变更后</span>{{ field.after }}</dd>
        </div>
      </dl>
    </section>
    <el-empty v-if="!groups.length" description="暂无可展示的变更内容" :image-size="64" />
  </div>
</template>

<style scoped>
.employee-review-differences section + section { margin-top: 24px; }
.employee-review-differences h3 { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 12px; font-size: 15px; overflow-wrap: anywhere; }
.review-difference-heading, .review-difference-row { display: grid; grid-template-columns: minmax(140px, 1fr) minmax(0, 1.4fr) minmax(0, 1.4fr); }
.review-difference-heading { padding: 10px 12px; background: var(--el-fill-color-light); font-size: 13px; color: var(--el-text-color-secondary); }
.review-difference-fields { margin: 0; }
.review-difference-row { border-bottom: 1px solid var(--el-border-color-lighter); }
.review-difference-row dt, .review-difference-row dd { min-width: 0; margin: 0; padding: 11px 12px; line-height: 22px; overflow-wrap: anywhere; white-space: pre-wrap; }
.review-difference-row dt { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: flex-start; }
.review-difference-row dd { color: var(--el-text-color-regular); }
.review-difference-mobile-label { display: none; }
@media (max-width: 768px) {
  .review-difference-heading { display: none; }
  .review-difference-row { grid-template-columns: minmax(0, 1fr); padding: 8px 0; }
  .review-difference-row dt, .review-difference-row dd { padding: 4px 0; }
  .review-difference-mobile-label { display: inline-block; margin-right: 10px; color: var(--el-text-color-secondary); font-size: 12px; }
}
</style>
