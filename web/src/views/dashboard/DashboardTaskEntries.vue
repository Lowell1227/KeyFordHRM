<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { cyclesApi } from '@/api/cycles.api';
import { tasksApi } from '@/api/tasks.api';
import { useAuthStore } from '@/stores/auth.store';
import { getEmployeeTaskStageState, isTerminalTaskStatus, resolveEmployeeTaskEntry } from '@/views/task/task-stage';
import type { AssessmentCycle, TaskListItem } from '@/types/api.types';
import type { TeamTaskStage } from '@/types/enums';

const auth = useAuthStore();
const router = useRouter();
const selectedPlanId = ref('');
const cycles = ref<AssessmentCycle[]>([]);
const personalTasks = ref<TaskListItem[]>([]);
const loading = ref(false);
const personalError = ref(false);
const cyclesError = ref(false);
const stages: Array<{ key: TeamTaskStage; label: string; testId: string }> = [
  { key: 'goal-review', label: '目标审核', testId: 'goal-review' },
  { key: 'manager-eval', label: '上级评价', testId: 'evaluation' },
];
interface TeamCount { pending: number | null; all: number; loading: boolean; error: boolean }
type CycleTeamCounts = Record<TeamTaskStage, TeamCount>;
const teamCounts = ref<Record<string, CycleTeamCounts>>({});
let requestSerial = 0;

const openTasks = computed(() => personalTasks.value.filter((task) => (
  !task.isExempt && !isTerminalTaskStatus(task.status)
  && !cycles.value.some((cycle) => cycle.id === task.cycleId && ['draft', 'scheduled', 'launch_blocked', 'closed'].includes(cycle.status))
)));
const candidatePlans = computed(() => {
  const plans = new Map<string, { id: string; name: string; status?: AssessmentCycle['status'] }>();
  if (auth.isManager) {
    for (const cycle of cycles.value) {
      if (!['draft', 'scheduled', 'launch_blocked', 'closed'].includes(cycle.status)) {
        plans.set(cycle.id, { id: cycle.id, name: cycle.name, status: cycle.status });
      }
    }
  }
  for (const task of openTasks.value) {
    const cycle = cycles.value.find((item) => item.id === task.cycleId);
    plans.set(task.cycleId, { id: task.cycleId, name: cycle?.name || task.cycleName || '考核计划', status: cycle?.status });
  }
  return [...plans.values()];
});
const plans = computed(() => candidatePlans.value.map((plan) => {
  const tasks = openTasks.value.filter((task) => task.cycleId === plan.id).map((task) => {
    const entry = resolveEmployeeTaskEntry(task);
    return { task, entry, actionable: Boolean(entry.actionPath) || getEmployeeTaskStageState(task, entry.stage) === 'pending' };
  }).sort((a, b) => Number(b.actionable) - Number(a.actionable));
  const team = teamCounts.value[plan.id];
  const teamPending = stages.reduce((sum, stage) => sum + (team?.[stage.key].pending ?? 0), 0);
  // A partly published plan can still contain unfinished tasks for other team members.
  const hasPublishedResults = plan.status === 'published' || plan.status === 'appeal';
  const teamHasTasks = auth.isManager && team && stages.some((stage) => (
    team[stage.key].loading || team[stage.key].error
    || (hasPublishedResults ? (team[stage.key].pending ?? 0) > 0 : team[stage.key].all > 0)
  ));
  return { ...plan, tasks, team, teamPending, visible: tasks.length > 0 || teamHasTasks,
    priority: tasks.some((item) => item.actionable) ? 0 : teamPending > 0 ? 1 : 2 };
}).filter((plan) => plan.visible).sort((a, b) => a.priority - b.priority));
const visiblePlans = computed(() => selectedPlanId.value
  ? plans.value.filter((plan) => plan.id === selectedPlanId.value)
  : plans.value);

watch(plans, (availablePlans) => {
  if (selectedPlanId.value && !availablePlans.some((plan) => plan.id === selectedPlanId.value)) {
    selectedPlanId.value = '';
  }
});

async function loadPersonalTasks(requestId: number) {
  try {
    const items: TaskListItem[] = [];
    let page = 1;
    while (requestId === requestSerial) {
      const response = await tasksApi.findMine({ page, pageSize: 100 });
      if (requestId !== requestSerial) return;
      items.push(...response.items);
      if (!response.items.length || items.length >= response.total) break;
      page += 1;
    }
    personalTasks.value = [...new Map(items.map((task) => [task.id, task])).values()];
  } catch {
    if (requestId === requestSerial) personalError.value = true;
  }
}

async function loadCycles(requestId: number) {
  try {
    const response = await cyclesApi.findMine();
    if (requestId === requestSerial) cycles.value = response;
  } catch {
    if (requestId === requestSerial) cyclesError.value = true;
  }
}

async function loadTeamCount(requestId: number, cycleId: string, stage: TeamTaskStage) {
  try {
    const response = await tasksApi.findTeam({ page: 1, pageSize: 1, cycleId, stage });
    if (requestId !== requestSerial) return;
    teamCounts.value[cycleId]![stage] = { pending: response.counts.pending, all: response.counts.all, loading: false, error: false };
  } catch {
    if (requestId !== requestSerial) return;
    teamCounts.value[cycleId]![stage] = { pending: null, all: 0, loading: false, error: true };
  }
}

async function loadEntries() {
  const requestId = ++requestSerial;
  selectedPlanId.value = '';
  cycles.value = [];
  personalTasks.value = [];
  teamCounts.value = {};
  personalError.value = false;
  cyclesError.value = false;
  loading.value = Boolean(auth.user);
  if (!auth.user) return;
  await Promise.all([loadPersonalTasks(requestId), loadCycles(requestId)]);
  if (requestId !== requestSerial) return;
  if (auth.isManager) {
    const candidates = candidatePlans.value;
    for (const plan of candidates) {
      teamCounts.value[plan.id] = {
        'goal-review': { pending: null, all: 0, loading: true, error: false },
        'manager-eval': { pending: null, all: 0, loading: true, error: false },
      };
    }
    // Each response belongs to a plan; selecting another plan cannot replace its counts.
    for (const plan of candidates) {
      for (const stage of stages) void loadTeamCount(requestId, plan.id, stage.key);
    }
  }
  loading.value = false;
}

function openPersonalTask(task: TaskListItem) {
  const entry = resolveEmployeeTaskEntry(task);
  if (entry.actionPath) {
    void router.push({ path: entry.actionPath, query: { cycleId: task.cycleId } });
    return;
  }
  void router.push({ name: 'TaskDetail', params: { id: task.id }, query: {
    cycleId: task.cycleId, returnTo: '/tasks',
    ...(entry.periodId ? { stage: entry.stage, periodId: entry.periodId } : {}),
  } });
}

function openTeamWorkspace(cycleId: string, stage: TeamTaskStage) {
  void router.push({ path: '/tasks', query: { scope: 'team', stage, cycleId } });
}

watch(() => [auth.user?.id, auth.user?.sysRole, auth.isManager], () => void loadEntries(), { immediate: true });
onUnmounted(() => { requestSerial += 1; });
</script>

<template>
  <section class="dashboard-tasks" aria-label="当前周期待办">
    <header class="dashboard-tasks__header">
      <div>
        <h2>当前周期待办</h2>
        <p>按计划查看本人任务{{ auth.isManager ? '和团队待办' : '' }}。</p>
      </div>
      <label class="dashboard-tasks__filter">
        <span>考核计划</span>
        <select v-model="selectedPlanId" aria-label="考核计划" :disabled="loading">
          <option value="">全部进行中</option>
          <option v-for="plan in plans" :key="plan.id" :value="plan.id">{{ plan.name }}</option>
        </select>
      </label>
    </header>
    <el-skeleton v-if="loading" :rows="3" animated />
    <template v-else>
      <el-alert v-if="personalError" title="个人任务暂时无法加载，请稍后重试。" type="warning" :closable="false" />
      <el-alert v-if="cyclesError" title="计划列表暂时无法加载，当前仅展示已读取的本人任务计划。" type="warning" :closable="false" />
      <article v-for="plan in visiblePlans" :key="plan.id" class="plan-entry" data-testid="dashboard-cycle-entry" :data-cycle-id="plan.id">
        <h3>{{ plan.name }}</h3>
        <div class="plan-entry__tasks" :class="{ 'plan-entry__tasks--team': auth.isManager }">
          <div :data-testid="auth.isManager ? 'manager-personal-task' : 'employee-current-task'" class="personal-tasks">
            <span class="task-label">我的任务</span>
            <div v-for="item in plan.tasks" :key="item.task.id" :data-testid="`dashboard-personal-${item.task.id}`" class="personal-task">
              <div class="personal-task__body">
                <strong>{{ item.entry.label }}</strong>
                <span v-if="item.entry.progressLabel" class="task-progress">{{ item.entry.progressLabel }}</span>
                <span v-if="item.entry.hintLabel" class="task-note">{{ item.entry.hintLabel }}</span>
              </div>
              <el-button data-testid="employee-current-task-open" :type="item.actionable ? 'primary' : 'default'" @click="openPersonalTask(item.task)">{{ item.entry.actionLabel }}</el-button>
            </div>
            <span v-if="!plan.tasks.length" class="task-note">{{ personalError ? '个人任务暂时无法加载' : '当前没有个人绩效任务' }}</span>
          </div>
          <template v-if="auth.isManager">
            <div v-for="stage in stages" :key="stage.key" class="team-task" :data-testid="`manager-${stage.testId}-card`" :aria-busy="plan.team?.[stage.key].loading">
              <span class="task-label">团队{{ stage.label }}</span>
              <el-skeleton v-if="plan.team?.[stage.key].loading" :rows="1" animated />
              <span v-else-if="plan.team?.[stage.key].error" class="task-note">{{ stage.label }}待办暂时无法加载。</span>
              <template v-else-if="plan.team">
                <div class="team-task__action">
                  <span><strong :data-testid="`manager-${stage.testId}-count`">{{ plan.team[stage.key].pending }}</strong><span class="task-note"> 项待办</span></span>
                  <el-button :data-testid="`manager-${stage.testId}-open`" text type="primary" @click="openTeamWorkspace(plan.id, stage.key)">{{ plan.team[stage.key].pending === 0 ? '查看全部' : '处理' }}</el-button>
                </div>
              </template>
            </div>
          </template>
        </div>
      </article>
      <p v-if="!visiblePlans.length && !personalError && !cyclesError" class="dashboard-tasks__empty">当前没有进行中的本人任务{{ auth.isManager ? '或团队任务' : '' }}。</p>
    </template>
  </section>
</template>

<style scoped>
.dashboard-tasks { display: grid; gap: 12px; min-width: 0; }
.dashboard-tasks__header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.dashboard-tasks__header h2 { margin: 0 0 4px; font-size: 18px; }
.dashboard-tasks__header p, .dashboard-tasks__empty { margin: 0; color: var(--app-text-secondary); font-size: 13px; }
.dashboard-tasks__filter { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; }
.dashboard-tasks__filter > span { flex-shrink: 0; }
.dashboard-tasks__filter select { width: 280px; min-width: 0; height: 34px; padding: 0 28px 0 10px; color: var(--app-text-primary); background: var(--app-card-bg); border: 1px solid var(--app-border-color); border-radius: 4px; font: inherit; }
.dashboard-tasks__filter select:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.plan-entry { min-width: 0; padding: 16px 18px; background: var(--app-card-bg); border: 1px solid var(--app-border-color); border-radius: var(--app-radius); }
.plan-entry h3 { margin: 0 0 14px; color: var(--app-text-primary); font-size: 15px; line-height: 1.5; overflow-wrap: anywhere; }
.plan-entry__tasks { display: grid; gap: 18px; }
.plan-entry__tasks--team { grid-template-columns: minmax(0, 2fr) repeat(2, minmax(0, 1fr)); }
.personal-tasks, .team-task { display: grid; align-content: start; gap: 8px; min-width: 0; }
.personal-task, .team-task__action { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
.personal-task__body { display: grid; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
.personal-task__body strong { font-size: 16px; }
.task-label, .task-note { color: var(--app-text-secondary); font-size: 13px; }
.task-progress { color: var(--app-primary-color); font-size: 13px; }
.team-task { border-left: 1px solid var(--app-border-color); padding-left: 18px; }
.team-task__action strong { font-size: 22px; }
.dashboard-tasks__empty { padding: 20px; background: var(--app-card-bg); border: 1px solid var(--app-border-color); border-radius: var(--app-radius); }
@media (max-width: 1000px) {
  .plan-entry__tasks--team { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .personal-tasks { grid-column: 1 / -1; }
  .team-task { padding-left: 0; border-left: 0; padding-top: 12px; border-top: 1px solid var(--app-border-color); }
}
@media (max-width: 560px) {
  .dashboard-tasks__header { align-items: stretch; flex-direction: column; gap: 12px; }
  .dashboard-tasks__filter select { flex: 1; width: 0; }
  .plan-entry { padding: 14px; }
  .plan-entry__tasks--team { grid-template-columns: 1fr; gap: 12px; }
  .personal-task { align-items: flex-start; flex-direction: column; }
}
</style>
