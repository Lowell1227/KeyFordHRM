<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Refresh } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';
import { useTalentPermissions } from '@/views/talent/useTalentPermissions';
import { recruitmentDemandsApi } from '@/api/recruitment-demands.api';
import type { RecruitmentDemandApplication, RecruitmentDemandApplicationCategory } from '@/types/recruitment-demand.types';
import { APPLICATION_STAGE_LABELS } from '@/types/talent.types';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import { usePagination } from '@/composables/usePagination';
import { demandErrorMessage } from '../demand-presentation';
import { formatDate } from '@/utils/date';

const props = defineProps<{ demandId: string }>();
const auth = useAuthStore(), router = useRouter();
const { canRead } = useTalentPermissions();
const categories: Record<RecruitmentDemandApplicationCategory, string> = {
  awaiting_reply: '待候选人答复', accepted: '已接受待到岗', terminated: '已终止', hired: '已到岗',
};
const category = ref<RecruitmentDemandApplicationCategory>('awaiting_reply');
const rows = ref<RecruitmentDemandApplication[]>([]), loading = ref(false), error = ref('');
const { page, pageSize, total, pageSizeOptions } = usePagination({ defaultPageSize: 10, pageSizeOptions: [10, 20, 50] });
let session = 0;
async function loadList() {
  if (!canRead.value || !props.demandId) return;
  const token = ++session, demandId = props.demandId, actorId = auth.user?.id;
  loading.value = true; error.value = ''; rows.value = [];
  try {
    const result = await recruitmentDemandsApi.applications(demandId, { category: category.value, page: page.value, pageSize: pageSize.value });
    if (token !== session || demandId !== props.demandId || actorId !== auth.user?.id || !canRead.value) return;
    rows.value = result.items; total.value = result.total;
  } catch (cause) { if (token === session) { rows.value = []; total.value = 0; error.value = demandErrorMessage(cause); } }
  finally { if (token === session) loading.value = false; }
}
async function changeCategory(value: string | number) {
  if (!Object.prototype.hasOwnProperty.call(categories, value) || value === category.value) return;
  category.value = value as RecruitmentDemandApplicationCategory; page.value = 1; total.value = 0;
  await loadList();
}
function openApplication(row: RecruitmentDemandApplication) {
  if (!canRead.value || row.candidateUnavailable || !row.id || !row.candidateId) return;
  void router.push({ path: '/talents', query: { candidateId: row.candidateId, applicationId: row.id } });
}
function candidateLabel(row: RecruitmentDemandApplication) { return row.candidateUnavailable ? '资料已删除' : row.candidateName || '姓名未提供'; }
function applicationStageLabel(row: RecruitmentDemandApplication) { return row.category === 'terminated' ? '录用已终止' : APPLICATION_STAGE_LABELS[row.stage]; }
watch([() => props.demandId, () => auth.user?.id, canRead], () => {
  ++session; rows.value = []; total.value = 0; page.value = 1; category.value = 'awaiting_reply'; error.value = ''; loading.value = false;
  if (canRead.value && props.demandId) void loadList();
}, { immediate: true });
onBeforeUnmount(() => { ++session; });
</script>

<template>
  <section class="demand-applications" aria-label="需求应聘流程">
    <header><h3>应聘进展</h3><el-tooltip content="刷新应聘进展"><el-button :icon="Refresh" aria-label="刷新应聘进展" :loading="loading" :disabled="!canRead" @click="loadList" /></el-tooltip></header>
    <el-alert v-if="!canRead" title="当前无权查看招聘需求的应聘记录" type="warning" :closable="false" />
    <template v-else>
      <el-tabs :model-value="category" aria-label="应聘分类" @update:model-value="changeCategory"><el-tab-pane v-for="(label, key) in categories" :key="key" :name="key" :label="label" /></el-tabs>
      <el-alert v-if="error" :title="error" type="error" :closable="false"><el-button link type="primary" @click="loadList">重试应聘列表</el-button></el-alert>
      <div v-loading="loading" class="demand-applications__desktop">
        <el-table :data="rows" class="app-table" :empty-text="error ? '应聘列表读取失败' : '暂无该类应聘'">
          <el-table-column label="候选人" min-width="110"><template #default="{ row }"><span>{{ candidateLabel(row as RecruitmentDemandApplication) }}</span><small v-if="row.candidateUnavailable" class="unavailable-note">请联系管理员核查</small></template></el-table-column>
          <el-table-column prop="positionName" label="岗位" min-width="120" />
          <el-table-column label="经办" min-width="90"><template #default="{ row }">{{ row.ownerName || '未指定' }}</template></el-table-column>
          <el-table-column label="应聘阶段" min-width="100"><template #default="{ row }">{{ applicationStageLabel(row as RecruitmentDemandApplication) }}</template></el-table-column>
          <el-table-column label="预计到岗" width="115"><template #default="{ row }">{{ row.expectedEntryDate ? formatDate(row.expectedEntryDate) : '未填写' }}</template></el-table-column>
          <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }"><el-button link type="primary" :disabled="row.candidateUnavailable" :aria-label="`查看应聘 ${candidateLabel(row as RecruitmentDemandApplication)}`" @click="openApplication(row as RecruitmentDemandApplication)">查看应聘</el-button></template></el-table-column>
        </el-table>
      </div>
      <div v-loading="loading" class="demand-applications__mobile">
        <el-empty v-if="!loading && !rows.length && !error" description="暂无该类应聘" :image-size="40" />
        <MobileResultCard v-for="row in rows" :key="row.id">
          <template #title>{{ candidateLabel(row) }}</template><template #status><el-tag size="small">{{ applicationStageLabel(row) }}</el-tag></template>
          <dl><dt>岗位</dt><dd>{{ row.positionName }}</dd><dt>经办</dt><dd>{{ row.ownerName || '未指定' }}</dd><dt>预计到岗</dt><dd>{{ row.expectedEntryDate ? formatDate(row.expectedEntryDate) : '未填写' }}</dd></dl>
          <p v-if="row.candidateUnavailable" class="unavailable-note">请联系管理员核查</p>
          <template #actions><el-button link type="primary" :disabled="row.candidateUnavailable" :aria-label="`查看应聘 ${candidateLabel(row)}`" @click="openApplication(row)">查看应聘</el-button></template>
        </MobileResultCard>
      </div>
      <ListPagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="pageSizeOptions" :total="total" :disabled="loading" @change="loadList" />
    </template>
  </section>
</template>

<style scoped>
.demand-applications { min-width: 0; padding-top: 16px; border-top: 1px solid var(--el-border-color-lighter); }
header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
h3 { margin: 0; font-size: 14px; }
.demand-applications__desktop { min-width: 0; min-height: 120px; }
.demand-applications__mobile { display: none; }
.demand-applications :deep(.cell) { overflow-wrap: anywhere; }
dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px; margin: 0; font-size: 13px; }
dt { color: var(--el-text-color-secondary); } dd { margin: 0; overflow-wrap: anywhere; }
.unavailable-note { display: block; margin: 4px 0 0; font-size: 12px; color: var(--el-text-color-secondary); overflow-wrap: anywhere; }
@media (max-width: 768px) {
  .demand-applications__desktop { display: none; }
  .demand-applications__mobile { display: grid; min-height: 80px; gap: 10px; }
}
</style>
