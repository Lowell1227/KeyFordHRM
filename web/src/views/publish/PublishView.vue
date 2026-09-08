<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { cyclesApi } from "@/api/cycles.api";
import {
  publicationApi,
  type PublicationRecord,
  type PublicationRecordDetail,
  type PublicationState,
} from "@/api/publication.api";
import GradeTag from "@/components/common/GradeTag.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import ChartCard from "@/components/common/ChartCard.vue";
import PerformanceResultSummary from "@/components/common/PerformanceResultSummary.vue";
import ReviewHistory from "@/components/common/ReviewHistory.vue";
import { usePagination } from "@/composables/usePagination";
import { formatScore } from "@/utils/score";
import { formatDateTime } from "@/utils/date";
import type { AssessmentCycle } from "@/types/api.types";
import { resolvePerformanceCycle } from "@/utils/performance-cycle";

const route = useRoute();
const router = useRouter();
const cycles = ref<AssessmentCycle[]>([]);
const selectedCycleId = ref("");
const records = ref<PublicationRecord[]>([]);
const loading = ref(false);
const publishing = ref(false);
const publishDialogOpen = ref(false);
const selectedTaskIds = ref<string[]>([]);
const sendDingtalk = ref(false);
const tableRef = ref<any>(null);
const detailDrawer = reactive<{
  visible: boolean;
  loading: boolean;
  error: string;
  cycleId: string;
  taskId: string;
  detail: PublicationRecordDetail | null;
}>({
  visible: false,
  loading: false,
  error: "",
  cycleId: "",
  taskId: "",
  detail: null,
});
let publishReady = false;
let publishCycleSyncing = false;
let recordsRequestSequence = 0;
let detailRequestSequence = 0;

const {
  page,
  pageSize,
  total,
  pageSizeOptions,
  reset: resetPagination,
} = usePagination({ defaultPageSize: 20 });
const selectedCycle = computed(() =>
  cycles.value.find((cycle) => cycle.id === selectedCycleId.value),
);
const interactionLocked = computed(
  () => publishing.value || publishDialogOpen.value,
);
const hasSelection = computed(() => selectedTaskIds.value.length > 0);

const publicationMeta: Record<
  PublicationState,
  { label: string; type: "info" | "success" | "warning" | "danger" }
> = {
  pending_approval: { label: "待审批", type: "warning" },
  ready_to_publish: { label: "待公示", type: "warning" },
  published: { label: "已公示", type: "success" },
  confirmed: { label: "员工已确认", type: "success" },
  appealing: { label: "申诉中", type: "danger" },
  closed: { label: "已归档", type: "info" },
};

function stateMeta(state: PublicationState) {
  return publicationMeta[state];
}

function rowSelectable(row: PublicationRecord) {
  return row.canPublish && !interactionLocked.value;
}

async function loadCycles() {
  try {
    const items: AssessmentCycle[] = [];
    const cyclePageSize = 100;
    let cyclePage = 1;
    while (true) {
      const res = await cyclesApi.findAll({
        purpose: "publish",
        page: cyclePage,
        pageSize: cyclePageSize,
      });
      items.push(...res.items);
      if (items.length >= res.total || res.items.length === 0) break;
      cyclePage += 1;
    }
    cycles.value = items;
  } catch {
    cycles.value = [];
    ElMessage.error("获取公示周期失败");
  }
}

async function normalizePublishCycle() {
  const requestedCycleId =
    typeof route.query.cycleId === "string" ? route.query.cycleId : undefined;
  const resolved = resolvePerformanceCycle(cycles.value, requestedCycleId);
  cycles.value = resolved.orderedCycles;
  selectedCycleId.value = resolved.selectedCycle?.id ?? "";
  if (selectedCycleId.value && requestedCycleId !== selectedCycleId.value) {
    await router.replace({
      query: { ...route.query, cycleId: selectedCycleId.value },
    });
  } else if (!selectedCycleId.value && requestedCycleId) {
    const query = { ...route.query };
    delete query.cycleId;
    await router.replace({ query });
  }
}

function clearPublishState() {
  recordsRequestSequence += 1;
  records.value = [];
  total.value = 0;
  selectedTaskIds.value = [];
  tableRef.value?.clearSelection();
  sendDingtalk.value = false;
}

async function selectPublishCycle(cycleId: string) {
  if (interactionLocked.value || !cycleId || cycleId === selectedCycleId.value)
    return;
  await router.push({ query: { ...route.query, cycleId } });
}

async function loadRecords() {
  const cycleId = selectedCycleId.value;
  const requestSequence = ++recordsRequestSequence;
  if (!cycleId) {
    records.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  try {
    const res = await publicationApi.getRecords(cycleId, {
      page: page.value,
      pageSize: pageSize.value,
    });
    if (
      requestSequence !== recordsRequestSequence ||
      cycleId !== selectedCycleId.value
    )
      return;
    records.value = res.items;
    total.value = res.total;
  } catch {
    if (
      requestSequence !== recordsRequestSequence ||
      cycleId !== selectedCycleId.value
    )
      return;
    records.value = [];
    total.value = 0;
    ElMessage.error("获取公示记录失败");
  } finally {
    if (requestSequence === recordsRequestSequence) loading.value = false;
  }
}

function refreshList() {
  selectedTaskIds.value = [];
  tableRef.value?.clearSelection();
  void loadRecords();
}

watch(
  () => route.query.cycleId,
  async (cycleId) => {
    if (!publishReady) return;
    const requestedCycleId = typeof cycleId === "string" ? cycleId : undefined;
    const resolved = resolvePerformanceCycle(cycles.value, requestedCycleId);
    const canonicalCycleId = resolved.selectedCycle?.id ?? "";
    if (canonicalCycleId && requestedCycleId !== canonicalCycleId) {
      await router.replace({
        query: { ...route.query, cycleId: canonicalCycleId },
      });
      return;
    }
    if (!canonicalCycleId && requestedCycleId) {
      const query = { ...route.query };
      delete query.cycleId;
      await router.replace({ query });
      return;
    }
    if (selectedCycleId.value === canonicalCycleId) return;
    publishCycleSyncing = true;
    clearPublishState();
    selectedCycleId.value = canonicalCycleId;
    resetPagination();
    publishCycleSyncing = false;
    await loadRecords();
  },
);

watch([page, pageSize], () => {
  if (!publishReady || publishCycleSyncing) return;
  void loadRecords();
});

onMounted(async () => {
  await loadCycles();
  await normalizePublishCycle();
  publishReady = true;
  await loadRecords();
});

function onSelectionChange(rows: PublicationRecord[]) {
  if (interactionLocked.value) return;
  selectedTaskIds.value = rows
    .filter((row) => row.canPublish)
    .map((row) => row.taskId);
}

function selectAllOnPage() {
  if (interactionLocked.value) return;
  records.value
    .filter((row) => row.canPublish)
    .forEach((row) => tableRef.value?.toggleRowSelection(row, true));
}

function clearSelection() {
  if (interactionLocked.value) return;
  tableRef.value?.clearSelection();
  selectedTaskIds.value = [];
}

async function handlePublish() {
  if (
    !selectedCycleId.value ||
    selectedTaskIds.value.length === 0 ||
    interactionLocked.value
  )
    return;
  const snapshot = {
    cycleId: selectedCycleId.value,
    cycleName: selectedCycle.value?.name ?? "当前周期",
    taskIds: [...selectedTaskIds.value],
    sendDingtalkNotification: sendDingtalk.value,
  };
  publishDialogOpen.value = true;
  try {
    await ElMessageBox.confirm(
      `确认公示「${snapshot.cycleName}」中选中的 ${snapshot.taskIds.length} 条绩效结果？${snapshot.sendDingtalkNotification ? "将发送钉钉通知。" : "不会发送钉钉通知。"}公示后员工可在「我的绩效」中查看结果。`,
      "确认公示",
      {
        confirmButtonText: "确认公示",
        cancelButtonText: "取消",
        type: "warning",
        closeOnClickModal: false,
      },
    );
  } catch {
    return;
  } finally {
    publishDialogOpen.value = false;
  }

  publishing.value = true;
  try {
    const res = await publicationApi.publish(snapshot.cycleId, {
      taskIds: snapshot.taskIds,
      sendDingtalkNotification: snapshot.sendDingtalkNotification,
    });
    ElMessage.success(`公示成功，共发布 ${res.published} 条`);
    sendDingtalk.value = false;
    if (selectedCycleId.value === snapshot.cycleId) refreshList();
  } catch {
    // 错误由 HTTP 拦截器统一展示。
  } finally {
    publishing.value = false;
  }
}

async function openDetail(
  row: Pick<PublicationRecord, "cycleId" | "taskId" | "resultMasked">,
) {
  if (row.resultMasked || interactionLocked.value) return;
  const requestSequence = ++detailRequestSequence;
  detailDrawer.visible = true;
  detailDrawer.loading = true;
  detailDrawer.error = "";
  detailDrawer.detail = null;
  detailDrawer.cycleId = row.cycleId;
  detailDrawer.taskId = row.taskId;
  try {
    const detail = await publicationApi.getRecordDetail(
      row.cycleId,
      row.taskId,
    );
    if (requestSequence === detailRequestSequence) detailDrawer.detail = detail;
  } catch {
    if (requestSequence === detailRequestSequence)
      detailDrawer.error = "公示详情加载失败，请重试";
  } finally {
    if (requestSequence === detailRequestSequence) detailDrawer.loading = false;
  }
}

function closeDetail() {
  detailRequestSequence += 1;
  detailDrawer.detail = null;
  detailDrawer.error = "";
}
</script>

<template>
  <div
    class="publish-view page-stack"
    :class="{ 'app-list-page': selectedCycle }"
  >
    <ChartCard class="list-page-header-card">
      <template #title>结果公示发布台</template>
      <template #extra>
        <div class="publish-view__toolbar">
          <el-select
            :model-value="selectedCycleId"
            data-testid="publish-cycle-select"
            :placeholder="cycles.length ? '选择考核周期' : '暂无考核周期'"
            style="width: 260px"
            :disabled="cycles.length === 0 || interactionLocked"
            @change="selectPublishCycle"
          >
            <el-option
              v-if="cycles.length === 0"
              label="暂无考核周期"
              value=""
              disabled
            />
            <el-option
              v-for="cycle in cycles"
              :key="cycle.id"
              :label="cycle.name"
              :value="cycle.id"
            />
          </el-select>
          <el-checkbox
            v-model="sendDingtalk"
            class="dingtalk-checkbox"
            :disabled="interactionLocked"
            >发送钉钉通知</el-checkbox
          >
          <el-button
            type="primary"
            :disabled="!hasSelection || interactionLocked"
            :loading="publishing"
            @click="handlePublish"
          >
            发布公示
          </el-button>
        </div>
      </template>

      <EmptyState
        v-if="!selectedCycle"
        class="publish-view__empty"
        description="暂无可公示的考核周期"
      />
      <div v-else class="publish-view__sub-toolbar">
        <span class="selection-tip"
          >已选 <strong>{{ selectedTaskIds.length }}</strong> 项</span
        >
        <div class="selection-actions">
          <el-button
            link
            type="primary"
            :disabled="interactionLocked"
            @click="selectAllOnPage"
            >全选本页待公示</el-button
          >
          <el-button
            link
            type="info"
            :disabled="interactionLocked"
            @click="clearSelection"
            >清空选择</el-button
          >
        </div>
      </div>
    </ChartCard>

    <ChartCard v-if="selectedCycle" :padded="false" class="list-result-card">
      <el-table
        ref="tableRef"
        class="app-table"
        v-loading="loading"
        :data="records"
        height="100%"
        row-key="taskId"
        @selection-change="onSelectionChange"
      >
        <el-table-column
          type="selection"
          width="50"
          :selectable="rowSelectable"
          reserve-selection
        />
        <el-table-column prop="employeeName" label="员工" min-width="120" />
        <el-table-column prop="employeeNo" label="工号" min-width="110" />
        <el-table-column
          prop="deptName"
          label="部门"
          min-width="150"
          show-overflow-tooltip
        />
        <el-table-column label="总分" width="105">
          <template #default="{ row }">
            <span v-if="row.resultMasked" class="masked-result"
              >公示前不可查看本人结果</span
            >
            <span v-else>{{ formatScore(row.totalScore) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="等级" width="100">
          <template #default="{ row }">
            <span v-if="row.resultMasked">—</span>
            <GradeTag
              v-else
              :grade="row.calibratedGrade ?? row.rawGrade"
              size="small"
            />
          </template>
        </el-table-column>
        <el-table-column label="公示状态" width="120">
          <template #default="{ row }">
            <el-tag :type="stateMeta(row.publicationState).type" size="small">{{
              stateMeta(row.publicationState).label
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="公示时间" min-width="165">
          <template #default="{ row }">{{
            row.publishedAt ? formatDateTime(row.publishedAt) : "—"
          }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="!row.resultMasked"
              link
              type="primary"
              :disabled="interactionLocked"
              @click="openDetail(row as PublicationRecord)"
              >详情</el-button
            >
            <span v-else class="text-secondary">公示后查看</span>
          </template>
        </el-table-column>
      </el-table>

      <EmptyState
        v-if="!loading && records.length === 0"
        class="publish-view__empty"
        description="该周期暂无公示记录"
      />
      <div v-if="total > 0" class="app-pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="pageSizeOptions"
          :total="total"
          layout="total, sizes, prev, pager, next"
          :disabled="interactionLocked"
        />
      </div>
    </ChartCard>

    <el-drawer
      v-model="detailDrawer.visible"
      title="公示详情"
      size="min(640px, 100vw)"
      data-testid="publication-detail-drawer"
      destroy-on-close
      @close="closeDetail"
    >
      <el-skeleton v-if="detailDrawer.loading" :rows="8" animated />
      <div
        v-else-if="detailDrawer.error"
        class="publish-view__load-error"
        role="alert"
      >
        <span>{{ detailDrawer.error }}</span>
        <el-button
          @click="
            openDetail({
              cycleId: detailDrawer.cycleId,
              taskId: detailDrawer.taskId,
              resultMasked: false,
            })
          "
          >重试</el-button
        >
      </div>
      <template v-else-if="detailDrawer.detail">
        <PerformanceResultSummary
          :cycle-name="detailDrawer.detail.cycleName"
          :employee-name="detailDrawer.detail.employeeName"
          :status-label="stateMeta(detailDrawer.detail.publicationState).label"
          :status-type="stateMeta(detailDrawer.detail.publicationState).type"
          :department-name="detailDrawer.detail.deptName"
          :position="detailDrawer.detail.position"
          :manager-name="detailDrawer.detail.managerName"
          :score="detailDrawer.detail.totalScore"
          :raw-grade="detailDrawer.detail.rawGrade"
          :calibrated-grade="detailDrawer.detail.calibratedGrade"
        />
        <ReviewHistory :records="detailDrawer.detail.flowRecords" />
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.publish-view__toolbar,
.publish-view__sub-toolbar,
.selection-actions,
.publish-view__load-error {
  display: flex;
  align-items: center;
}

.publish-view__toolbar {
  gap: 12px;
  flex-wrap: wrap;
}
.publish-view__sub-toolbar {
  justify-content: space-between;
  gap: 12px;
}
.selection-actions {
  gap: 8px;
}
.selection-tip {
  font-size: 14px;
  color: var(--el-text-color-regular);
}
.dingtalk-checkbox {
  margin-left: 8px;
}
.masked-result {
  display: inline-block;
  max-width: 88px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 16px;
  white-space: normal;
}
.publish-view__empty {
  padding: 32px 0;
}
.publish-view__load-error {
  justify-content: space-between;
  gap: 12px;
}
.text-secondary {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

@media (max-width: 600px) {
  .publish-view__toolbar {
    align-items: stretch;
  }
  .publish-view__toolbar :deep(.el-select) {
    width: 100% !important;
  }
  .publish-view__sub-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
