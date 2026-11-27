<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Refresh } from '@element-plus/icons-vue';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import { usePagination } from '@/composables/usePagination';
import { talentRecruitmentApi, recruitmentError } from '@/api/talent-recruitment.api';
import { useAuthStore } from '@/stores/auth.store';
import { useTalentPermissions } from '@/views/talent/useTalentPermissions';
import type { RecruitmentWorkbenchItem } from '@/types/talent.types';

const route = useRoute(), router = useRouter(), auth = useAuthStore();
const { canOnboard } = useTalentPermissions();
const { page, pageSize, total, pageSizeOptions } = usePagination();
const rows = ref<RecruitmentWorkbenchItem[]>([]), loading = ref(false), error = ref('');
let session = 0;
function queryPage(value: unknown, fallback: number) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}
function readPagination() {
  const size = queryPage(route.query.handoffPageSize, 20);
  return { page: queryPage(route.query.handoffPage, 1), pageSize: pageSizeOptions.includes(size) ? size : 20 };
}
const initial = readPagination(); page.value = initial.page; pageSize.value = initial.pageSize;

async function loadList() {
  const token = ++session, actorId = auth.user?.id;
  if (!canOnboard.value || !actorId) { rows.value = []; total.value = 0; loading.value = false; error.value = ''; return; }
  loading.value = true; error.value = '';
  try {
    const result = await talentRecruitmentApi.onboardingHandoff({ page: page.value, pageSize: pageSize.value });
    if (token !== session || auth.user?.id !== actorId || !canOnboard.value) return;
    rows.value = result.items; total.value = result.total;
  } catch (cause) {
    if (token === session) { rows.value = []; total.value = 0; error.value = recruitmentError(cause); }
  } finally { if (token === session) loading.value = false; }
}
async function changePage() {
  await router.replace({ query: { ...route.query, handoffPage: String(page.value), handoffPageSize: String(pageSize.value) } });
  await loadList();
}
function openOnboarding(row: RecruitmentWorkbenchItem) {
  if (!canOnboard.value || loading.value || error.value || !row.candidateId || !row.applicationId) return;
  void router.push({ path: '/entry-exit', query: { ...route.query, tab: 'handoff',
    handoffPage: String(page.value), handoffPageSize: String(pageSize.value),
    talentId: row.candidateId, talentApplicationId: row.applicationId,
    requestId: undefined, applicationId: undefined, employeeId: undefined, assistantRequestId: undefined,
  } });
}
watch(() => [route.query.handoffPage, route.query.handoffPageSize], () => {
  const next = readPagination();
  if (page.value === next.page && pageSize.value === next.pageSize) return;
  page.value = next.page; pageSize.value = next.pageSize; void loadList();
});
watch(() => [auth.user?.id, canOnboard.value], () => { rows.value = []; total.value = 0; void loadList(); }, { immediate: true });
onBeforeUnmount(() => { ++session; });
</script>

<template>
  <section class="onboarding-handoff" data-testid="onboarding-handoff-list" :aria-busy="loading">
    <header><span>已接受录用，待人事接收</span><el-tooltip content="刷新待人事接收"><el-button :icon="Refresh" aria-label="刷新待人事接收" :loading="loading" :disabled="!canOnboard" @click="loadList" /></el-tooltip></header>
    <el-alert v-if="!canOnboard" title="当前无入职办理权限" type="error" :closable="false" />
    <el-alert v-else-if="error" :title="error" type="error" :closable="false"><el-button link type="primary" @click="loadList">重试列表</el-button></el-alert>
    <template v-else>
      <div class="desktop-result-table">
        <el-table v-loading="loading" :data="rows" height="100%" class="app-table" empty-text="暂无待接收的录用人员">
          <el-table-column prop="title" label="录用人员" min-width="160" />
          <el-table-column prop="subtitle" label="录用岗位" min-width="200" />
          <el-table-column label="预计到岗" width="140"><template #default="{ row }">{{ row.date?.slice(0, 10) || '待确认' }}</template></el-table-column>
          <el-table-column label="操作" width="110" fixed="right"><template #default="{ row }"><el-button link type="primary" :disabled="loading || !row.candidateId || !row.applicationId" @click="openOnboarding(row as RecruitmentWorkbenchItem)">办理入职</el-button></template></el-table-column>
        </el-table>
      </div>
      <div v-loading="loading" class="mobile-result-list mobile-result-list-stack">
        <el-empty v-if="!loading && !rows.length" description="暂无待接收的录用人员" />
        <MobileResultCard v-for="row in rows" :key="row.id">
          <template #title>{{ row.title }}</template>
          <template #status><el-tag size="small">待人事接收</el-tag></template>
          <dl><dt>录用岗位</dt><dd>{{ row.subtitle }}</dd><dt>预计到岗</dt><dd>{{ row.date?.slice(0, 10) || '待确认' }}</dd></dl>
          <template #actions><el-button link type="primary" :disabled="loading || !row.candidateId || !row.applicationId" @click="openOnboarding(row)">办理入职</el-button></template>
        </MobileResultCard>
      </div>
      <ListPagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="pageSizeOptions" :total="total" :disabled="loading" @change="changePage" />
    </template>
  </section>
</template>

<style scoped>
.onboarding-handoff { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; }
header span { font-size: 14px; }
.mobile-result-list-stack { gap: 10px; }
dl { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 8px 12px; margin: 0; }
dt { color: var(--el-text-color-secondary); }
dd { margin: 0; overflow-wrap: anywhere; }
</style>
