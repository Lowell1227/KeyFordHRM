<script setup lang="ts">
import { computed } from 'vue';
type TaskView = 'mine' | 'review' | 'monitor' | 'tasks' | 'changes';
const props = withDefaults(defineProps<{
  active: TaskView; canMonitor: boolean; canSeeChanges?: boolean;
  reviewTotal?: number | null; reviewError?: boolean;
}>(), { canSeeChanges: false, reviewError: false });
const entries = computed(() => [
  { key: 'mine', label: '我的目标', to: '/tasks?goalView=mine' },
  { key: 'review', label: '目标审核', to: '/tasks?goalView=review' },
  ...(props.canMonitor ? [{ key: 'monitor', label: '目标台账', to: '/tasks?goalView=monitor' }] : []),
  { key: 'tasks', label: '绩效待办', to: '/tasks' },
  ...(props.canSeeChanges || props.active === 'changes' ? [{ key: 'changes', label: '目标变更', to: '/goal-changes' }] : []),
]);
const reviewBadge = computed(() => {
  if (props.reviewError) return { text: '!', title: '目标审核数量暂不可用' };
  if (props.reviewTotal === null) return { text: '...', title: '目标审核数量待更新' };
  if (!props.reviewTotal) return null;
  return { text: props.reviewTotal > 99 ? '99+' : String(props.reviewTotal), title: `${props.reviewTotal} 项目标待审核` };
});
</script>

<template>
  <nav class="performance-task-navigation" aria-label="绩效任务视图">
    <RouterLink v-for="entry in entries" :key="entry.key" :to="entry.to" :data-section="entry.key"
      :class="{ 'is-active': active === entry.key }" :aria-current="active === entry.key ? 'page' : undefined">
      <span>{{ entry.label }}</span>
      <span v-if="entry.key === 'review' && reviewBadge" class="review-count" :title="reviewBadge.title" aria-hidden="true">{{ reviewBadge.text }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.performance-task-navigation { display:flex; flex-wrap:wrap; flex-shrink:0; gap:4px; padding:6px 16px; min-width:0; background:#fff; border-bottom:1px solid var(--el-border-color-light); }
a { display:flex; align-items:center; justify-content:center; gap:6px; min-height:40px; padding:6px 12px; border-bottom:2px solid transparent; color:var(--el-text-color-regular); font-size:14px; line-height:20px; text-decoration:none; white-space:nowrap; }
a:hover { color:var(--el-color-primary); background:var(--el-fill-color-light); }
a.is-active { color:var(--el-color-primary); border-bottom-color:var(--el-color-primary); font-weight:600; }
a:focus-visible { outline:2px solid var(--el-color-primary); outline-offset:-2px; }
.review-count { min-width:22px; height:18px; padding:0 3px; border-radius:4px; background:var(--el-fill-color); color:var(--el-text-color-secondary); font-size:12px; line-height:18px; text-align:center; }
@media(max-width:767px) { .performance-task-navigation { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); padding:4px 8px; gap:2px; } a { min-width:0; padding:6px 2px; } }
</style>
