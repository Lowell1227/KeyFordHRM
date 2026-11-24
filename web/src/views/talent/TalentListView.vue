<script setup lang="ts">
import { computed, ref, reactive, onMounted, onBeforeUnmount, watch } from 'vue';
import { onBeforeRouteUpdate, useRoute } from 'vue-router';
import { Delete } from '@element-plus/icons-vue';
import { talentPoolApi } from '@/api/talent-pool.api';
import { usePagination } from '@/composables/usePagination';
import { useExport } from '@/composables/useExport';
import { useAuthStore } from '@/stores/auth.store';
import {
  TALENT_STATUSES,
  TALENT_STATUS_LABELS,
  TALENT_STATUS_TAG,
  TALENT_EMPLOYMENT_STATUS_LABELS,
  TALENT_SOURCE_CHANNELS,
  TALENT_SOURCE_LABELS,
  TALENT_TAGS,
  TALENT_TAG_LABELS,
  EDUCATION_LABELS,
  APPLICATION_STAGE_LABELS,
  type TalentCandidateListItem,
  type TalentSourceChannel,
  type TalentStatus,
  type TalentTag,
  type TalentQuery,
  type TalentApplicationStage,
  type TalentApplicationMatch,
} from '@/types/talent.types';
import { formatDate } from '@/utils/date';
import { formatFollowUpDate } from '@/utils/talent-follow-up-date';
import { formatTalentSalary } from '@/utils/talent-salary';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import TalentDetailDrawer from './components/TalentDetailDrawer.vue';
import TalentFormDrawer from './components/TalentFormDrawer.vue';
import TalentDeleteDialog from './components/TalentDeleteDialog.vue';
import { useTalentPermissions } from './useTalentPermissions';

const { canEdit, canExport } = useTalentPermissions();
const auth = useAuthStore();
const route = useRoute();

const list = ref<TalentCandidateListItem[]>([]);
const loading = ref(false);
const loadError = ref('');
const deepLinkError = ref('');
const exportError = ref(''), positionsError = ref(''), applicationPositions = ref<string[]>([]);
const { loading: exporting, download } = useExport();
const detailVisible = ref(false);
const formVisible = ref(false);
const formDrawer = ref<InstanceType<typeof TalentFormDrawer>>();
const activeCandidateId = ref<string | null>(null);
const selectedIds = ref<string[]>([]);
const deleteVisible = ref(false);
const deleteTargets = ref<Array<{ id: string; name: string }>>([]);
const allSelected = computed(() => list.value.length > 0 && list.value.every(item => selectedIds.value.includes(item.id)));
const applicationFilters = ref<Omit<TalentApplicationMatch, 'id'>>({});
const hasApplicationFilter = computed(() => Object.values(applicationFilters.value).some(Boolean));
const activeApplicationMatch = ref<TalentApplicationMatch>();
const filters = reactive({
  keyword: '',
  status: '' as TalentStatus | '',
  source: '' as TalentSourceChannel | '',
  tag: '' as TalentTag | '',
  applicationPosition: '',
  applicationStage: '' as TalentApplicationStage | '',
  salaryMin: undefined as number | undefined,
  salaryMax: undefined as number | undefined,
  dueOnly: false,
  staleOnly: false,
  responsibilityScope: 'all' as NonNullable<TalentQuery['responsibilityScope']>,
});
const { page, pageSize, total, pageSizeOptions, reset, withParams } = usePagination({ defaultPageSize: 20 });
let requestId = 0;
onBeforeUnmount(() => { ++requestId; });

onMounted(() => {
  void loadApplicationPositions();
});
watch([() => route.query.responsibilityScope, () => route.query.dueOnly, () => route.query.applicationStage], ([scope, dueOnly, stage]) => {
  filters.responsibilityScope = scope === 'talent' || scope === 'application' ? scope : 'all';
  filters.dueOnly = dueOnly === 'true';
  filters.applicationStage = stage === 'accepted' ? stage : '';
  reset(); void loadList();
}, { immediate: true });

function currentFilters(): TalentQuery {
  return {
    keyword: filters.keyword.trim() || undefined, status: filters.status || undefined, source: filters.source || undefined,
    tag: filters.tag || undefined, applicationPosition: filters.applicationPosition || undefined, applicationStage: filters.applicationStage || undefined,
    salaryMinYuan: filters.salaryMin, salaryMaxYuan: filters.salaryMax,
    dueOnly: filters.dueOnly || undefined, staleOnly: filters.staleOnly || undefined,
    responsibilityScope: filters.responsibilityScope === 'all' ? undefined : filters.responsibilityScope,
  };
}
async function loadApplicationPositions() {
  positionsError.value = '';
  try { applicationPositions.value = await talentPoolApi.applicationPositions(); }
  catch { positionsError.value = '应聘岗位选项读取失败'; }
}
async function exportApplications() {
  if (!canExport.value || exporting.value) return;
  exportError.value = '';
  try { await download(() => talentPoolApi.exportApplications(currentFilters()), `人才应聘记录-${new Date().toISOString().slice(0, 10)}.xlsx`); }
  catch (cause) { exportError.value = cause instanceof Error ? cause.message : '导出失败，请重试'; }
}

async function loadList() {
  const id = ++requestId;
  selectedIds.value = [];
  loading.value = true;
  loadError.value = '';
  try {
    const query = currentFilters();
    const applicationOwnerId = query.responsibilityScope === 'application' ? auth.user?.id : undefined;
    const res = await talentPoolApi.list(withParams({ ...query }));
    if (id !== requestId) return;
    applicationFilters.value = { applicationPosition: query.applicationPosition, applicationStage: query.applicationStage, applicationOwnerId };
    list.value = res.items;
    total.value = res.total;
    if (!res.items.length && page.value > 1) {
      page.value = Math.max(1, Math.ceil(res.total / pageSize.value));
      void loadList();
    }
  } catch {
    if (id !== requestId) return;
    list.value = [];
    total.value = 0;
    loadError.value = '人才库列表暂时无法读取，请重试';
  } finally {
    if (id === requestId) loading.value = false;
  }
}

function onSearch() { reset(); void loadList(); }
function openCreate() {
  if (!canEdit.value) return;
  activeCandidateId.value = null;
  formVisible.value = true;
}
function openDetail(id: string, applicationId?: string) {
  activeCandidateId.value = id;
  activeApplicationMatch.value = applicationId && hasApplicationFilter.value ? { id: applicationId, ...applicationFilters.value } : undefined;
  detailVisible.value = true;
}
function openRow(row: TalentCandidateListItem) {
  openDetail(row.id, row.latestApplication?.id);
}
onBeforeRouteUpdate(async (to, from) => {
  if ((to.query.candidateId !== from.query.candidateId || to.query.applicationId !== from.query.applicationId)
    && formVisible.value && !await formDrawer.value?.prepareToLeave()) return false;
});
watch([() => route.query.candidateId, () => route.query.applicationId], ([candidateId, applicationId]) => {
  formVisible.value = false;
  deepLinkError.value = '';
  if (candidateId === undefined && applicationId === undefined) { detailVisible.value = false; return; }
  if (typeof candidateId !== 'string' || !candidateId.trim()
    || (applicationId !== undefined && (typeof applicationId !== 'string' || !applicationId.trim()))) {
    detailVisible.value = false; activeCandidateId.value = null; activeApplicationMatch.value = undefined;
    deepLinkError.value = '人才或应聘链接不完整，请从列表重新选择。';
    return;
  }
  activeCandidateId.value = candidateId;
  activeApplicationMatch.value = typeof applicationId === 'string' && applicationId ? { id: applicationId } : undefined;
  detailVisible.value = true;
}, { immediate: true });
function openEdit(id: string) {
  if (!canEdit.value) return;
  activeCandidateId.value = id;
  detailVisible.value = false;
  formVisible.value = true;
}
function onSaved() { void loadList(); }
function onRemoved() { void loadList(); }
function toggleSelected(id: string) {
  if (!canEdit.value || loading.value) return;
  selectedIds.value = selectedIds.value.includes(id) ? selectedIds.value.filter(value => value !== id) : [...selectedIds.value, id];
}
function toggleAll() {
  if (!canEdit.value || loading.value) return;
  selectedIds.value = allSelected.value ? [] : list.value.map(item => item.id);
}
function openDelete(rows: Array<{ id: string; name: string }>) {
  if (!canEdit.value || loading.value || !rows.length) return;
  deleteTargets.value = rows.map(({ id, name }) => ({ id, name }));
  deleteVisible.value = true;
}
function onReset() {
  Object.assign(filters, {
    keyword: '', status: '', source: '', tag: '', applicationPosition: '', applicationStage: '',
    salaryMin: undefined, salaryMax: undefined, dueOnly: false, staleOnly: false, responsibilityScope: 'all',
  });
  onSearch();
}

function formatSalary(row: TalentCandidateListItem): string {
  return formatTalentSalary(row, '—');
}

function formatExperience(years: number | null): string {
  return years == null ? '—' : `${years}年`;
}

function asRow(row: unknown): TalentCandidateListItem {
  return row as TalentCandidateListItem;
}

function nextFollowUpLabel(row: TalentCandidateListItem) {
  if (row.nextFollowUpAt) return formatFollowUpDate(row.nextFollowUpAt);
  return row.lastFollowUpAt ? '暂无安排' : '未跟进';
}

const EMPTY_TEXT = '还没有人才记录。点「新增人才」开始，纸质简历可以直接拍照上传。';
</script>

<template>
  <BusinessListPage variant="record" :loading="loading" class="talent-list">
    <template #primary-action>
      <el-button v-if="canEdit" type="primary" @click="openCreate">新增人才</el-button>
      <el-button v-if="canExport" :loading="exporting" :disabled="loading" @click="exportApplications">导出应聘记录</el-button>
    </template>
    <template #filters>
      <div class="talent-filter-bar">
        <el-input v-model="filters.keyword" class="talent-filter-bar__keyword" clearable placeholder="姓名 / 手机 / 公司 / 职位"
          @keyup.enter="onSearch" @clear="onSearch" />
        <el-select v-model="filters.applicationPosition" aria-label="应聘岗位（含历史）" data-testid="talent-filter-application-position" class="talent-filter-bar__select" clearable filterable placeholder="应聘岗位" @change="onSearch">
          <el-option v-for="position in applicationPositions" :key="position" :label="position" :value="position" />
        </el-select>
        <el-select v-model="filters.applicationStage" aria-label="应聘阶段" data-testid="talent-filter-application-stage" class="talent-filter-bar__select" clearable placeholder="应聘阶段" @change="onSearch">
          <el-option v-for="(label, stage) in APPLICATION_STAGE_LABELS" :key="stage" :label="label" :value="stage" />
        </el-select>
        <el-select v-model="filters.status" aria-label="人才库状态" data-testid="talent-filter-status" class="talent-filter-bar__select" clearable placeholder="人才库状态" @change="onSearch">
          <el-option v-for="s in TALENT_STATUSES" :key="s" :label="TALENT_STATUS_LABELS[s]" :value="s" />
        </el-select>
        <el-select v-model="filters.source" data-testid="talent-filter-source" class="talent-filter-bar__select" clearable placeholder="来源" @change="onSearch">
          <el-option v-for="s in TALENT_SOURCE_CHANNELS" :key="s" :label="TALENT_SOURCE_LABELS[s]" :value="s" />
        </el-select>
        <el-select v-model="filters.tag" data-testid="talent-filter-tag" class="talent-filter-bar__select" clearable placeholder="标签" @change="onSearch">
          <el-option v-for="t in TALENT_TAGS" :key="t" :label="TALENT_TAG_LABELS[t]" :value="t" />
        </el-select>
        <div class="talent-filter-bar__salary">
          <el-input-number v-model="filters.salaryMin" :controls="false" placeholder="最低元/月"
            @change="onSearch" />
          <span class="talent-filter-bar__salary-sep">–</span>
          <el-input-number v-model="filters.salaryMax" :controls="false" placeholder="最高元/月"
            @change="onSearch" />
        </div>
        <el-select v-model="filters.responsibilityScope" aria-label="负责范围"
          class="talent-filter-bar__select talent-filter-bar__scope" @change="onSearch">
          <el-option label="全部" value="all" />
          <el-option label="我负责的人才" value="talent" />
          <el-option label="我负责的应聘" value="application" />
        </el-select>
        <div class="talent-filter-bar__switches">
          <span class="talent-filter-toggle"><el-switch v-model="filters.dueOnly" aria-label="仅看待跟进" @change="onSearch" /> 仅看待跟进</span>
          <span class="talent-filter-toggle"><el-switch v-model="filters.staleOnly" aria-label="超18个月未联系" @change="onSearch" /> 超18个月未联系</span>
        </div>
        <el-button @click="onReset">重置</el-button>
      </div>
    </template>

    <template #feedback>
      <el-alert v-if="deepLinkError" :title="deepLinkError" type="error" :closable="false" />
      <el-alert v-if="exportError" :title="exportError" type="error" :closable="false" />
      <el-alert v-if="positionsError" :title="positionsError" type="error" :closable="false"><el-button link type="primary" @click="loadApplicationPositions">重试岗位选项</el-button></el-alert>
      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false">
        <el-button link type="primary" @click="loadList">重试</el-button>
      </el-alert>
      <div v-if="canEdit" class="talent-list__selection">
        <el-checkbox :model-value="allSelected" :indeterminate="selectedIds.length > 0 && !allSelected"
          :disabled="loading || !list.length" aria-label="全选本页" @change="toggleAll">全选本页</el-checkbox>
        <span v-if="selectedIds.length">已选 {{ selectedIds.length }} 项</span>
        <el-button type="danger" plain :icon="Delete" :disabled="loading || !selectedIds.length"
          @click="openDelete(list.filter(item => selectedIds.includes(item.id)))">批量删除</el-button>
      </div>
    </template>

    <template #desktop-list>
      <el-table v-loading="loading" class="app-table" :data="list" height="100%" :empty-text="EMPTY_TEXT"
        @row-click="(row: unknown) => openRow(asRow(row))">
        <el-table-column v-if="canEdit" width="44" fixed>
          <template #default="{ row }">
            <el-checkbox :model-value="selectedIds.includes(row.id)" :aria-label="`选择${row.name}`"
              :disabled="loading" @click.stop @change="toggleSelected(row.id)" />
          </template>
        </el-table-column>
        <el-table-column label="姓名" min-width="110" fixed>
          <template #default="{ row }">
            <div class="talent-name-cell">
              <span>{{ row.name }}</span>
              <span v-if="asRow(row).fileCount > 0" class="talent-name-cell__files">简历×{{ asRow(row).fileCount }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="phone" label="手机" width="120" />
        <el-table-column prop="ownerName" label="人才负责人" min-width="110" show-overflow-tooltip><template #default="{ row }">{{ asRow(row).ownerName || '未指定' }}</template></el-table-column>
        <el-table-column :label="hasApplicationFilter ? '匹配应聘' : '最新应聘'" min-width="180" show-overflow-tooltip><template #default="{ row }"><span v-if="asRow(row).latestApplication">{{ asRow(row).latestApplication?.positionName }} · {{ APPLICATION_STAGE_LABELS[asRow(row).latestApplication!.stage] }}</span><span v-else>暂无应聘</span></template></el-table-column>
        <el-table-column prop="appliedPosition" label="意向岗位" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.appliedPosition || '—' }}</template>
        </el-table-column>
        <el-table-column label="当前公司 · 职位" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            {{ [asRow(row).currentCompany, asRow(row).currentPosition].filter(Boolean).join(' · ') || '—' }}
          </template>
        </el-table-column>
        <el-table-column label="年限" width="80">
          <template #default="{ row }">{{ formatExperience(asRow(row).yearsOfExperience) }}</template>
        </el-table-column>
        <el-table-column label="学历" width="100">
          <template #default="{ row }">
            {{ row.education ? EDUCATION_LABELS[asRow(row).education as keyof typeof EDUCATION_LABELS] ?? row.education : '—' }}
          </template>
        </el-table-column>
        <el-table-column label="期望薪资" width="110">
          <template #default="{ row }">{{ formatSalary(asRow(row)) }}</template>
        </el-table-column>
        <el-table-column label="来源" width="100">
          <template #default="{ row }">{{ TALENT_SOURCE_LABELS[asRow(row).sourceChannel] }}</template>
        </el-table-column>
        <el-table-column label="人才库状态" width="110">
          <template #default="{ row }">
            <div class="talent-status-cell">
            <el-tag :type="TALENT_STATUS_TAG[asRow(row).status].type" :effect="TALENT_STATUS_TAG[asRow(row).status].effect ?? 'light'" size="small">
              {{ TALENT_STATUS_LABELS[asRow(row).status] }}
            </el-tag>
            <el-tag v-if="asRow(row).employmentStatus" size="small" type="info">员工{{ TALENT_EMPLOYMENT_STATUS_LABELS[asRow(row).employmentStatus!] }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="下次跟进" width="110">
          <template #default="{ row }">{{ nextFollowUpLabel(asRow(row)) }}</template>
        </el-table-column>
        <el-table-column label="更新时间" width="110">
          <template #default="{ row }">{{ formatDate(asRow(row).updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" :width="canEdit ? 164 : 70" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="openRow(asRow(row))">打开</el-button>
            <el-button v-if="canEdit" link type="primary" @click.stop="openEdit(asRow(row).id)">编辑</el-button>
            <el-button v-if="canEdit" link type="danger" :disabled="loading" @click.stop="openDelete([asRow(row)])">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <template #mobile-list>
      <el-empty v-if="!loading && !list.length && !loadError" :description="EMPTY_TEXT" />
      <MobileResultCard v-for="item in list" :key="item.id">
        <template #title>
          <div class="talent-list__mobile-name">
            <el-checkbox v-if="canEdit" :model-value="selectedIds.includes(item.id)" :aria-label="`选择${item.name}`"
              :disabled="loading" @change="toggleSelected(item.id)" />
            <span>{{ item.name }}</span>
          </div>
        </template>
        <template #status>
          <el-tag :type="TALENT_STATUS_TAG[item.status].type" :effect="TALENT_STATUS_TAG[item.status].effect ?? 'light'" size="small">
            {{ TALENT_STATUS_LABELS[item.status] }}
          </el-tag>
          <el-tag v-if="item.employmentStatus" size="small" type="info">员工{{ TALENT_EMPLOYMENT_STATUS_LABELS[item.employmentStatus] }}</el-tag>
        </template>
        <div v-for="field in [
          ['岗位', item.appliedPosition || item.currentPosition || '—'],
          ['手机', item.phone],
          ['人才负责人', item.ownerName || '未指定'],
          [hasApplicationFilter ? '匹配应聘' : '最新应聘', item.latestApplication ? `${item.latestApplication.positionName} · ${APPLICATION_STAGE_LABELS[item.latestApplication.stage]}` : '暂无应聘'],
          ['下次跟进', nextFollowUpLabel(item)],
        ]" :key="field[0]" class="mobile-result-field">
          <span class="mobile-result-field__label">{{ field[0] }}</span>
          <span class="mobile-result-field__value">{{ field[1] }}</span>
        </div>
        <template #actions>
          <el-button link type="primary" @click="openRow(item)">打开详情</el-button>
          <el-button v-if="canEdit" link type="danger" :disabled="loading" @click="openDelete([item])">删除</el-button>
        </template>
      </MobileResultCard>
    </template>

    <template #pagination>
      <ListPagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="pageSizeOptions" :total="total" @change="loadList" />
    </template>

    <template #detail>
      <TalentDetailDrawer v-model="detailVisible" :candidate-id="activeCandidateId" :application-match="activeApplicationMatch"
        @edit="openEdit" @removed="onRemoved" @changed="loadList" />
      <TalentFormDrawer ref="formDrawer" v-model="formVisible" :candidate-id="activeCandidateId"
        @saved="onSaved" @open-existing="openDetail" />
      <TalentDeleteDialog v-model="deleteVisible" :targets="deleteTargets" @removed="onRemoved" />
    </template>
  </BusinessListPage>
</template>

<style scoped>
.talent-list__selection { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 10px 16px; font-size: 13px; }
.talent-list__mobile-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.talent-list__mobile-name span { overflow-wrap: anywhere; }
.talent-filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.talent-filter-bar__keyword { width: 220px; }
.talent-filter-bar__select { width: 120px; }
.talent-filter-bar__scope { width: 142px; }
.talent-filter-bar__salary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.talent-filter-bar__salary :deep(.el-input-number) { width: 112px; }
.talent-filter-bar__salary-sep { color: var(--el-text-color-secondary); }
.talent-filter-bar__switches {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.talent-filter-toggle { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
.talent-name-cell { display: flex; flex-direction: column; gap: 2px; }
.talent-status-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.talent-name-cell__files { font-size: 12px; color: var(--el-text-color-secondary); }

@media (max-width: 768px) {
  .talent-filter-bar__keyword { width: 100%; }
  .talent-filter-bar__select { flex: 1 1 30%; }
  .talent-filter-bar__switches { flex-wrap: wrap; }
}
</style>
