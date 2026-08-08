<script setup lang="ts">
import { computed, nextTick, ref, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Calendar, DocumentChecked, RefreshLeft, Search, UserFilled } from '@element-plus/icons-vue';
import { tasksApi } from '@/api/tasks.api';
import { cyclesApi } from '@/api/cycles.api';
import { usePagination } from '@/composables/usePagination';
import { useAuthStore } from '@/stores/auth.store';
import StatusBadge from '@/components/common/StatusBadge.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import PerformanceWorkspace from '@/components/performance/PerformanceWorkspace.vue';
import PerformanceContextPanel from '@/components/performance/PerformanceContextPanel.vue';
import TeamTaskList, {
  type TeamTaskListHandle,
  type TeamTaskVersion,
} from './components/TeamTaskList.vue';
import TeamMemberRail, {
  type TeamMemberRailHandle,
} from './components/TeamMemberRail.vue';
import GoalReviewWorkspace, {
  type GoalReviewActionPayload,
  type GoalReviewRejectPayload,
  type GoalReviewSavePayload,
  type GoalReviewWorkspaceHandle,
} from './components/GoalReviewWorkspace.vue';
import type {
  AssessmentCycle,
  BatchReviewResult,
  TaskDetail,
  TaskListItem,
  TaskQuery,
  TeamTaskListItem,
  TeamTaskPage,
} from '@/types/api.types';
import type { TaskStatus, TeamStageState, TeamTaskStage } from '@/types/enums';
import {
  TASK_STATUS_STAGE,
  getTaskStageState,
  type TaskStageKey as MappedTaskStageKey,
  type TaskStageState,
} from './task-stage';
import { useTaskWorkspaceQuery } from './use-task-workspace-query';

const router = useRouter();
const auth = useAuthStore();
const workspaceQuery = useTaskWorkspaceQuery();

const list = ref<TaskListItem[]>([]);
const loading = ref(false);
const cycles = ref<AssessmentCycle[]>([]);
const selectedCycleId = ref<string>('');
const quickFilter = ref<'all' | 'pending' | 'cycle'>('all');
const teamLoading = ref(false);
const teamError = ref('');
const teamKeyword = ref(workspaceQuery.state.value.keyword ?? '');
const teamPageSize = 20;
const teamListRef = ref<TeamTaskListHandle>();
const teamMemberRailRef = ref<TeamMemberRailHandle>();
const goalReviewRef = ref<GoalReviewWorkspaceHandle>();
const hydratedTeamTask = ref<TeamTaskListItem>();
const teamDetailLoading = ref(false);
const teamDetailError = ref('');
const teamBatchBusy = ref(false);
let teamRequestSerial = 0;
let teamDetailRequestSerial = 0;

interface TeamBatchDisplayItem {
  taskId: string;
  label: string;
  reason?: string;
}

interface TeamBatchDisplayResult {
  actionLabel: string;
  level: 'success' | 'warning' | 'error';
  succeeded: TeamBatchDisplayItem[];
  failed: TeamBatchDisplayItem[];
  requestError?: string;
}

const teamBatchResult = ref<TeamBatchDisplayResult>();

function emptyTeamPage(): TeamTaskPage {
  return {
    total: 0,
    page: 1,
    pageSize: teamPageSize,
    items: [],
    counts: { all: 0, notStarted: 0, pending: 0, completed: 0, exempted: 0 },
    facets: { departments: [], employees: [] },
  };
}

const teamPage = ref<TeamTaskPage>(emptyTeamPage());
type TaskStageKey = 'all' | 'goal-setting' | 'goal-confirmation' | 'self-eval' | 'result';

const selectedStage = ref<TaskStageKey>('all');
const taskStages = [
  { key: 'goal-setting', label: '目标制定' },
  { key: 'goal-confirmation', label: '目标确认' },
  { key: 'self-eval', label: '自评' },
  { key: 'result', label: '结果确认' },
] as const;

const selectedCycle = computed(() => cycles.value.find((cycle) => cycle.id === selectedCycleId.value) ?? null);
const isManagerCapable = computed(() => auth.isManager);
const activeScope = computed<'mine' | 'team'>(() =>
  isManagerCapable.value && workspaceQuery.state.value.scope === 'team' ? 'team' : 'mine',
);
const selectedTeamTask = computed(() => {
  const taskId = workspaceQuery.state.value.taskId;
  return teamPage.value.items.find((item) => item.id === taskId)
    ?? (hydratedTeamTask.value?.id === taskId ? hydratedTeamTask.value : undefined);
});
const teamMemberLoading = computed(() => Boolean(
  workspaceQuery.state.value.taskId
  && !selectedTeamTask.value
  && (teamLoading.value || teamDetailLoading.value),
));
const teamMemberError = computed(() => {
  if (selectedTeamTask.value || teamMemberLoading.value) return '';
  return teamDetailError.value || teamError.value;
});
const teamEmployeeOptions = computed(() => {
  const departmentId = workspaceQuery.state.value.deptId;
  if (!departmentId) return teamPage.value.facets.employees;
  return teamPage.value.facets.employees.filter((employee) => employee.deptId === departmentId);
});
const teamStageTabs: Array<{ key: TeamTaskStage; label: string }> = [
  { key: 'goal-review', label: '指标审核' },
  { key: 'manager-eval', label: '主管评分' },
];
const teamCountTabs = computed<Array<{
  key: TeamStageState | undefined;
  label: string;
  count: number;
  testId: string;
}>>(() => [
  { key: undefined, label: '全部', count: teamPage.value.counts.all, testId: 'all' },
  { key: 'not_started', label: '未开始', count: teamPage.value.counts.notStarted, testId: 'not-started' },
  { key: 'pending', label: '待处理', count: teamPage.value.counts.pending, testId: 'pending' },
  { key: 'completed', label: '已完成', count: teamPage.value.counts.completed, testId: 'completed' },
  { key: 'exempted', label: '已豁免', count: teamPage.value.counts.exempted, testId: 'exempted' },
]);
const allowedPerformanceSections = computed(() =>
  auth.user?.sysRole === 'employee'
    ? (['tasks'] as const)
    : (['tracking', 'map', 'tasks'] as const),
);
const selectedCycleName = computed(() => {
  if (quickFilter.value === 'all') return '全部考核周期';
  if (quickFilter.value === 'pending') return '仅看待办';
  return selectedCycle.value?.name ?? '暂无考核周期';
});

const {
  page,
  pageSize,
  pageSizeOptions,
  reset: resetPagination,
} = usePagination({ defaultPageSize: 10 });

const pendingStatuses: TaskStatus[] = ['indicator_drafting', 'indicator_confirming', 'self_eval', 'published', 'appealing'];

const filteredTasks = computed(() => {
  if (selectedStage.value === 'all') return list.value;
  return list.value.filter((task) => TASK_STATUS_STAGE[task.status] === selectedStage.value);
});

const visibleTasks = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return filteredTasks.value.slice(start, start + pageSize.value);
});

const selectedStageLabel = computed(() => {
  if (selectedStage.value === 'all') return '全部绩效任务';
  return taskStages.find((stage) => stage.key === selectedStage.value)?.label ?? '绩效任务';
});

const visibleTotal = computed(() => filteredTasks.value.length);

function stageState(stage: MappedTaskStageKey): TaskStageState {
  const statuses = list.value
    .filter((task) => TASK_STATUS_STAGE[task.status] === stage)
    .map((task) => task.status);
  return getTaskStageState(statuses);
}

function stageStateLabel(state: TaskStageState): string {
  const labels: Record<TaskStageState, string> = {
    pending: '待处理',
    progress: '处理中',
    completed: '已完成',
    'not-started': '未开始',
  };
  return labels[state];
}

function selectStage(stage: TaskStageKey) {
  selectedStage.value = stage;
  resetPagination();
}

function getCycleTime(cycleId: string): number {
  const cycle = cycles.value.find((item) => item.id === cycleId);
  const rawDate = cycle?.startDate || cycle?.endDate || '';
  const time = rawDate ? new Date(rawDate).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function sortTasksByCycleDesc(items: TaskListItem[]) {
  return [...items].sort((a, b) => {
    const byCycle = getCycleTime(b.cycleId) - getCycleTime(a.cycleId);
    if (byCycle !== 0) return byCycle;
    return String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''));
  });
}

async function loadCycles() {
  try {
    const res = await cyclesApi.findAll({ pageSize: 50 });
    cycles.value = [...(res.items ?? [])].sort((a, b) => {
      const aTime = new Date(a.startDate || a.endDate || '').getTime();
      const bTime = new Date(b.startDate || b.endDate || '').getTime();
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
  } catch {
    cycles.value = [];
  }
}

async function loadList() {
  loading.value = true;
  try {
    const baseParams = {
      cycleId: quickFilter.value === 'cycle' ? selectedCycleId.value || undefined : undefined,
    } satisfies Omit<TaskQuery, 'employeeId' | 'page' | 'pageSize'>;
    const scopedTasks = await fetchAllMine(baseParams);
    const filtered = quickFilter.value === 'pending'
      ? scopedTasks.filter((task) => pendingStatuses.includes(task.status))
      : scopedTasks;
    list.value = sortTasksByCycleDesc(filtered);
  } catch {
    list.value = [];
    ElMessage.error('获取绩效任务失败');
  } finally {
    loading.value = false;
  }
}

function teamContextKey(): string {
  const state = workspaceQuery.state.value;
  return JSON.stringify([
    state.scope,
    state.stage,
    state.cycleId,
    state.deptId,
    state.employeeId,
    state.stageState,
    state.keyword,
    state.page ?? 1,
  ]);
}

function detailStageState(detail: TaskDetail, stage: TeamTaskStage): TeamStageState {
  if (detail.isExempt || detail.status === 'exempted') return 'exempted';
  if (stage === 'goal-review') {
    if (detail.status === 'indicator_reviewing') return 'pending';
    if (['pending', 'indicator_drafting', 'indicator_setting'].includes(detail.status)) {
      return 'not_started';
    }
    return 'completed';
  }
  if (detail.status === 'manager_scoring') return 'pending';
  if ([
    'indicator_drafting',
    'pending',
    'indicator_reviewing',
    'indicator_setting',
    'indicator_confirming',
    'self_eval',
  ].includes(detail.status)) return 'not_started';
  return 'completed';
}

function toTeamTaskItem(detail: TaskDetail, stage: TeamTaskStage): TeamTaskListItem {
  return {
    id: detail.id,
    cycleId: detail.cycleId,
    cycleName: detail.cycleName ?? '-',
    employeeId: detail.employeeId,
    employeeName: detail.employeeName ?? '-',
    deptId: detail.deptId ?? null,
    deptName: detail.deptName ?? null,
    managerId: detail.managerId ?? null,
    status: detail.status,
    totalScore: detail.gradeResult?.calculatedScore ?? null,
    rawGrade: detail.gradeResult?.rawGrade ?? null,
    updatedAt: detail.updatedAt ?? '',
    employeeNo: detail.employeeNo ?? null,
    avatarUrl: null,
    position: null,
    stageState: detailStageState(detail, stage),
  };
}

function httpErrorMessage(error: unknown, fallback: string): string {
  const candidate = error as {
    message?: string;
    response?: { data?: { message?: string | string[] } };
  };
  const responseMessage = candidate.response?.data?.message;
  if (Array.isArray(responseMessage)) return responseMessage.join('；');
  return responseMessage || candidate.message || fallback;
}

async function hydrateSelectedTeamTask(response: TeamTaskPage) {
  const taskId = workspaceQuery.state.value.taskId;
  const requestId = ++teamDetailRequestSerial;
  teamDetailError.value = '';
  if (!taskId || response.items.some((item) => item.id === taskId)) {
    hydratedTeamTask.value = undefined;
    teamDetailLoading.value = false;
    return;
  }

  teamDetailLoading.value = true;
  try {
    const detail = await tasksApi.findOne(taskId);
    if (requestId !== teamDetailRequestSerial || workspaceQuery.state.value.taskId !== taskId) return;
    hydratedTeamTask.value = detail
      ? toTeamTaskItem(detail, workspaceQuery.state.value.stage)
      : undefined;
  } catch (error) {
    if (requestId !== teamDetailRequestSerial || workspaceQuery.state.value.taskId !== taskId) return;
    hydratedTeamTask.value = undefined;
    teamDetailError.value = httpErrorMessage(error, '所选任务加载失败');
  } finally {
    if (requestId === teamDetailRequestSerial) teamDetailLoading.value = false;
  }
}

interface LoadTeamOptions {
  preserveSelectionIds?: string[];
  expectedContextKey?: string;
}

async function loadTeam(options: LoadTeamOptions = {}) {
  if (activeScope.value !== 'team') return;
  const requestId = ++teamRequestSerial;
  const state = workspaceQuery.state.value;
  const requestedPage = state.page ?? 1;
  teamLoading.value = true;
  teamError.value = '';
  try {
    const response = await tasksApi.findTeam({
      stage: state.stage,
      page: requestedPage,
      pageSize: teamPageSize,
      cycleId: state.cycleId,
      deptId: state.deptId,
      employeeId: state.employeeId,
      stageState: state.stageState,
      keyword: state.keyword,
    });
    if (requestId !== teamRequestSerial) return;
    teamPage.value = response;
    if (response.page !== requestedPage) {
      await teamListRef.value?.clearSelection();
      await workspaceQuery.update({ page: response.page > 1 ? response.page : undefined });
      return;
    }
    await nextTick();
    if (
      options.preserveSelectionIds
      && options.expectedContextKey === teamContextKey()
    ) {
      await teamListRef.value?.retainSelection(options.preserveSelectionIds);
    }
    await hydrateSelectedTeamTask(response);
  } catch {
    if (requestId === teamRequestSerial) {
      teamPage.value = emptyTeamPage();
      teamError.value = '团队任务加载失败';
      hydratedTeamTask.value = undefined;
    }
  } finally {
    if (requestId === teamRequestSerial) teamLoading.value = false;
  }
}

async function fetchAllMine(
  query: Omit<TaskQuery, 'employeeId' | 'page' | 'pageSize'>,
): Promise<TaskListItem[]> {
  const items: TaskListItem[] = [];
  let currentPage = 1;

  while (true) {
    const response = await tasksApi.findMine({ ...query, page: currentPage, pageSize: 100 });
    const batch = response.items ?? [];
    items.push(...batch);
    if (batch.length === 0 || items.length >= (response.total ?? 0)) break;
    currentPage += 1;
  }

  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function onCycleChange(value: string) {
  selectedStage.value = 'all';
  if (value === '__pending__') {
    showPendingTasks();
    return;
  }
  if (!value) {
    showAllCycles();
    return;
  }
  quickFilter.value = 'cycle';
  resetPagination();
  loadList();
}

function showAllCycles() {
  quickFilter.value = 'all';
  selectedCycleId.value = '';
  selectedStage.value = 'all';
  resetPagination();
  loadList();
}

function showPendingTasks() {
  quickFilter.value = 'pending';
  selectedCycleId.value = '__pending__';
  selectedStage.value = 'all';
  resetPagination();
  loadList();
}

function actionText(status: TaskStatus): string {
  const map: Partial<Record<TaskStatus, string>> = {
    indicator_drafting: '填写指标',
    indicator_reviewing: '查看审核进度',
    indicator_setting: '查看/补充指标',
    indicator_confirming: '确认指标',
    self_eval: '去自评',
    published: '查看结果',
    confirmed: '查看记录',
    appealing: '查看申诉',
    closed: '查看归档',
  };
  return map[status] ?? '进入详情';
}

function handlerText(status: TaskStatus): string {
  const map: Partial<Record<TaskStatus, string>> = {
    indicator_drafting: '员工填写指标',
    indicator_reviewing: '主管审核指标',
    indicator_setting: '主管/HR制定；员工可先补充建议',
    indicator_confirming: '员工确认',
    self_eval: '员工自评',
    manager_scoring: '主管评分',
    dept_review: '部门负责人审核',
    hr_calibration: 'HR校准',
    approval: '分管总审批',
    published: '员工查看结果',
    confirmed: '已完成确认',
    appealing: '申诉处理中',
    closed: '已归档',
  };
  return map[status] ?? '查看详情';
}

function isPending(status: TaskStatus): boolean {
  return pendingStatuses.includes(status);
}

function taskDisplayName(row: TaskListItem): string {
  return row.cycleName ? `${row.cycleName} · 个人绩效` : '个人绩效任务';
}

function asTask(row: unknown): TaskListItem {
  return row as TaskListItem;
}

function goDetail(row: unknown) {
  const item = row as TaskListItem;
  router.push({ name: 'TaskDetail', params: { id: item.id } });
}

async function updateTeamContext(patch: Parameters<typeof workspaceQuery.update>[0]) {
  await teamListRef.value?.clearSelection();
  teamBatchResult.value = undefined;
  await workspaceQuery.update(patch);
}

function setScope(scope: 'mine' | 'team') {
  if (scope === activeScope.value) return;
  void updateTeamContext({ scope, taskId: undefined, employeeId: undefined });
}

function setTeamStage(stage: TeamTaskStage) {
  void updateTeamContext({ stage, stageState: undefined, taskId: undefined });
}

function setTeamStageState(stageState: TeamStageState | undefined) {
  void updateTeamContext({ stageState, taskId: undefined });
}

function setTeamCycle(value: string) {
  void updateTeamContext({ cycleId: value || undefined, taskId: undefined });
}

function setTeamDepartment(value: string) {
  void updateTeamContext({
    deptId: value || undefined,
    employeeId: undefined,
    taskId: undefined,
  });
}

function setTeamEmployee(value: string) {
  void updateTeamContext({ employeeId: value || undefined, taskId: undefined });
}

function applyTeamSearch() {
  void updateTeamContext({ keyword: teamKeyword.value.trim() || undefined, taskId: undefined });
}

function resetTeamFilters() {
  teamKeyword.value = '';
  void updateTeamContext({
    cycleId: undefined,
    deptId: undefined,
    employeeId: undefined,
    stageState: undefined,
    keyword: undefined,
    taskId: undefined,
  });
}

function changeTeamPage(nextPage: number) {
  void updateTeamContext({ page: nextPage, taskId: undefined });
}

function isMobileViewport(): boolean {
  return window.matchMedia('(max-width: 768px)').matches;
}

async function selectTeamTask(payload: { taskId: string; employeeId: string }) {
  await workspaceQuery.update({ taskId: payload.taskId });
  await nextTick();
  if (isMobileViewport()) await teamMemberRailRef.value?.focusHeading();
}

async function closeTeamMember() {
  await workspaceQuery.update({ taskId: undefined });
  await nextTick();
  if (isMobileViewport()) await teamListRef.value?.focusList();
}

function batchItemLabels(tasks: TeamTaskVersion[]): Map<string, string> {
  return new Map(tasks.map(({ taskId }) => {
    const item = teamPage.value.items.find((candidate) => candidate.id === taskId);
    return [taskId, item?.employeeName ?? taskId];
  }));
}

async function applyBatchResult(
  actionLabel: string,
  result: BatchReviewResult,
  labels: Map<string, string>,
  contextKey: string,
) {
  if (contextKey !== teamContextKey()) return;
  const succeeded = result.succeeded.map(({ taskId }) => ({
    taskId,
    label: labels.get(taskId) ?? taskId,
  }));
  const failed = result.failed.map(({ taskId, reason }) => ({
    taskId,
    label: labels.get(taskId) ?? taskId,
    reason,
  }));
  const level: TeamBatchDisplayResult['level'] = succeeded.length === 0
    ? 'error'
    : failed.length > 0 ? 'warning' : 'success';
  teamBatchResult.value = { actionLabel, level, succeeded, failed };

  if (succeeded.length === 0) {
    ElMessage.error(`${actionLabel}失败，共 ${failed.length} 项`);
  } else if (failed.length > 0) {
    ElMessage.warning(`${actionLabel}完成：成功 ${succeeded.length} 项，失败 ${failed.length} 项`);
  } else {
    ElMessage.success(`${actionLabel}成功 ${succeeded.length} 项`);
  }

  await loadTeam({
    preserveSelectionIds: failed.map(({ taskId }) => taskId),
    expectedContextKey: contextKey,
  });
}

async function handleBatchRequestError(
  actionLabel: string,
  tasks: TeamTaskVersion[],
  labels: Map<string, string>,
  contextKey: string,
  error: unknown,
) {
  if (contextKey !== teamContextKey()) return;
  const message = httpErrorMessage(error, `${actionLabel}请求失败`);
  const failed = tasks.map(({ taskId }) => ({
    taskId,
    label: labels.get(taskId) ?? taskId,
    reason: message,
  }));
  teamBatchResult.value = {
    actionLabel,
    level: 'error',
    succeeded: [],
    failed,
    requestError: message,
  };
  await teamListRef.value?.retainSelection(failed.map(({ taskId }) => taskId));
}

async function executeTeamApproval(tasks: TeamTaskVersion[], actionLabel: string) {
  const labels = batchItemLabels(tasks);
  const contextKey = teamContextKey();
  teamBatchBusy.value = true;
  try {
    const result = await tasksApi.batchApproveIndicators({ tasks });
    await applyBatchResult(actionLabel, result, labels, contextKey);
    if (tasks.some(({ taskId }) => taskId === workspaceQuery.state.value.taskId)) {
      await goalReviewRef.value?.reload();
    }
  } catch (error) {
    await handleBatchRequestError(actionLabel, tasks, labels, contextKey, error);
  } finally {
    teamBatchBusy.value = false;
  }
}

async function executeTeamRejection(
  tasks: TeamTaskVersion[],
  reason: string,
  actionLabel: string,
) {
  const labels = batchItemLabels(tasks);
  const contextKey = teamContextKey();
  teamBatchBusy.value = true;
  try {
    const result = await tasksApi.batchRejectIndicators({ tasks, reason });
    await applyBatchResult(actionLabel, result, labels, contextKey);
    if (tasks.some(({ taskId }) => taskId === workspaceQuery.state.value.taskId)) {
      await goalReviewRef.value?.reload();
    }
  } catch (error) {
    await handleBatchRequestError(actionLabel, tasks, labels, contextKey, error);
  } finally {
    teamBatchBusy.value = false;
  }
}

async function approveTeamTasks(tasks: TeamTaskVersion[]) {
  try {
    await ElMessageBox.confirm(`确认通过选中的 ${tasks.length} 项指标审核？`, '批量通过', {
      confirmButtonText: '通过',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    throw error;
  }

  await executeTeamApproval(tasks, '批量通过');
}

async function rejectTeamTasks(tasks: TeamTaskVersion[]) {
  try {
    const { value } = await ElMessageBox.prompt('请输入驳回原因', '批量驳回', {
      confirmButtonText: '驳回',
      cancelButtonText: '取消',
      inputPattern: /\S+/,
      inputErrorMessage: '请输入驳回原因',
      type: 'warning',
    });
    await executeTeamRejection(tasks, value.trim(), '批量驳回');
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
  }
}

async function saveSingleGoalReview(payload: GoalReviewSavePayload) {
  const contextKey = teamContextKey();
  teamBatchBusy.value = true;
  try {
    const updatedTask = await tasksApi.setIndicators(payload.taskId, {
      ...payload.body,
      expectedUpdatedAt: payload.expectedUpdatedAt,
    });
    if (
      contextKey !== teamContextKey()
      || workspaceQuery.state.value.taskId !== payload.taskId
    ) return;
    goalReviewRef.value?.acceptTask(updatedTask);
    const listItem = teamPage.value.items.find((item) => item.id === payload.taskId);
    if (listItem && updatedTask.updatedAt) listItem.updatedAt = updatedTask.updatedAt;
    ElMessage.success('指标修改已保存');
  } catch (error) {
    ElMessage.error(httpErrorMessage(error, '指标修改保存失败'));
  } finally {
    teamBatchBusy.value = false;
  }
}

async function approveSingleGoalReview(payload: GoalReviewActionPayload) {
  await executeTeamApproval(
    [{ taskId: payload.taskId, updatedAt: payload.expectedUpdatedAt }],
    '单项通过',
  );
}

async function rejectSingleGoalReview(payload: GoalReviewRejectPayload) {
  await executeTeamRejection(
    [{ taskId: payload.taskId, updatedAt: payload.expectedUpdatedAt }],
    payload.reason,
    '单项驳回',
  );
}

onMounted(async () => {
  const cyclesRequest = loadCycles();
  if (activeScope.value === 'team') {
    await Promise.all([cyclesRequest, loadTeam()]);
  } else {
    await cyclesRequest;
    selectedCycleId.value = '';
    quickFilter.value = 'all';
    await loadList();
  }
});

watch(pageSize, () => {
  page.value = 1;
});

watch(
  () => ({
    scope: activeScope.value,
    stage: workspaceQuery.state.value.stage,
    cycleId: workspaceQuery.state.value.cycleId,
    deptId: workspaceQuery.state.value.deptId,
    employeeId: workspaceQuery.state.value.employeeId,
    stageState: workspaceQuery.state.value.stageState,
    keyword: workspaceQuery.state.value.keyword,
    page: workspaceQuery.state.value.page,
  }),
  async (current, previous) => {
    if (!previous) return;
    await teamListRef.value?.clearSelection();
    teamBatchResult.value = undefined;
    if (current.scope === 'team') await loadTeam();
    else if (previous.scope !== 'mine') await loadList();
  },
);

watch(
  () => workspaceQuery.state.value.keyword,
  (keyword) => {
    teamKeyword.value = keyword ?? '';
  },
);

watch(
  () => workspaceQuery.state.value.taskId,
  (taskId) => {
    if (!taskId) {
      teamDetailRequestSerial += 1;
      hydratedTeamTask.value = undefined;
      teamDetailError.value = '';
      teamDetailLoading.value = false;
      return;
    }
    if (
      activeScope.value === 'team'
      && !teamLoading.value
      && !teamPage.value.items.some((item) => item.id === taskId)
    ) {
      void hydrateSelectedTeamTask(teamPage.value);
    }
  },
);
</script>

<template>
  <PerformanceWorkspace
    title="绩效待办"
    active-section="tasks"
    :sections="allowedPerformanceSections"
  >
    <template #toolbar>
      <div v-if="isManagerCapable" class="task-scope-switch" aria-label="任务范围">
        <button
          type="button"
          data-testid="task-scope-mine"
          :class="{ 'is-active': activeScope === 'mine' }"
          :aria-pressed="activeScope === 'mine'"
          @click="setScope('mine')"
        >
          我的任务
        </button>
        <button
          type="button"
          data-testid="task-scope-team"
          :class="{ 'is-active': activeScope === 'team' }"
          :aria-pressed="activeScope === 'team'"
          @click="setScope('team')"
        >
          团队绩效
        </button>
      </div>
      <el-tag v-if="activeScope === 'mine'" type="info" effect="plain">{{ selectedCycleName }}</el-tag>
    </template>

    <template #context>
      <PerformanceContextPanel v-if="activeScope === 'mine'" title="绩效阶段">
        <div data-testid="task-context" class="task-context">
          <div class="task-context__cycle">
            <div class="task-context__label">
              <el-icon><Calendar /></el-icon>
              <span>考核周期</span>
            </div>
            <el-select
              v-model="selectedCycleId"
              data-testid="task-cycle-filter"
              placeholder="选择考核周期"
              @change="onCycleChange"
            >
              <el-option label="全部考核周期" value="" />
              <el-option label="仅看待办任务" value="__pending__" />
              <el-option
                v-for="cycle in cycles"
                :key="cycle.id"
                :label="cycle.name"
                :value="cycle.id"
              />
            </el-select>
          </div>

          <div class="task-context__group">
            <div class="task-context__label">
              <el-icon><UserFilled /></el-icon>
              <span>我的绩效待办</span>
            </div>

            <div class="task-stage-list">
              <button
                type="button"
                class="task-stage-item"
                :class="{ 'is-active': selectedStage === 'all' }"
                :aria-pressed="selectedStage === 'all'"
                @click="selectStage('all')"
              >
                <span>全部阶段</span>
                <span class="task-stage-item__count">{{ list.length }}</span>
              </button>

              <button
                v-for="stage in taskStages"
                :key="stage.key"
                type="button"
                class="task-stage-item"
                :class="{ 'is-active': selectedStage === stage.key }"
                :data-testid="`task-stage-${stage.key}`"
                :aria-pressed="selectedStage === stage.key"
                @click="selectStage(stage.key)"
              >
                <span>{{ stage.label }}</span>
                <span
                  class="task-stage-item__state"
                  :class="`is-${stageState(stage.key)}`"
                >
                  {{ stageStateLabel(stageState(stage.key)) }}
                </span>
              </button>
            </div>
          </div>
        </div>
      </PerformanceContextPanel>

      <PerformanceContextPanel v-else title="团队范围" collapsible>
        <div data-testid="team-task-context" class="team-context">
          <div class="team-context__section">
            <div class="task-context__label">
              <el-icon><DocumentChecked /></el-icon>
              <span>工作阶段</span>
            </div>
            <div class="team-stage-tabs">
              <button
                v-for="stage in teamStageTabs"
                :key="stage.key"
                type="button"
                :class="{ 'is-active': workspaceQuery.state.value.stage === stage.key }"
                :aria-pressed="workspaceQuery.state.value.stage === stage.key"
                @click="setTeamStage(stage.key)"
              >
                {{ stage.label }}
              </button>
            </div>
          </div>

          <div class="team-context__section team-context__filters">
            <div class="task-context__label">
              <el-icon><Calendar /></el-icon>
              <span>筛选范围</span>
            </div>
            <label class="team-filter-control">
              <span>考核周期</span>
              <el-select
                data-testid="team-cycle-filter"
                aria-label="考核周期"
                :model-value="workspaceQuery.state.value.cycleId || ''"
                placeholder="全部考核周期"
                clearable
                @change="setTeamCycle"
              >
                <el-option label="全部考核周期" value="" />
                <el-option
                  v-for="cycle in cycles"
                  :key="cycle.id"
                  :label="cycle.name"
                  :value="cycle.id"
                />
              </el-select>
            </label>
            <label class="team-filter-control">
              <span>部门</span>
              <el-select
                data-testid="team-department-filter"
                aria-label="部门"
                :model-value="workspaceQuery.state.value.deptId || ''"
                placeholder="全部部门"
                clearable
                filterable
                @change="setTeamDepartment"
              >
                <el-option label="全部部门" value="" />
                <el-option
                  v-for="department in teamPage.facets.departments"
                  :key="department.id"
                  :label="department.name"
                  :value="department.id"
                />
              </el-select>
            </label>
            <label class="team-filter-control">
              <span>员工</span>
              <el-select
                data-testid="team-employee-filter"
                aria-label="员工"
                :model-value="workspaceQuery.state.value.employeeId || ''"
                placeholder="全部员工"
                clearable
                filterable
                @change="setTeamEmployee"
              >
                <el-option label="全部员工" value="" />
                <el-option
                  v-for="employee in teamEmployeeOptions"
                  :key="employee.id"
                  :label="employee.employeeNo ? `${employee.name} · ${employee.employeeNo}` : employee.name"
                  :value="employee.id"
                />
              </el-select>
            </label>
          </div>

          <div class="team-context__section">
            <div class="task-context__label">
              <el-icon><UserFilled /></el-icon>
              <span>处理状态</span>
            </div>
            <div class="team-count-tabs">
              <button
                v-for="item in teamCountTabs"
                :key="item.testId"
                type="button"
                :data-testid="`team-count-${item.testId}`"
                :class="{ 'is-active': workspaceQuery.state.value.stageState === item.key }"
                :aria-pressed="workspaceQuery.state.value.stageState === item.key"
                @click="setTeamStageState(item.key)"
              >
                <span>{{ item.label }}</span>
                <strong>{{ item.count }}</strong>
              </button>
            </div>
          </div>
        </div>
      </PerformanceContextPanel>
    </template>

    <div v-if="activeScope === 'mine'" class="task-list page-stack">
      <section data-testid="task-surface" class="performance-surface">
        <header class="task-surface__header">
          <div class="task-surface__title">
            <span>{{ selectedCycleName }}</span>
            <h2>{{ selectedStageLabel }}</h2>
          </div>
          <div class="task-surface__summary">
            共 {{ visibleTotal }} 项
          </div>
        </header>

        <el-table v-loading="loading" class="app-table" :data="visibleTasks" @row-click="goDetail">
          <el-table-column label="任务名称" min-width="180">
            <template #default="{ row }">
              <div class="task-name">
                <div class="task-name__main">
                  <span>{{ taskDisplayName(asTask(row)) }}</span>
                  <el-tag v-if="asTask(row).isExempt" type="info" size="small" class="exempt-tag">已豁免</el-tag>
                </div>
                <div class="task-name__sub">
                  {{ asTask(row).employeeName || '-' }}<span v-if="asTask(row).deptName"> / {{ asTask(row).deptName }}</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="考核周期" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="cycle-cell">{{ asTask(row).cycleName || '未关联周期' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="190">
            <template #default="{ row }">
              <div class="status-cell">
                <StatusBadge :status="row.status" size="small" />
                <el-tag
                  :type="isPending(asTask(row).status) ? 'warning' : 'info'"
                  effect="plain"
                  size="small"
                >
                  {{ isPending(asTask(row).status) ? '待处理' : '无需处理' }}
                </el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="处理人/说明" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="handler-cell">{{ handlerText(asTask(row).status) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="当前动作" width="130" fixed="right">
            <template #default="{ row }">
              <el-button type="primary" size="small" :icon="DocumentChecked" @click.stop="goDetail(row)">
                {{ actionText(row.status) }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="!loading && visibleTasks.length === 0" class="empty-wrap">
          <EmptyState
            :description="selectedStage === 'all'
              ? '暂无绩效任务。请等待HR发起考核周期后再处理。'
              : '该阶段暂无绩效任务。'"
          />
        </div>

        <div v-if="visibleTotal > 0" class="app-pager">
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :page-sizes="pageSizeOptions"
            :total="visibleTotal"
            layout="total, sizes, prev, pager, next"
          />
        </div>
      </section>
    </div>

    <div v-else class="team-workspace">
      <section class="team-toolbar" aria-label="团队任务筛选">
        <label class="team-search-control">
          <span>搜索</span>
          <el-input
            v-model="teamKeyword"
            data-testid="team-keyword-filter"
            aria-label="搜索姓名或工号"
            clearable
            placeholder="搜索姓名或工号"
            @clear="applyTeamSearch"
            @keyup.enter="applyTeamSearch"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
        </label>
        <el-button type="primary" :icon="Search" @click="applyTeamSearch">搜索</el-button>
        <el-tooltip content="重置筛选" placement="top">
          <el-button
            class="team-toolbar__reset"
            :icon="RefreshLeft"
            aria-label="重置筛选"
            @click="resetTeamFilters"
          />
        </el-tooltip>
        <span class="team-toolbar__scope">
          {{ workspaceQuery.state.value.stage === 'goal-review' ? '指标审核' : '主管评分' }}
        </span>
      </section>

      <el-alert
        v-if="teamError"
        class="team-error"
        :title="teamError"
        type="error"
        show-icon
        :closable="false"
      >
        <template #default>
          <el-button size="small" @click="loadTeam()">重试</el-button>
        </template>
      </el-alert>

      <section
        v-if="teamBatchResult"
        class="team-batch-result"
        :class="`is-${teamBatchResult.level}`"
        data-testid="team-batch-result"
        :aria-label="`${teamBatchResult.actionLabel}结果`"
      >
        <header>
          <strong>{{ teamBatchResult.actionLabel }}结果</strong>
          <span>
            <template v-if="teamBatchResult.succeeded.length">
              成功 {{ teamBatchResult.succeeded.length }} 项<span v-if="teamBatchResult.failed.length">，</span>
            </template>
            <template v-if="teamBatchResult.failed.length">失败 {{ teamBatchResult.failed.length }} 项</template>
          </span>
        </header>
        <p v-if="teamBatchResult.requestError" class="team-batch-result__request-error">
          {{ teamBatchResult.requestError }}
        </p>
        <div class="team-batch-result__groups">
          <div
            v-if="teamBatchResult.succeeded.length"
            class="team-batch-result__group is-succeeded"
            data-testid="team-batch-succeeded"
          >
            <strong>成功</strong>
            <span v-for="item in teamBatchResult.succeeded" :key="item.taskId">{{ item.label }}</span>
          </div>
          <div
            v-if="teamBatchResult.failed.length"
            class="team-batch-result__group is-failed"
            data-testid="team-batch-failed"
          >
            <strong>失败</strong>
            <span v-for="item in teamBatchResult.failed" :key="item.taskId">
              {{ item.label }}<template v-if="item.reason">：{{ item.reason }}</template>
            </span>
          </div>
        </div>
      </section>

      <div
        class="team-layout"
        :class="{
          'has-detail': workspaceQuery.state.value.taskId,
          'is-goal-review': workspaceQuery.state.value.taskId
            && workspaceQuery.state.value.stage === 'goal-review',
        }"
      >
        <TeamTaskList
          ref="teamListRef"
          :items="teamPage.items"
          :total="teamPage.total"
          :page="teamPage.page"
          :page-size="teamPage.pageSize"
          :stage="workspaceQuery.state.value.stage"
          :stage-state="workspaceQuery.state.value.stageState"
          :selected-task-id="workspaceQuery.state.value.taskId"
          :loading="teamLoading"
          :error="Boolean(teamError)"
          :batch-busy="teamBatchBusy"
          @task-selected="selectTeamTask"
          @batch-approve="approveTeamTasks"
          @batch-reject="rejectTeamTasks"
          @page-change="changeTeamPage"
        />

        <TeamMemberRail
          v-if="workspaceQuery.state.value.taskId"
          ref="teamMemberRailRef"
          :task="selectedTeamTask"
          :task-id="workspaceQuery.state.value.taskId"
          :stage="workspaceQuery.state.value.stage"
          :loading="teamMemberLoading"
          :error="teamMemberError"
          @close="closeTeamMember"
        >
          <template
            v-if="workspaceQuery.state.value.stage === 'goal-review' && selectedTeamTask"
            #workspace
          >
            <GoalReviewWorkspace
              ref="goalReviewRef"
              :task-id="workspaceQuery.state.value.taskId"
              :departments="teamPage.facets.departments"
              :users="teamPage.facets.employees"
              :busy="teamBatchBusy"
              @save="saveSingleGoalReview"
              @approve="approveSingleGoalReview"
              @reject="rejectSingleGoalReview"
            />
          </template>
        </TeamMemberRail>
      </div>
    </div>
  </PerformanceWorkspace>
</template>

<style scoped>
.task-list {
  min-width: 0;
  min-height: 100%;
  padding: 16px;
}

.task-context {
  min-width: 0;
}

.task-context__cycle {
  padding: 2px 4px 14px;
  border-bottom: 1px solid #edf0f4;
}

.task-context__cycle :deep(.el-select) {
  width: 100%;
}

.task-context__label {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 9px;
  color: #4d576b;
  font-size: 13px;
  font-weight: 650;
}

.task-context__group {
  padding: 14px 0 0;
}

.task-stage-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.task-stage-item {
  width: 100%;
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  color: #30384b;
  background: transparent;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.task-stage-item:hover {
  background: #f2f6fc;
}

.task-stage-item.is-active {
  color: #155cc3;
  background: #e6f2ff;
}

.task-stage-item__count,
.task-stage-item__state {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 4px;
  color: #727c8f;
  background: #f0f2f5;
  font-size: 11px;
}

.task-stage-item__state.is-pending {
  color: #ad6800;
  background: #fff1d6;
}

.task-stage-item__state.is-progress {
  color: #155cc3;
  background: #e6f2ff;
}

.task-stage-item__state.is-completed {
  color: #237804;
  background: #e8f7df;
}

.performance-surface {
  min-width: 0;
  min-height: 500px;
  overflow: hidden;
  background: #fff;
  border: 1px solid #e2e6ed;
  border-radius: 7px;
}

.performance-surface :deep(.el-table) {
  border: 0;
  border-radius: 0;
}

.performance-surface :deep(.el-table__row) {
  cursor: pointer;
}

.task-surface__header {
  min-height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  border-bottom: 1px solid #e8ebf0;
}

.task-surface__title span {
  color: #7b8495;
  font-size: 12px;
}

.task-surface__title h2 {
  margin: 4px 0 0;
  color: #20283a;
  font-size: 18px;
  font-weight: 700;
}

.task-surface__summary {
  flex-shrink: 0;
  color: #6f7889;
  font-size: 13px;
}

.status-cell {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.task-name {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.task-name__main {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--app-text-primary);
  font-weight: 600;
}

.task-name__sub {
  color: var(--app-text-secondary);
  font-size: 12px;
}

.cycle-cell {
  color: var(--app-text-primary);
  font-weight: 500;
}

.handler-cell {
  color: var(--app-text-secondary);
  font-size: 13px;
}

.exempt-tag {
  flex-shrink: 0;
}

.task-scope-switch {
  min-width: 0;
  display: inline-flex;
  padding: 2px;
  border: 1px solid #dfe4ec;
  border-radius: 6px;
  background: #f6f8fb;
}

.task-scope-switch button,
.team-stage-tabs button,
.team-count-tabs button {
  border: 0;
  color: #596376;
  background: transparent;
  font-size: 12px;
  cursor: pointer;
}

.task-scope-switch button {
  min-height: 28px;
  padding: 0 11px;
  border-radius: 4px;
  white-space: nowrap;
}

.task-scope-switch button.is-active {
  color: #172033;
  background: #fff;
  box-shadow: 0 1px 2px rgb(24 35 55 / 12%);
  font-weight: 650;
}

.team-context {
  min-width: 0;
}

.team-context__section {
  padding: 2px 4px 14px;
  border-bottom: 1px solid #edf0f4;
}

.team-context__section + .team-context__section {
  padding-top: 14px;
}

.team-context__section:last-child {
  border-bottom: 0;
}

.team-stage-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 2px;
  border: 1px solid #dfe4ec;
  border-radius: 6px;
  background: #f6f8fb;
}

.team-stage-tabs button {
  min-height: 30px;
  border-radius: 4px;
}

.team-stage-tabs button.is-active {
  color: #155cc3;
  background: #fff;
  box-shadow: 0 1px 2px rgb(24 35 55 / 10%);
  font-weight: 650;
}

.team-context__filters {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.team-context__filters .task-context__label {
  margin-bottom: 1px;
}

.team-context__filters :deep(.el-select) {
  width: 100%;
}

.team-filter-control,
.team-search-control {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.team-filter-control > span,
.team-search-control > span {
  color: #70798a;
  font-size: 12px;
  font-weight: 600;
}

.team-count-tabs {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.team-count-tabs button {
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px;
  border-radius: 5px;
  text-align: left;
}

.team-count-tabs button:hover {
  background: #f2f6fc;
}

.team-count-tabs button.is-active {
  color: #155cc3;
  background: #e8f2ff;
  font-weight: 650;
}

.team-count-tabs strong {
  min-width: 24px;
  padding: 2px 6px;
  border-radius: 4px;
  color: #70798a;
  background: #edf0f4;
  font-size: 11px;
  text-align: center;
}

.team-count-tabs button.is-active strong {
  color: #155cc3;
  background: #fff;
}

.team-workspace {
  min-width: 0;
  min-height: 100%;
  padding: 12px;
  container-type: inline-size;
}

.team-toolbar {
  min-height: 50px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  padding: 8px 10px;
  border: 1px solid #e2e6ed;
  border-radius: 7px;
  background: #fff;
}

.team-search-control {
  width: min(320px, 100%);
}

.team-search-control :deep(.el-input) {
  width: min(320px, 100%);
}

.team-toolbar__reset {
  flex-shrink: 0;
}

.team-toolbar__scope {
  margin-left: auto;
  color: #70798a;
  font-size: 12px;
  white-space: nowrap;
}

.team-error {
  margin-bottom: 10px;
}

.team-batch-result {
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px solid #d9dfe8;
  border-left-width: 3px;
  border-radius: 7px;
  background: #fff;
}

.team-batch-result.is-success {
  border-left-color: #389e0d;
}

.team-batch-result.is-warning {
  border-left-color: #d48806;
}

.team-batch-result.is-error {
  border-left-color: #cf1322;
}

.team-batch-result header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #30384b;
  font-size: 13px;
}

.team-batch-result__request-error {
  margin: 8px 0 0;
  color: #a8071a;
  font-size: 12px;
}

.team-batch-result__groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 8px;
}

.team-batch-result__group {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 5px 10px;
  padding: 7px 9px;
  border-radius: 5px;
  font-size: 12px;
}

.team-batch-result__group.is-succeeded {
  color: #237804;
  background: #f0f9eb;
}

.team-batch-result__group.is-failed {
  color: #a8071a;
  background: #fff1f0;
}

.team-layout {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  align-items: stretch;
}

.team-layout.has-detail {
  grid-template-columns: minmax(620px, 1fr) minmax(288px, 320px);
}

.team-layout.has-detail.is-goal-review {
  grid-template-columns: minmax(0, 1fr);
}

.team-layout.has-detail.is-goal-review :deep(.team-member-rail) {
  width: 100%;
}

@container (max-width: 960px) {
  .team-layout.has-detail {
    grid-template-columns: minmax(0, 1fr);
  }

  .team-layout.has-detail :deep(.team-member-rail) {
    width: 100%;
    min-height: 390px;
  }
}

.empty-wrap {
  padding: 32px 0;
}

@media (max-width: 768px) {
  .task-list {
    min-height: auto;
    padding: 10px;
  }

  .task-scope-switch button {
    padding: 0 8px;
  }

  .task-context__cycle {
    padding-bottom: 10px;
  }

  .task-stage-list {
    flex-direction: row;
    overflow-x: auto;
  }

  .task-stage-item {
    width: 168px;
    min-width: 168px;
  }

  .performance-surface {
    min-height: 420px;
    overflow-x: auto;
  }

  .task-surface__header {
    width: 100%;
    min-width: 320px;
  }

  .task-surface__title h2 {
    font-size: 16px;
  }

  .team-context__filters {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .team-context__filters .task-context__label,
  .team-context__filters .team-filter-control:first-of-type {
    grid-column: 1 / -1;
  }

  .team-count-tabs {
    flex-flow: row wrap;
  }

  .team-count-tabs button {
    min-width: 108px;
    flex: 1;
  }

  .team-workspace {
    min-height: auto;
    padding: 10px;
  }

  .team-toolbar {
    flex-wrap: wrap;
  }

  .team-search-control {
    width: calc(100% - 92px);
  }

  .team-search-control :deep(.el-input) {
    width: 100%;
  }

  .team-toolbar__scope {
    width: 100%;
    margin-left: 0;
  }

  .team-batch-result__groups {
    grid-template-columns: minmax(0, 1fr);
  }

  .team-layout.has-detail {
    grid-template-columns: minmax(0, 1fr);
  }

  .team-layout.has-detail :deep(.team-task-list) {
    display: none;
  }
}
</style>
