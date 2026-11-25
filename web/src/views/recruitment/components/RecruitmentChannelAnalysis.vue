<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Refresh, Search } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';
import { useTalentPermissions } from '@/views/talent/useTalentPermissions';
import { recruitmentAnalyticsApi, type RecruitmentAnalyticsApplication, type RecruitmentAnalyticsMetric, type RecruitmentAnalyticsQuery, type RecruitmentChannelCounts, type RecruitmentChannelSummary } from '@/api/recruitment-lifecycle.api';
import { recruitmentDemandsApi } from '@/api/recruitment-demands.api';
import type { RecruitmentDemandView } from '@/types/recruitment-demand.types';
import { APPLICATION_STAGE_LABELS, TALENT_SOURCE_LABELS, type TalentApplicationStage, type TalentSourceChannel } from '@/types/talent.types';
import { demandErrorMessage } from '../demand-presentation';
import { formatDate } from '@/utils/date';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';

const props = defineProps<{ demandId?: string }>();
const auth = useAuthStore(), router = useRouter(), { canRead } = useTalentPermissions();
const filters = reactive({ demandId: '', source: '', from: '', to: '' });
const demands = ref<RecruitmentDemandView[]>([]), demandLoading = ref(false), directoryError = ref('');
const summary = ref<RecruitmentChannelSummary | null>(null), loading = ref(false), error = ref('');
const rows = ref<RecruitmentAnalyticsApplication[]>([]), detailLoading = ref(false), detailError = ref('');
const detailOpen = ref(false), detailLoaded = ref(false), detailTitle = ref(''), page = ref(1), total = ref(0);
let epoch = 0, summarySequence = 0, detailSequence = 0, directorySequence = 0;
let cohort: RecruitmentAnalyticsQuery = {}, detailCohort: RecruitmentAnalyticsQuery = {};
const metrics: Array<{ key: keyof RecruitmentChannelCounts; value: RecruitmentAnalyticsMetric; label: string }> = [
  { key: 'applicationCount', value: 'application', label: '应聘' }, { key: 'interviewedCount', value: 'interviewed', label: '进入面试' },
  { key: 'offeredCount', value: 'offered', label: '录用确认' }, { key: 'acceptedCount', value: 'accepted', label: '当前有效接受' },
  { key: 'hiredCount', value: 'hired', label: '实际到岗' },
];
function channelLabel(source: string | null) { return source === null ? '待确认来源' : TALENT_SOURCE_LABELS[source as TalentSourceChannel] || source; }
function stageLabel(stage: string) { return APPLICATION_STAGE_LABELS[stage as TalentApplicationStage] || stage; }
async function findDemands(keyword = '') {
  if (!canRead.value || props.demandId) return;
  const token = epoch, request = ++directorySequence;
  demandLoading.value = true; directoryError.value = '';
  try { const result = await recruitmentDemandsApi.list({ keyword: keyword || undefined, page: 1, pageSize: 20 }); if (token === epoch && request === directorySequence && canRead.value) demands.value = result.items; }
  catch (cause) { if (token === epoch && request === directorySequence) directoryError.value = demandErrorMessage(cause); }
  finally { if (token === epoch && request === directorySequence) demandLoading.value = false; }
}
function formQuery(): RecruitmentAnalyticsQuery {
  return { demandId: props.demandId || filters.demandId || undefined,
    ...(filters.source === '__unknown__' ? { unknownSource: true } : filters.source ? { sourceChannel: filters.source } : {}),
    from: filters.from || undefined, to: filters.to || undefined };
}
async function search() {
  if (!canRead.value) return;
  const token = epoch, request = ++summarySequence, input = formQuery();
  ++detailSequence; detailOpen.value = false; detailLoaded.value = false; rows.value = []; total.value = 0; summary.value = null; error.value = '';
  if (input.from && input.to && input.from > input.to) { error.value = '开始日期不能晚于结束日期'; return; }
  loading.value = true;
  try {
    const result = await recruitmentAnalyticsApi.channels(input);
    if (token !== epoch || request !== summarySequence || !canRead.value) return;
    cohort = input; summary.value = result;
  } catch (cause) { if (token === epoch && request === summarySequence) error.value = demandErrorMessage(cause); }
  finally { if (token === epoch && request === summarySequence) loading.value = false; }
}
async function loadDetails() {
  if (!canRead.value || !detailOpen.value) return;
  const token = epoch, request = ++detailSequence;
  detailLoading.value = true; detailLoaded.value = false; detailError.value = ''; rows.value = [];
  try {
    const result = await recruitmentAnalyticsApi.applications({ ...detailCohort, page: page.value, pageSize: 10 });
    if (token !== epoch || request !== detailSequence || !canRead.value) return;
    rows.value = result.items; total.value = result.total; detailLoaded.value = true;
  } catch (cause) { if (token === epoch && request === detailSequence) { total.value = 0; detailError.value = demandErrorMessage(cause); } }
  finally { if (token === epoch && request === detailSequence) detailLoading.value = false; }
}
function drilldown(source: string | null | undefined, metric: RecruitmentAnalyticsMetric, label: string) {
  if (!canRead.value || !summary.value) return;
  detailCohort = { ...cohort, ...(source !== undefined ? { sourceChannel: source ?? undefined, unknownSource: source === null ? true : undefined } : {}), metric };
  detailTitle.value = `${source === undefined ? '当前筛选汇总' : channelLabel(source)} · ${label}`;
  page.value = 1; total.value = 0; detailOpen.value = true; void loadDetails();
}
function openApplication(row: RecruitmentAnalyticsApplication) {
  if (canRead.value && !row.candidateUnavailable) void router.push({ path: '/talents', query: { candidateId: row.candidateId, applicationId: row.id } });
}
watch([() => props.demandId, () => auth.user?.id, canRead], () => {
  ++epoch; ++summarySequence; ++detailSequence; ++directorySequence; summary.value = null; rows.value = []; demands.value = [];
  error.value = ''; directoryError.value = ''; detailError.value = ''; detailOpen.value = false; detailLoaded.value = false; loading.value = false;
  detailLoading.value = false; demandLoading.value = false; filters.demandId = ''; filters.source = ''; filters.from = ''; filters.to = '';
  if (canRead.value) { void search(); void findDemands(); }
}, { immediate: true });
onBeforeUnmount(() => { ++epoch; ++summarySequence; ++detailSequence; ++directorySequence; });
</script>

<template>
  <section class="channel-analysis" aria-label="招聘渠道分析">
    <header><h3>渠道转化</h3><el-tooltip content="刷新渠道分析"><el-button :icon="Refresh" aria-label="刷新渠道分析" :loading="loading" :disabled="!canRead" @click="search" /></el-tooltip></header>
    <el-alert v-if="!canRead" title="当前无权查看招聘渠道分析" type="warning" :closable="false" />
    <template v-else>
      <el-form class="filters" label-position="top" @submit.prevent="search">
        <el-form-item v-if="!demandId" label="招聘需求" :error="directoryError"><el-select v-model="filters.demandId" clearable filterable remote :remote-method="findDemands" :loading="demandLoading" :fit-input-width="true" placeholder="全部需求" aria-label="分析招聘需求"><el-option v-for="demand in demands" :key="demand.id" :value="demand.id" :label="`${demand.departmentName || '部门待核对'} / ${demand.positionName || '岗位待核对'} · ${demand.id.slice(0, 8)}`" /></el-select></el-form-item>
        <el-form-item label="应聘来源"><el-select v-model="filters.source" clearable :fit-input-width="true" placeholder="全部来源" aria-label="分析应聘来源"><el-option label="待确认来源" value="__unknown__" /><el-option v-for="(label, source) in TALENT_SOURCE_LABELS" :key="source" :value="source" :label="label" /></el-select></el-form-item>
        <el-form-item label="登记开始日"><el-date-picker v-model="filters.from" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" aria-label="应聘登记开始日" /></el-form-item>
        <el-form-item label="登记结束日"><el-date-picker v-model="filters.to" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" aria-label="应聘登记结束日" /></el-form-item>
        <el-button type="primary" :icon="Search" :loading="loading" native-type="submit">查询</el-button>
      </el-form>
      <p class="basis">期间按北京时间的应聘登记日期；一人不同应聘分别计数。当前有效接受不含已明确终止的录用，实际到岗另列。</p>
      <el-alert v-if="error" :title="error" type="error" :closable="false"><el-button link @click="search">重试渠道统计</el-button></el-alert>
      <div v-if="loading" class="loading-state" role="status">正在读取渠道统计</div>
      <template v-if="summary">
      <div class="totals"><span v-for="metric in metrics" :key="metric.key">{{ metric.label }} <el-button link type="primary" :aria-label="`查看汇总${metric.label}`" @click="drilldown(undefined, metric.value, metric.label)">{{ summary.totals[metric.key] }}</el-button></span></div>
      <div class="desktop">
        <el-table :data="summary.items" empty-text="暂无符合条件的应聘">
          <el-table-column label="应聘来源" min-width="120"><template #default="{ row }">{{ channelLabel(row.sourceChannel) }}</template></el-table-column>
          <el-table-column v-for="metric in metrics" :key="metric.key" :label="metric.label" min-width="110" align="right"><template #default="{ row }"><el-button link type="primary" :aria-label="`查看${channelLabel(row.sourceChannel)}${metric.label}`" @click="drilldown(row.sourceChannel, metric.value, metric.label)">{{ row[metric.key] }}</el-button></template></el-table-column>
        </el-table>
      </div>
      <div class="mobile">
        <MobileResultCard v-for="row in summary.items" :key="row.sourceChannel || '__unknown__'">
          <template #title>{{ channelLabel(row.sourceChannel) }}</template>
          <dl><template v-for="metric in metrics" :key="metric.key"><dt>{{ metric.label }}</dt><dd><el-button link type="primary" :aria-label="`查看${channelLabel(row.sourceChannel)}${metric.label}`" @click="drilldown(row.sourceChannel, metric.value, metric.label)">{{ row[metric.key] }}</el-button></dd></template></dl>
        </MobileResultCard>
        <el-empty v-if="!summary.items.length" description="暂无符合条件的应聘" :image-size="40" />
      </div>
      </template>
      <section v-if="detailOpen" class="details" :aria-label="detailTitle">
        <header><h4>{{ detailTitle }}</h4><el-button link @click="detailOpen = false">收起明细</el-button></header>
        <el-alert v-if="detailError" :title="detailError" type="error" :closable="false"><el-button link @click="loadDetails">重试应聘明细</el-button></el-alert>
        <div v-if="detailLoading" class="loading-state" role="status">正在读取应聘明细</div>
        <template v-if="detailLoaded">
        <div class="desktop"><el-table :data="rows" empty-text="暂无符合条件的应聘">
          <el-table-column label="候选人" min-width="110"><template #default="{ row }">{{ row.candidateUnavailable ? '资料已删除' : row.candidateName || '姓名未提供' }}</template></el-table-column><el-table-column prop="positionName" label="岗位" min-width="130" />
          <el-table-column label="当前阶段" min-width="110"><template #default="{ row }">{{ stageLabel(row.stage) }}</template></el-table-column><el-table-column label="登记日期" width="115"><template #default="{ row }">{{ formatDate(row.createdAt) }}</template></el-table-column>
          <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }"><el-button link type="primary" :disabled="row.candidateUnavailable" @click="openApplication(row as RecruitmentAnalyticsApplication)">查看应聘</el-button></template></el-table-column>
        </el-table></div>
        <div class="mobile"><MobileResultCard v-for="row in rows" :key="row.id"><template #title>{{ row.candidateUnavailable ? '资料已删除' : row.candidateName || '姓名未提供' }}</template><dl><dt>岗位</dt><dd>{{ row.positionName }}</dd><dt>当前阶段</dt><dd>{{ stageLabel(row.stage) }}</dd><dt>登记日期</dt><dd>{{ formatDate(row.createdAt) }}</dd></dl><template #actions><el-button link type="primary" :disabled="row.candidateUnavailable" @click="openApplication(row)">查看应聘</el-button></template></MobileResultCard><el-empty v-if="!rows.length" description="暂无符合条件的应聘" :image-size="40" /></div>
        <ListPagination :current-page="page" :page-size="10" :page-sizes="[10]" :total="total" :disabled="detailLoading" @update:current-page="page = $event" @change="loadDetails" />
        </template>
      </section>
    </template>
  </section>
</template>

<style scoped>
.channel-analysis { min-width: 0; padding: 16px 0; }header { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }h3, h4 { font-size: 14px; margin: 0; }
.filters { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 12px; }.filters :deep(.el-form-item) { flex: 1 1 160px; min-width: 0; margin-bottom: 0; }.filters :deep(.el-select), .filters :deep(.el-date-editor) { width: 100%; min-width: 0; }.filters > .el-button { flex-shrink: 0; }
.basis { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }.totals { display: flex; gap: 12px 20px; flex-wrap: wrap; font-size: 13px; margin: 12px 0; }.totals .el-button { margin-left: 4px; }.loading-state { min-height: 80px; display: flex; align-items: center; color: var(--el-text-color-secondary); font-size: 13px; }
.desktop { min-width: 0; min-height: 80px; }.mobile { display: none; }.details { min-width: 0; padding-top: 16px; margin-top: 16px; border-top: 1px solid var(--el-border-color-lighter); }
dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 16px; margin: 0; font-size: 13px; }dt { color: var(--el-text-color-secondary); }dd { margin: 0; overflow-wrap: anywhere; }.channel-analysis :deep(.cell) { overflow-wrap: anywhere; }
@media (max-width: 768px) { .desktop { display: none; }.mobile { display: grid; gap: 10px; min-width: 0; }.filters :deep(.el-form-item) { flex-basis: calc(50% - 12px); }.filters > .el-button { margin-left: auto; } }
</style>
