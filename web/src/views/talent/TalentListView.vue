<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { talentPoolApi } from '@/api/talent-pool.api';
import { usePagination } from '@/composables/usePagination';
import {
  TALENT_STATUSES,
  TALENT_STATUS_LABELS,
  TALENT_STATUS_TAG,
  TALENT_SOURCE_CHANNELS,
  TALENT_SOURCE_LABELS,
  TALENT_TAGS,
  TALENT_TAG_LABELS,
  EDUCATION_LABELS,
  type TalentCandidateListItem,
  type TalentSourceChannel,
  type TalentStatus,
  type TalentTag,
} from '@/types/talent.types';
import { formatDate } from '@/utils/date';
import ChartCard from '@/components/common/ChartCard.vue';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import TalentDetailDrawer from './components/TalentDetailDrawer.vue';
import TalentFormDrawer from './components/TalentFormDrawer.vue';
import { useTalentPermissions } from './useTalentPermissions';

const { canEdit } = useTalentPermissions();

const list = ref<TalentCandidateListItem[]>([]);
const loading = ref(false);
const loadError = ref('');
const detailVisible = ref(false);
const formVisible = ref(false);
const activeCandidateId = ref<string | null>(null);
const filters = reactive({
  keyword: '',
  status: '' as TalentStatus | '',
  source: '' as TalentSourceChannel | '',
  tag: '' as TalentTag | '',
  salaryMin: undefined as number | undefined,
  salaryMax: undefined as number | undefined,
  dueOnly: false,
  staleOnly: false,
});
const { page, pageSize, total, pageSizeOptions, reset, withParams } = usePagination({ defaultPageSize: 20 });
let requestId = 0;

onMounted(() => {
  void loadList();
});

async function loadList() {
  const id = ++requestId;
  loading.value = true;
  loadError.value = '';
  try {
    const res = await talentPoolApi.list(withParams({
      keyword: filters.keyword.trim() || undefined,
      status: filters.status || undefined,
      source: filters.source || undefined,
      tag: filters.tag || undefined,
      salaryMin: filters.salaryMin,
      salaryMax: filters.salaryMax,
      dueOnly: filters.dueOnly || undefined,
      staleOnly: filters.staleOnly || undefined,
    }));
    if (id !== requestId) return;
    list.value = res.items;
    total.value = res.total;
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
function openDetail(id: string) {
  activeCandidateId.value = id;
  detailVisible.value = true;
}
function openEdit(id: string) {
  if (!canEdit.value) return;
  activeCandidateId.value = id;
  detailVisible.value = false;
  formVisible.value = true;
}
function onSaved() { void loadList(); }
function onRemoved() { void loadList(); }
function onReset() {
  Object.assign(filters, {
    keyword: '', status: '', source: '', tag: '',
    salaryMin: undefined, salaryMax: undefined, dueOnly: false, staleOnly: false,
  });
  onSearch();
}

function formatSalary(row: TalentCandidateListItem): string {
  const min = row.expectSalaryMin;
  const max = row.expectSalaryMax;
  if (min == null && max == null) return '—';
  if (min != null && max != null) return `${min}–${max}K`;
  if (min != null) return `${min}K以上`;
  return `${max}K以下`;
}

function formatExperience(years: number | null): string {
  return years == null ? '—' : `${years}年`;
}

function asRow(row: unknown): TalentCandidateListItem {
  return row as TalentCandidateListItem;
}

const EMPTY_TEXT = '还没有人才记录。点「新增人才」开始，纸质简历可以直接拍照上传。';
</script>

<template>
  <BusinessListPage variant="record" :loading="loading" class="talent-list">
    <template #primary-action>
      <el-button v-if="canEdit" type="primary" @click="openCreate">新增人才</el-button>
    </template>
    <template #filters>
      <div class="talent-filter-bar">
        <el-input v-model="filters.keyword" class="talent-filter-bar__keyword" clearable placeholder="姓名 / 手机 / 公司 / 职位"
          @keyup.enter="onSearch" @clear="onSearch" />
        <el-select v-model="filters.status" data-testid="talent-filter-status" class="talent-filter-bar__select" clearable placeholder="状态" @change="onSearch">
          <el-option v-for="s in TALENT_STATUSES" :key="s" :label="TALENT_STATUS_LABELS[s]" :value="s" />
        </el-select>
        <el-select v-model="filters.source" data-testid="talent-filter-source" class="talent-filter-bar__select" clearable placeholder="来源" @change="onSearch">
          <el-option v-for="s in TALENT_SOURCE_CHANNELS" :key="s" :label="TALENT_SOURCE_LABELS[s]" :value="s" />
        </el-select>
        <el-select v-model="filters.tag" data-testid="talent-filter-tag" class="talent-filter-bar__select" clearable placeholder="标签" @change="onSearch">
          <el-option v-for="t in TALENT_TAGS" :key="t" :label="TALENT_TAG_LABELS[t]" :value="t" />
        </el-select>
        <div class="talent-filter-bar__salary">
          <el-input-number v-model="filters.salaryMin" :min="0" :max="999" :controls="false" placeholder="最低K"
            @change="onSearch" />
          <span class="talent-filter-bar__salary-sep">–</span>
          <el-input-number v-model="filters.salaryMax" :min="0" :max="999" :controls="false" placeholder="最高K"
            @change="onSearch" />
        </div>
        <div class="talent-filter-bar__switches">
          <el-switch v-model="filters.dueOnly" @change="onSearch" /> 仅看待跟进
          <el-switch v-model="filters.staleOnly" @change="onSearch" /> 超18个月未联系
        </div>
        <el-button @click="onReset">重置</el-button>
      </div>
    </template>

    <template #feedback>
      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false">
        <el-button link type="primary" @click="loadList">重试</el-button>
      </el-alert>
    </template>

    <template #desktop-list>
      <el-table v-loading="loading" class="app-table" :data="list" height="100%" :empty-text="EMPTY_TEXT"
        @row-click="(row: unknown) => openDetail(asRow(row).id)">
        <el-table-column label="姓名" min-width="110" fixed>
          <template #default="{ row }">
            <div class="talent-name-cell">
              <span>{{ row.name }}</span>
              <span v-if="asRow(row).fileCount > 0" class="talent-name-cell__files">简历×{{ asRow(row).fileCount }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="phone" label="手机" width="120" />
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
            {{ row.education ? EDUCATION_LABELS[asRow(row).education as keyof typeof EDUCATION_LABELS] : '—' }}
          </template>
        </el-table-column>
        <el-table-column label="期望薪资" width="110">
          <template #default="{ row }">{{ formatSalary(asRow(row)) }}</template>
        </el-table-column>
        <el-table-column label="来源" width="100">
          <template #default="{ row }">{{ TALENT_SOURCE_LABELS[asRow(row).sourceChannel] }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="TALENT_STATUS_TAG[asRow(row).status].type" :effect="TALENT_STATUS_TAG[asRow(row).status].effect ?? 'light'" size="small">
              {{ TALENT_STATUS_LABELS[asRow(row).status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="下次跟进" width="110">
          <template #default="{ row }">{{ asRow(row).nextFollowUpAt ? formatDate(asRow(row).nextFollowUpAt) : '—' }}</template>
        </el-table-column>
        <el-table-column label="更新时间" width="110">
          <template #default="{ row }">{{ formatDate(asRow(row).updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="openDetail(asRow(row).id)">打开</el-button>
            <el-button v-if="canEdit" link type="primary" @click.stop="openEdit(asRow(row).id)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <template #mobile-list>
      <el-empty v-if="!loading && !list.length && !loadError" :description="EMPTY_TEXT" />
      <MobileResultCard v-for="item in list" :key="item.id">
        <template #title>{{ item.name }}</template>
        <template #status>
          <el-tag :type="TALENT_STATUS_TAG[item.status].type" :effect="TALENT_STATUS_TAG[item.status].effect ?? 'light'" size="small">
            {{ TALENT_STATUS_LABELS[item.status] }}
          </el-tag>
        </template>
        <div v-for="field in [
          ['岗位', item.appliedPosition || item.currentPosition || '—'],
          ['手机', item.phone],
          ['公司', item.currentCompany || '—'],
          ['期望薪资', formatSalary(item)],
        ]" :key="field[0]" class="mobile-result-field">
          <span class="mobile-result-field__label">{{ field[0] }}</span>
          <span class="mobile-result-field__value">{{ field[1] }}</span>
        </div>
        <template #actions>
          <el-button link type="primary" @click="openDetail(item.id)">打开详情</el-button>
        </template>
      </MobileResultCard>
    </template>

    <template #pagination>
      <ListPagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="pageSizeOptions" :total="total" @change="loadList" />
    </template>

    <template #detail>
      <TalentDetailDrawer v-model="detailVisible" :candidate-id="activeCandidateId"
        @edit="openEdit" @removed="onRemoved" @changed="loadList" />
      <TalentFormDrawer v-model="formVisible" :candidate-id="activeCandidateId"
        @saved="onSaved" @open-existing="openDetail" />
    </template>
  </BusinessListPage>
</template>

<style scoped>
.talent-list__header-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.talent-filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.talent-filter-bar__keyword { width: 220px; }
.talent-filter-bar__select { width: 120px; }
.talent-filter-bar__salary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.talent-filter-bar__salary :deep(.el-input-number) { width: 76px; }
.talent-filter-bar__salary-sep { color: var(--el-text-color-secondary); }
.talent-filter-bar__switches {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.talent-name-cell { display: flex; flex-direction: column; gap: 2px; }
.talent-name-cell__files { font-size: 12px; color: var(--el-text-color-secondary); }

@media (max-width: 768px) {
  .talent-filter-bar__keyword { width: 100%; }
  .talent-filter-bar__select { flex: 1 1 30%; }
  .talent-filter-bar__switches { flex-wrap: wrap; }
}
</style>
