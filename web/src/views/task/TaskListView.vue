<script setup lang="ts">
import { computed, nextTick, ref, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
import ManagerEvaluationWorkspace from './components/ManagerEvaluationWorkspace.vue';
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
const route = useRoute();
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
const teamBatchRequestBusy = ref(false);
const teamSingleRequestBusy = ref(false);
const teamBatchBusy = computed(() => teamBatchRequestBusy.value || teamSingleRequestBusy.value);
const teamStagePendingCounts = ref<Record<TeamTaskStage, number | undefined>>({
  'goal-review': undefined,
  'manager-eval': undefined,
});
let teamRequestSerial = 0;
let teamDetailRequestSerial = 0;
let teamStageSummaryRequestSerial = 0;
let singleOperationSerial = 0;
let saveRequestSerial = 0;
const latestSaveRequestByTask = new Map<string, {
  requestId: number;
  operationToken: string;
}>();

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

interface LoadListOptions {
  silent?: boolean;
}

async function loadList(options: LoadListOptions = {}) {
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
    if (!options.silent) ElMessage.error('获取绩效任务失败');
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

function isAssignedTeamManager(detail: Pick<TaskDetail, 'managerId'>): boolean {
  return Boolean(auth.user?.id && detail.managerId === auth.user.id);
}

async function denyTeamTaskAccess(taskId: string) {
  if (workspaceQuery.state.value.taskId !== taskId) return;
  const message = '无权访问非直属员工的团队任务';
  hydratedTeamTask.value = undefined;
  teamDetailError.value = message;
  await workspaceQuery.update({ taskId: undefined });
  ElMessage.warning(message);
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
    if (!detail) {
      hydratedTeamTask.value = undefined;
      return;
    }
    if (!isAssignedTeamManager(detail)) {
      await denyTeamTaskAccess(taskId);
      return;
    }
    hydratedTeamTask.value = toTeamTaskItem(detail, workspaceQuery.state.value.stage);
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
    teamStagePendingCounts.value = {
      ...teamStagePendingCounts.value,
      [state.stage]: response.counts.pending,
    };
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

async function loadTeamStageSummaries() {
  if (!isManagerCapable.value) return;
  const requestId = ++teamStageSummaryRequestSerial;
  const state = workspaceQuery.state.value;
  const personalCycleId = quickFilter.value === 'cycle' ? selectedCycleId.value : undefined;
  const filters = {
    cycleId: activeScope.value === 'team' ? state.cycleId : personalCycleId,
    deptId: state.deptId,
    employeeId: state.employeeId,
  };
  const results = await Promise.allSettled(
    teamStageTabs.map((stage) => tasksApi.findTeam({
      stage: stage.key,
      page: 1,
      pageSize: 1,
      ...filters,
    })),
  );
  if (requestId !== teamStageSummaryRequestSerial) return;
  const next: Record<TeamTaskStage, number | undefined> = {
    'goal-review': undefined,
    'manager-eval': undefined,
  };
  results.forEach((result, index) => {
    const stage = teamStageTabs[index];
    if (stage && result.status === 'fulfilled') {
      next[stage.key] = result.value.counts.pending;
    }
  });
  teamStagePendingCounts.value = next;
}

function teamStageSummaryLabel(stage: TeamTaskStage): string {
  const pending = teamStagePendingCounts.value[stage];
  if (pending === undefined) return '-';
  return pending > 0 ? `待处理 ${pending}` : '已完成';
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

function taskListReturnTo(): string {
  return route.fullPath === '/tasks' || route.fullPath.startsWith('/tasks?')
    ? route.fullPath
    : '/tasks';
}

function goDetail(row: unknown) {
  const item = row as TaskListItem;
  router.push({
    name: 'TaskDetail',
    params: { id: item.id },
    query: { returnTo: taskListReturnTo() },
  });
}

function goSelectedTeamDetail() {
  const item = selectedTeamTask.value;
  if (!item || !auth.user?.id || item.managerId !== auth.user.id) return;
  router.push({
    name: 'TaskDetail',
    params: { id: item.id },
    query: { returnTo: taskListReturnTo() },
  });
}

async function updateTeamContext(patch: Parameters<typeof workspaceQuery.update>[0]) {
  await teamListRef.value?.clearSelection();
  teamBatchResult.value = undefined;
  await workspaceQuery.update(patch);
}

function selectManagerPersonalStage(stage: Exclude<TaskStageKey, 'all'>) {
  selectStage(stage);
  if (activeScope.value !== 'mine') {
    void updateTeamContext({ scope: 'mine', taskId: undefined, employeeId: undefined });
  }
}

function selectManagerTeamStage(stage: TeamTaskStage) {
  void updateTeamContext({
    scope: 'team',
    stage,
    stageState: stage === workspaceQuery.state.value.stage
      ? workspaceQuery.state.value.stageState
      : 'pending',
    taskId: undefined,
  });
}

function setTeamStageState(stageState: TeamStageState | undefined) {
  void updateTeamContext({ stageState, taskId: undefined });
}

function setTeamCycle(value: string) {
  void updateTeamContext({ cycleId: value || undefined, taskId: undefined });
}

function onManagerCycleChange(value: string) {
  if (activeScope.value === 'team') {
    setTeamCycle(value);
    return;
  }
  selectedCycleId.value = value;
  onCycleChange(value);
  void loadTeamStageSummaries();
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
  teamBatchRequestBusy.value = true;
  try {
    const result = await tasksApi.batchApproveIndicators({ tasks });
    await applyBatchResult(actionLabel, result, labels, contextKey);
    if (tasks.some(({ taskId }) => taskId === workspaceQuery.state.value.taskId)) {
      await goalReviewRef.value?.reload();
    }
  } catch (error) {
    await handleBatchRequestError(actionLabel, tasks, labels, contextKey, error);
  } finally {
    teamBatchRequestBusy.value = false;
  }
}

async function executeTeamRejection(
  tasks: TeamTaskVersion[],
  reason: string,
  actionLabel: string,
) {
  const labels = batchItemLabels(tasks);
  const contextKey = teamContextKey();
  teamBatchRequestBusy.value = true;
  try {
    const result = await tasksApi.batchRejectIndicators({ tasks, reason });
    await applyBatchResult(actionLabel, result, labels, contextKey);
    if (tasks.some(({ taskId }) => taskId === workspaceQuery.state.value.taskId)) {
      await goalReviewRef.value?.reload();
    }
  } catch (error) {
    await handleBatchRequestError(actionLabel, tasks, labels, contextKey, error);
  } finally {
    teamBatchRequestBusy.value = false;
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
  const busyRequestId = ++singleOperationSerial;
  const requestId = ++saveRequestSerial;
  latestSaveRequestByTask.set(payload.taskId, {
    requestId,
    operationToken: payload.operationToken,
  });
  teamSingleRequestBusy.value = true;
  const isLatestTaskSave = () => {
    const latest = latestSaveRequestByTask.get(payload.taskId);
    return latest?.requestId === requestId && latest.operationToken === payload.operationToken;
  };
  try {
    const updatedTask = await tasksApi.setIndicators(payload.taskId, {
      ...payload.body,
      expectedUpdatedAt: payload.expectedUpdatedAt,
    });
    if (!isLatestTaskSave() || updatedTask.id !== payload.taskId) return;
    const listItem = teamPage.value.items.find((item) => item.id === payload.taskId);
    if (listItem && updatedTask.updatedAt) listItem.updatedAt = updatedTask.updatedAt;
    if (hydratedTeamTask.value?.id === payload.taskId && updatedTask.updatedAt) {
      hydratedTeamTask.value.updatedAt = updatedTask.updatedAt;
    }
    if (workspaceQuery.state.value.taskId !== payload.taskId) return;
    const acknowledgement = goalReviewRef.value?.acknowledgeSavedTask(updatedTask, {
      operationToken: payload.operationToken,
      draftRevision: payload.draftRevision,
    });
    if (acknowledgement === 'replaced') ElMessage.success('指标修改已保存');
    if (acknowledgement === 'version-acknowledged') {
      ElMessage.success('先前修改已保存，当前草稿仍有未保存内容');
    }
  } catch (error) {
    if (
      isLatestTaskSave()
      && workspaceQuery.state.value.taskId === payload.taskId
    ) ElMessage.error(httpErrorMessage(error, '指标修改保存失败'));
  } finally {
    if (busyRequestId === singleOperationSerial) teamSingleRequestBusy.value = false;
  }
}

async function executeSingleGoalReview(
  task: TeamTaskVersion,
  actionLabel: string,
  submit: () => Promise<BatchReviewResult>,
) {
  const item = teamPage.value.items.find((candidate) => candidate.id === task.taskId)
    ?? (hydratedTeamTask.value?.id === task.taskId ? hydratedTeamTask.value : undefined);
  if (!item || !auth.user?.id || item.managerId !== auth.user.id) {
    ElMessage.warning('无权处理非直属员工的团队任务');
    return;
  }
  const requestId = ++singleOperationSerial;
  const contextKey = teamContextKey();
  const labels = batchItemLabels([task]);
  teamSingleRequestBusy.value = true;
  const isCurrentRequest = () => (
    requestId === singleOperationSerial
    && contextKey === teamContextKey()
    && workspaceQuery.state.value.taskId === task.taskId
  );
  try {
    const result = await submit();
    if (!isCurrentRequest()) return;
    await applyBatchResult(actionLabel, result, labels, contextKey);
    if (isCurrentRequest()) await goalReviewRef.value?.reload();
  } catch (error) {
    if (!isCurrentRequest()) return;
    await handleBatchRequestError(actionLabel, [task], labels, contextKey, error);
  } finally {
    if (requestId === singleOperationSerial) teamSingleRequestBusy.value = false;
  }
}

async function approveSingleGoalReview(payload: GoalReviewActionPayload) {
  const task = { taskId: payload.taskId, updatedAt: payload.expectedUpdatedAt };
  await executeSingleGoalReview(
    task,
    '单项通过',
    () => tasksApi.batchApproveIndicators({ tasks: [task] }),
  );
}

async function rejectSingleGoalReview(payload: GoalReviewRejectPayload) {
  const task = { taskId: payload.taskId, updatedAt: payload.expectedUpdatedAt };
  await executeSingleGoalReview(
    task,
    '单项驳回',
    () => tasksApi.batchRejectIndicators({ tasks: [task], reason: payload.reason }),
  );
}

function handleManagerEvaluationTaskUpdated(detail: TaskDetail) {
  const mapped = toTeamTaskItem(detail, 'manager-eval');
  const index = teamPage.value.items.findIndex((item) => item.id === detail.id);
  const previousStageState = index >= 0 ? teamPage.value.items[index].stageState : undefined;
  if (index >= 0) teamPage.value.items.splice(index, 1, mapped);
  if (hydratedTeamTask.value?.id === detail.id) hydratedTeamTask.value = mapped;
  if (previousStageState && previousStageState !== mapped.stageState) void loadTeam();
}

onMounted(async () => {
  const cyclesRequest = loadCycles();
  if (activeScope.value === 'team') {
    await cyclesRequest;
    await Promise.all([
      loadTeam(),
      isManagerCapable.value ? loadList({ silent: true }) : Promise.resolve(),
      loadTeamStageSummaries(),
    ]);
  } else {
    if (isManagerCapable.value && selectedStage.value === 'all') {
      selectedStage.value = 'goal-setting';
    }
    await cyclesRequest;
    selectedCycleId.value = '';
    quickFilter.value = 'all';
    await Promise.all([
      loadList(),
      isManagerCapable.value ? loadTeamStageSummaries() : Promise.resolve(),
    ]);
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
    const summaryFiltersChanged = current.cycleId !== previous.cycleId
      || current.deptId !== previous.deptId
      || current.employeeId !== previous.employeeId;
    if (current.scope === 'team') {
      await Promise.all([
        loadTeam(),
        isManagerCapable.value && summaryFiltersChanged
          ? loadTeamStageSummaries()
          : Promise.resolve(),
      ]);
    } else {
      if (previous.scope !== 'mine') await loadList();
      if (isManagerCapable.value && summaryFiltersChanged) await loadTeamStageSummaries();
    }
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
    singleOperationSerial += 1;
    teamSingleRequestBusy.value = false;
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
      <el-tag v-if="activeScope === 'mine'" type="info" effect="plain">{{ selectedCycleName }}</el-tag>
    </template>

    <template #context>
      <PerformanceContextPanel v-if="isManagerCapable" title="绩效阶段">
        <div data-testid="manager-task-navigation" class="task-context">
          <div class="task-context__cycle">
            <div class="task-context__label">
              <el-icon><Calendar /></el-icon>
              <span>考核周期</span>
            </div>
            <el-select
              :model-value="activeScope === 'team'
                ? workspaceQuery.state.value.cycleId || ''
                : selectedCycleId"
              :data-testid="activeScope === 'team' ? 'team-cycle-filter' : 'task-cycle-filter'"
              aria-label="考核周期"
              placeholder="选择考核周期"
              @change="onManagerCycleChange"
            >
              <el-option label="全部考核周期" value="" />
              <el-option v-if="activeScope === 'mine'" label="仅看待办任务" value="__pending__" />
              <el-option
                v-for="cycle in cycles"
                :key="cycle.id"
                :label="cycle.name"
                :value="cycle.id"
              />
            </el-select>
          </div>

          <div
            class="task-context__group manager-task-group"
            data-testid="manager-personal-task-group"
          >
            <div class="task-context__label">
              <el-icon><UserFilled /></el-icon>
              <span>我的绩效待办</span>
            </div>

            <div class="task-stage-list">
              <button
                v-for="stage in taskStages"
                :key="stage.key"
                type="button"
                class="task-stage-item"
                :class="{ 'is-active': activeScope === 'mine' && selectedStage === stage.key }"
                :data-testid="`task-stage-${stage.key}`"
                :aria-pressed="activeScope === 'mine' && selectedStage === stage.key"
                @click="selectManagerPersonalStage(stage.key)"
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

          <div
            class="task-context__group manager-task-group"
            data-testid="manager-team-task-group"
          >
            <div class="task-context__label">
              <el-icon><DocumentChecked /></el-icon>
              <span>我团队的绩效待办</span>
            </div>
            <div class="task-stage-list">
              <button
                v-for="stage in teamStageTabs"
                :key="stage.key"
                type="button"
                class="task-stage-item"
                :class="{
                  'is-active': activeScope === 'team'
                    && workspaceQuery.state.value.stage === stage.key,
                }"
                :data-testid="`manager-team-stage-${stage.key}`"
                :aria-pressed="activeScope === 'team'
                  && workspaceQuery.state.value.stage === stage.key"
                @click="selectManagerTeamStage(stage.key)"
              >
                <span>{{ stage.label }}</span>
                <span
                  class="task-stage-item__state"
                  :class="{ 'is-pending': (teamStagePendingCounts[stage.key] ?? 0) > 0 }"
                >
                  {{ teamStageSummaryLabel(stage.key) }}
                </span>
              </button>
            </div>
          </div>
        </div>
      </PerformanceContextPanel>

      <PerformanceContextPanel v-else title="绩效阶段">
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
      <header class="team-workspace__header">
        <div>
          <span>绩效环节</span>
          <h2>{{ workspaceQuery.state.value.stage === 'goal-review' ? '指标审核' : '主管评分' }}</h2>
        </div>
        <span>待办人：直属员工</span>
      </header>

      <section
        class="team-workspace__filters"
        data-testid="team-workspace-filters"
        aria-label="团队任务筛选"
      >
        <div class="team-count-tabs team-count-tabs--workspace" aria-label="处理状态">
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

        <div class="team-toolbar">
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
          <el-tooltip content="重置筛选" placement="top">
            <el-button
              class="team-toolbar__reset"
              :icon="RefreshLeft"
              aria-label="重置筛选"
              @click="resetTeamFilters"
            />
          </el-tooltip>
        </div>
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
          'is-manager-eval': workspaceQuery.state.value.taskId
            && workspaceQuery.state.value.stage === 'manager-eval',
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
          :current-manager-id="auth.user?.id"
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
          @view-detail="goSelectedTeamDetail"
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
          <template
            v-else-if="workspaceQuery.state.value.stage === 'manager-eval' && selectedTeamTask"
            #workspace
          >
            <ManagerEvaluationWorkspace
              :task-id="workspaceQuery.state.value.taskId"
              @task-updated="handleManagerEvaluationTaskUpdated"
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

.team-count-tabs button {
  border: 0;
  color: #596376;
  background: transparent;
  font-size: 12px;
  cursor: pointer;
}

.manager-task-group + .manager-task-group {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid #edf0f4;
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

.team-count-tabs--workspace {
  flex-flow: row wrap;
  gap: 8px;
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

.team-count-tabs--workspace button {
  min-width: 96px;
  border: 1px solid #e2e6ed;
  background: #f7f9fc;
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

.team-workspace__header {
  min-height: 68px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
  padding: 10px 14px;
  border: 1px solid #e2e6ed;
  border-radius: 7px;
  background: #fff;
}

.team-workspace__header > div {
  min-width: 0;
}

.team-workspace__header h2 {
  margin: 3px 0 0;
  color: #20283a;
  font-size: 18px;
}

.team-workspace__header span {
  color: #70798a;
  font-size: 12px;
}

.team-workspace__filters {
  margin-bottom: 10px;
  padding: 10px;
  border: 1px solid #e2e6ed;
  border-radius: 7px;
  background: #fff;
}

.team-toolbar {
  min-height: 50px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #edf0f4;
}

.team-search-control {
  width: min(280px, 100%);
}

.team-search-control :deep(.el-input) {
  width: 100%;
}

.team-toolbar .team-filter-control {
  width: min(190px, 100%);
}

.team-toolbar .team-filter-control :deep(.el-select) {
  width: 100%;
}

.team-toolbar__reset {
  flex-shrink: 0;
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

.team-layout.has-detail.is-goal-review,
.team-layout.has-detail.is-manager-eval {
  grid-template-columns: minmax(0, 1fr);
}

.team-layout.has-detail.is-goal-review :deep(.team-member-rail),
.team-layout.has-detail.is-manager-eval :deep(.team-member-rail) {
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

  .team-workspace__header {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .team-toolbar {
    flex-wrap: wrap;
  }

  .team-search-control {
    width: 100%;
  }

  .team-search-control :deep(.el-input) {
    width: 100%;
  }

  .team-toolbar .team-filter-control {
    width: 100%;
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
