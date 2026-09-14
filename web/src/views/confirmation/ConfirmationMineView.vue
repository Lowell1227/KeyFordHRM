<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { isAxiosError } from 'axios';
import { ElMessage } from 'element-plus';
import { confirmationApi } from '@/api/confirmation.api';
import { useAuthStore } from '@/stores/auth.store';
import ChartCard from '@/components/common/ChartCard.vue';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import { usePagination } from '@/composables/usePagination';
import { CONFIRMATION_STATUS_META } from '@/types/enums';
import { formatDate } from '@/utils/date';
import type { ConfirmationApplication, ConfirmationRoster } from '@/types/api.types';

const router = useRouter();
const auth = useAuthStore();

const list = ref<ConfirmationApplication[]>([]);
const roster = ref<ConfirmationRoster | null>(null);
const companyLabels: Record<string, string> = { fuede: '孚德', beijing_fuede: '北京孚德', fuede_sports: '孚德体育文化', fansibao: '凡思堡' };
const loading = ref(false);
const saving = ref(false);
const draftDialogVisible = ref(false);
const draftId = ref<string | null>(null);
const summary = ref('');
const summaryError = ref('');
const actionError = ref('');
const draftReturnReason = ref('');
const canStart = computed(() => auth.user?.status === 'probation' && !list.value.some((item) =>
  item.workflowVersion === 2 && ['draft', 'submitted', 'manager_approved', 'hr_approved'].includes(item.status),
));

const {
  page,
  pageSize,
  total,
  pageSizeOptions,
  reset: resetPagination,
  withParams,
} = usePagination({ defaultPageSize: 10 });

onMounted(() => {
  loadList();
  confirmationApi.myRoster().then((data) => { roster.value = data; }).catch(() => { roster.value = null; });
});

async function loadList() {
  loading.value = true;
  try {
    const res = await confirmationApi.findMine(withParams({} as Record<string, unknown>));
    list.value = res.items;
    total.value = res.total;
  } catch {
    list.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function goDetail(row: ConfirmationApplication) {
  router.push(`/confirmation-applications/${row.id}`);
}

function openCreate() {
  draftId.value = null;
  summary.value = '';
  summaryError.value = '';
  actionError.value = '';
  draftReturnReason.value = '';
  draftDialogVisible.value = true;
}

async function openDraft(row: ConfirmationApplication) {
  const detail = await confirmationApi.findOne(row.id);
  draftId.value = detail.id;
  summary.value = detail.summary ?? '';
  summaryError.value = '';
  actionError.value = '';
  draftReturnReason.value = detail.returnReason ?? '';
  draftDialogVisible.value = true;
}

function errorText(error: unknown): string {
  const message = isAxiosError(error) ? error.response?.data?.message : error instanceof Error ? error.message : null;
  return typeof message === 'string' && message.trim() ? message : '操作未完成，请稍后重试';
}

async function persistDraft(): Promise<string> {
  const saved = draftId.value
    ? await confirmationApi.saveSelfDraft(draftId.value, summary.value)
    : await confirmationApi.createSelfDraft(summary.value);
  draftId.value = saved.id;
  return saved.id;
}

async function saveDraft() {
  saving.value = true;
  actionError.value = '';
  try {
    await persistDraft();
    draftDialogVisible.value = false;
    ElMessage.success('草稿已保存');
    await loadList();
  } catch (error) {
    actionError.value = errorText(error);
  } finally {
    saving.value = false;
  }
}

async function submitDraft() {
  summaryError.value = summary.value.trim() ? '' : '请填写试用期工作小结';
  if (summaryError.value) return;
  saving.value = true;
  actionError.value = '';
  try {
    const id = await persistDraft();
    await confirmationApi.submitSelf(id);
    draftDialogVisible.value = false;
    ElMessage.success('申请已提交，下一步由直属主管评价');
    await loadList();
  } catch (error) {
    actionError.value = errorText(error);
    await loadList();
  } finally {
    saving.value = false;
  }
}

function statusLabel(status: string): string {
  return CONFIRMATION_STATUS_META[status as keyof typeof CONFIRMATION_STATUS_META]?.label ?? status;
}

function applicationStatusLabel(item: ConfirmationApplication): string {
  return item.status === 'draft' && item.returnReason ? '退回补充' : statusLabel(item.status);
}

function statusType(status: string): string {
  return CONFIRMATION_STATUS_META[status as keyof typeof CONFIRMATION_STATUS_META]?.type ?? 'info';
}
</script>

<template>
  <div class="confirmation-mine page-stack app-list-page">
    <ChartCard class="header-card list-page-header-card">
      <template #title>我的转正申请</template>

      <div class="header-actions">
        <span class="tip">填写工作小结后提交，由直属主管、HR 和公司审批人依次办理。</span>
        <el-button v-if="canStart" type="primary" @click="openCreate">发起转正申请</el-button>
      </div>
    </ChartCard>

    <ChartCard :padded="false" class="list-result-card">
      <div class="desktop-result-table">
      <el-table v-loading="loading" :data="list" height="100%" class="app-table">
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <el-tag :type="statusType((row as ConfirmationApplication).status) as any" size="small">
              {{ applicationStatusLabel(row as ConfirmationApplication) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="主管" min-width="120">
          <template #default="{ row }">{{ (row as ConfirmationApplication).manager?.name }}</template>
        </el-table-column>
        <el-table-column label="HR" min-width="120">
          <template #default="{ row }">{{ (row as ConfirmationApplication).hr?.name }}</template>
        </el-table-column>
        <el-table-column label="公司审批人" min-width="120">
          <template #default="{ row }">{{ (row as ConfirmationApplication).companyApprover?.name }}</template>
        </el-table-column>
        <el-table-column label="实际转正日期" width="130">
          <template #default="{ row }">{{ formatDate((row as ConfirmationApplication).actualRegularDate) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="(row as ConfirmationApplication).workflowVersion === 2 && (row as ConfirmationApplication).status === 'draft' ? openDraft(row as ConfirmationApplication) : goDetail(row as ConfirmationApplication)">
              {{ (row as ConfirmationApplication).workflowVersion === 2 && (row as ConfirmationApplication).status === 'draft' ? '继续填写' : '查看' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      </div>

      <div v-loading="loading" class="mobile-result-list">
        <MobileResultCard v-for="item in list" :key="item.id">
          <template #title>转正申请</template>
          <template #status><el-tag :type="statusType(item.status) as any" size="small">{{ applicationStatusLabel(item) }}</el-tag></template>
          <div class="mobile-result-field"><span class="mobile-result-field__label">主管</span><span class="mobile-result-field__value">{{ item.manager?.name || '-' }}</span></div>
          <div class="mobile-result-field"><span class="mobile-result-field__label">HR</span><span class="mobile-result-field__value">{{ item.hr?.name || '-' }}</span></div>
          <div class="mobile-result-field"><span class="mobile-result-field__label">公司审批人</span><span class="mobile-result-field__value">{{ item.companyApprover?.name || '-' }}</span></div>
          <div class="mobile-result-field"><span class="mobile-result-field__label">转正日期</span><span class="mobile-result-field__value">{{ formatDate(item.actualRegularDate) }}</span></div>
          <template #actions><el-button link type="primary" @click="item.workflowVersion === 2 && item.status === 'draft' ? openDraft(item) : goDetail(item)">{{ item.workflowVersion === 2 && item.status === 'draft' ? '继续填写' : '查看' }}</el-button></template>
        </MobileResultCard>
      </div>
      <ListPagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="pageSizeOptions"
        :total="total"
        @change="loadList"
      />
    </ChartCard>

    <el-dialog v-model="draftDialogVisible" title="转正申请 · 工作小结" width="min(560px, 96vw)" :close-on-click-modal="false">
      <p v-if="draftReturnReason" class="return-reason">退回原因：{{ draftReturnReason }}</p>
      <div v-if="roster" class="roster-check" data-testid="confirmation-roster-check">
        <div><span>员工</span><strong>{{ roster.name }}</strong></div>
        <div><span>所属公司</span><strong>{{ companyLabels[roster.company ?? ''] || '待核实' }}</strong></div>
        <div><span>部门 / 岗位</span><strong>{{ roster.deptName || '待核实' }} / {{ roster.position || '待核实' }}</strong></div>
        <div><span>入职 / 计划转正</span><strong>{{ formatDate(roster.entryDate) }} / {{ formatDate(roster.plannedRegularDate) }}</strong></div>
        <div><span>花名册直属主管</span><strong>{{ roster.managerName || '待 HR 核实' }}</strong></div>
      </div>
      <div class="draft-field">
        <label for="confirmation-summary">试用期工作小结 <span class="required">*</span></label>
        <el-input id="confirmation-summary" v-model="summary" type="textarea" :rows="8" maxlength="4000" show-word-limit placeholder="简述工作成果、目标进展、需要改进的地方和后续计划" @input="summaryError = ''" />
        <p v-if="summaryError" class="field-error">{{ summaryError }}</p>
        <p v-if="actionError" class="field-error">{{ actionError }}</p>
      </div>
      <template #footer>
        <el-button @click="draftDialogVisible = false">取消</el-button>
        <el-button :loading="saving" @click="saveDraft">保存草稿</el-button>
        <el-button type="primary" :loading="saving" @click="submitDraft">提交转正申请</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.tip {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  margin: 0;
}
.header-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.draft-field { display: grid; gap: 8px; }
.draft-field label { font-size: 13px; font-weight: 600; }
.required, .field-error { color: var(--el-color-danger); }
.field-error { margin: 0; font-size: 12px; }
.return-reason { margin: 0 0 12px; padding: 10px 12px; background: var(--el-color-warning-light-9); border-radius: 4px; overflow-wrap: anywhere; }
.roster-check { display: grid; gap: 4px; padding: 8px 0 12px; margin-bottom: 12px; border-bottom: 1px solid var(--el-border-color-lighter); }
.roster-check > div { display: grid; grid-template-columns: 108px minmax(0, 1fr); gap: 8px; font-size: 12px; line-height: 1.5; }
.roster-check span { color: var(--el-text-color-secondary); }
.roster-check strong { font-weight: 500; overflow-wrap: anywhere; }
@media (max-width: 640px) { .header-actions { align-items: flex-start; flex-direction: column; } }
</style>
