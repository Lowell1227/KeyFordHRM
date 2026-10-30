<script setup lang="ts">
import { computed, markRaw, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth.store';
import ContractSubjectManageView from './ContractSubjectManageView.vue';
import PersonnelReferenceManageView from './PersonnelReferenceManageView.vue';
import PositionDirectoryView from './PositionDirectoryView.vue';
import { canReadPersonnelReferenceData } from '@/utils/personnel-reference-permissions';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const buttons = ref<HTMLButtonElement[]>([]);
const choices = [
  { key: 'contract-subjects', label: '合同主体', component: markRaw(ContractSubjectManageView), kind: 'work_location' as const },
  { key: 'work-locations', label: '工作地点', component: markRaw(PersonnelReferenceManageView), kind: 'work_location' as const },
  { key: 'job-families', label: '职系', component: markRaw(PersonnelReferenceManageView), kind: 'job_family' as const },
  { key: 'positions', label: '岗位', component: markRaw(PositionDirectoryView), kind: 'job_family' as const },
];
const tabs = computed(() => choices.filter(item => canReadPersonnelReferenceData(auth.user, item.kind)));
const active = computed(() => tabs.value.find(item => item.key === route.query.tab) ?? tabs.value[0]);
watch([() => route.query.tab, () => active.value?.key], () => {
  const key = active.value?.key;
  if (key && route.query.tab !== key) void router.replace({ path: '/basic-data', query: { ...route.query, tab: key } });
}, { immediate: true });
async function activate(key: string) {
  if (active.value?.key !== key) await router.push({ path: '/basic-data', query: { ...route.query, tab: key } });
}
async function moveTab(event: KeyboardEvent, index: number) {
  const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (!offset && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.value.length - 1 : (index + offset + tabs.value.length) % tabs.value.length;
  await activate(tabs.value[target]!.key);
  await nextTick();
  buttons.value[target]?.focus();
  buttons.value[target]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
</script>

<template>
  <section class="basic-data">
    <nav class="basic-data__tabs" role="tablist" aria-label="基础资料分类">
      <button v-for="(tab, index) in tabs" :id="`basic-data-tab-${tab.key}`" :key="tab.key" ref="buttons"
        type="button" role="tab" :aria-selected="active?.key === tab.key" aria-controls="basic-data-panel"
        :tabindex="active?.key === tab.key ? 0 : -1" @click="activate(tab.key)" @keydown="moveTab($event, index)">
        {{ tab.label }}
      </button>
    </nav>
    <div id="basic-data-panel" class="basic-data__panel" role="tabpanel" :aria-labelledby="active ? `basic-data-tab-${active.key}` : undefined">
      <KeepAlive><component :is="active.component" v-if="active" :key="active.key" :kind="active.kind" :compact="true" /></KeepAlive>
      <el-empty v-if="!active" description="暂无可查看的基础资料" />
    </div>
  </section>
</template>

<style scoped>
.basic-data { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; gap: 14px; }
.basic-data__tabs { display: flex; flex: 0 0 auto; gap: 24px; border-bottom: 1px solid var(--el-border-color-light); overflow-x: auto; scrollbar-width: none; }
.basic-data__tabs button { flex: 0 0 auto; padding: 3px 2px 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--el-text-color-regular); font: inherit; cursor: pointer; white-space: nowrap; }
.basic-data__tabs button[aria-selected="true"] { color: var(--el-color-primary); border-bottom-color: var(--el-color-primary); font-weight: 600; }
.basic-data__tabs button:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; border-radius: 3px; }
.basic-data__panel { flex: 1 1 auto; display: flex; min-height: 0; min-width: 0; }
.basic-data__panel > :deep(*) { width: 100%; min-width: 0; }
@media (max-width: 768px) { .basic-data { gap: 10px; } .basic-data__tabs { gap: 20px; } .basic-data__tabs button { padding-bottom: 10px; } }
</style>
