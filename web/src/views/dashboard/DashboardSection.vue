<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowDown, ArrowRight, Refresh } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';

const props = withDefaults(defineProps<{
  sectionId: string; title: string; count: number | null; loading?: boolean; error?: string;
}>(), { loading: false, error: '' });
defineEmits<{ refresh: [] }>();
const auth = useAuthStore();
const expanded = ref(false);
const sectionOrder = ref(1);
let initialized = false;
const bodyId = computed(() => `workbench-${props.sectionId}`);
const storageKey = computed(() => auth.user?.id
  ? `hrm.workbench.fold.v1:${encodeURIComponent(auth.user.id)}:${props.sectionId}` : '');
const countText = computed(() => props.count === null ? (props.error ? '暂不可用' : '待更新') : `${props.count} 项`);

function initialize() {
  if (initialized || props.loading || (props.count === null && !props.error)) return;
  expanded.value = Boolean(props.error) || (props.count ?? 0) > 0;
  initialized = true;
}
watch(storageKey, () => {
  initialized = false; expanded.value = false;
  try {
    const saved = storageKey.value && typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey.value) : null;
    if (saved === 'open' || saved === 'closed') { expanded.value = saved === 'open'; initialized = true; }
  } catch { /* Preferences are optional; blocked browser storage must not block work. */ }
  initialize();
}, { immediate: true });
watch(() => [props.count, props.loading, props.error], () => {
  if (props.loading || (props.count === null && !props.error)) return;
  sectionOrder.value = props.error || (props.count ?? 0) > 0 ? 0 : 1;
  initialize();
}, { immediate: true });
function toggle() {
  expanded.value = !expanded.value; initialized = true;
  try {
    if (storageKey.value && typeof localStorage !== 'undefined') localStorage.setItem(storageKey.value, expanded.value ? 'open' : 'closed');
  } catch { /* Keep the current in-memory preference when storage is unavailable. */ }
}
</script>

<template>
  <section class="workbench-section" :aria-label="title" :aria-busy="loading" :style="{ order: sectionOrder }">
    <header class="workbench-section__header">
      <button class="workbench-section__toggle" type="button" :aria-expanded="expanded" :aria-controls="bodyId" @click="toggle">
        <el-icon><ArrowDown v-if="expanded"/><ArrowRight v-else/></el-icon>
        <h2>{{ title }}</h2><span class="workbench-section__count">{{ countText }}</span>
      </button>
      <el-tooltip :content="`刷新${title}`"><el-button :icon="Refresh" text circle :aria-label="`刷新${title}`" :loading="loading" @click="$emit('refresh')"/></el-tooltip>
    </header>
    <div v-if="error" class="workbench-section__error" role="alert">
      <span>{{ error }}</span><el-button link type="primary" :loading="loading" @click="$emit('refresh')">重试</el-button>
    </div>
    <div v-show="expanded" :id="bodyId" class="workbench-section__body"><slot/></div>
  </section>
</template>

<style scoped>
.workbench-section { min-width: 0; border-bottom: 1px solid var(--el-border-color-light); }
.workbench-section__header { display:flex; align-items:center; gap:12px; min-height:52px; }
.workbench-section__toggle { flex:1; display:flex; align-items:center; gap:10px; min-width:0; padding:10px 0; border:0; background:transparent; color:var(--el-text-color-primary); font:inherit; text-align:left; cursor:pointer; }
.workbench-section__toggle:focus-visible { outline:2px solid var(--el-color-primary); outline-offset:2px; }
h2 { margin:0; font-size:16px; line-height:1.5; overflow-wrap:anywhere; }
.workbench-section__count { margin-left:auto; white-space:nowrap; color:var(--el-text-color-secondary); font-size:13px; }
.workbench-section__body { padding:0 0 16px; min-width:0; }
.workbench-section__error { display:flex; align-items:center; gap:12px; padding:0 0 12px 24px; color:var(--el-color-danger); font-size:13px; overflow-wrap:anywhere; }
:deep(.workbench-items) { list-style:none; margin:0; padding:0; }
:deep(.workbench-row) { display:flex; align-items:center; gap:12px; width:100%; min-height:48px; padding:10px 4px; border:0; border-bottom:1px solid var(--el-border-color-lighter); background:transparent; color:var(--el-text-color-primary); text-align:left; font:inherit; cursor:pointer; }
:deep(.workbench-row:hover) { background:var(--el-fill-color-light); }
:deep(.workbench-row__body) { min-width:0; flex:1; overflow-wrap:anywhere; }
:deep(.workbench-row__body strong) { display:block; font-size:14px; }
:deep(.workbench-row small), :deep(.workbench-row time) { color:var(--el-text-color-secondary); font-size:13px; }
@media(max-width:767px) { :deep(.workbench-row) { gap:8px; } :deep(.workbench-row time) { max-width:65px; } }
</style>
