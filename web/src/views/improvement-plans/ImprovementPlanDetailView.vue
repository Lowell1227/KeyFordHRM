<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { isAxiosError } from 'axios';
import { ElMessage } from 'element-plus';
import { improvementPlansApi } from '@/api/improvement-plans.api';
import { IMPROVEMENT_PLAN_STATUS_META } from '@/types/enums';
import { formatDate, formatDateTime } from '@/utils/date';
import ChartCard from '@/components/common/ChartCard.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import type { ImprovementEvaluation, ImprovementGoal, ImprovementGoalSuggestion, ImprovementPlan, ImprovementPlanRecord } from '@/types/api.types';

const route = useRoute();
const router = useRouter();
const plan = ref<ImprovementPlan | null>(null);
const cycles = ref<Array<{ id: string; name: string }>>([]);
const loading = ref(false);
const busy = ref(false);
const decisionComment = ref('');
type DecisionDialogAction = 'goals-approve' | 'goals-reject' | 'final-approve' | 'final-reject';
const decisionDialogOpen = ref(false);
const decisionDialogAction = ref<DecisionDialogAction>('goals-approve');
const goalSuggestions = reactive<Record<string, string>>({});
const errors = reactive<Record<string, string>>({});
const form = reactive<{ improvementNeed: string; cycleId: string; targetDate: string; goals: ImprovementGoal[] }>({
  improvementNeed: '', cycleId: '', targetDate: '', goals: [],
});
const evaluation = reactive<{ items: Array<{ goalId: string; score: number | null; comment: string }>; overallComment: string }>({
  items: [], overallComment: '',
});
const canEdit = computed(() => plan.value?.allowedActions.includes('edit') ?? false);
const canDecideGoals = computed(() => plan.value?.allowedActions.includes('decide_goals') ?? false);
const employeeGoalConfirmation = computed(() => canDecideGoals.value && plan.value?.status === 'goal_employee_confirm');
const latestGoalRejection = computed(() => plan.value?.status === 'goal_revision'
  ? plan.value.records?.find((record) => record.action === 'reject_goals') ?? null : null);
const canEvaluate = computed(() => plan.value?.allowedActions.includes('evaluate') ?? false);
const canDecideFinal = computed(() => plan.value?.allowedActions.includes('decide_final') ?? false);
const decisionDialogForGoals = computed(() => decisionDialogAction.value.startsWith('goals-'));
const decisionDialogReject = computed(() => decisionDialogAction.value.endsWith('-reject'));
const decisionDialogTitle = computed(() => {
  if (decisionDialogAction.value === 'goals-approve') return '确认目标';
  if (decisionDialogAction.value === 'goals-reject') return '退回发起人修改';
  if (decisionDialogAction.value === 'final-approve') return '审核确认';
  return '退回直属上级重评';
});
const showEvaluation = computed(() => canEvaluate.value || Boolean(plan.value?.selfEvaluation
  || plan.value?.managerEvaluation || plan.value?.departmentEvaluation));
const currentEvaluationLabel = computed(() => {
  if (plan.value?.status === 'self_eval') return '员工自评';
  if (plan.value?.status === 'manager_review') return '直属上级评价';
  if (plan.value?.status === 'dept_review') return '部门负责人评价';
  return '评价';
});
const weightTotal = computed(() => form.goals.reduce((sum, goal) => sum + Number(goal.weight || 0), 0));
const draftTotal = computed(() => {
  if (!plan.value || evaluation.items.some((item) => item.score === null || item.score === undefined)) return null;
  return Math.round(plan.value.goals.reduce((sum, goal) => sum + goal.weight * Number(evaluation.items.find((item) => item.goalId === goal.id)?.score ?? 0), 0)) / 100;
});
const deadlineHint = computed(() => {
  if (!plan.value?.targetDate || plan.value.status === 'completed') return '';
  const date = new Date(`${plan.value.targetDate.slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const remaining = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (remaining < 0) return '已超过预计完成日期，仍可继续提交和办理';
  if (remaining <= 7) return remaining === 0 ? '预计今天完成，仍可按流程提交' : `距离预计完成日期还有 ${remaining} 天`;
  return '';
});

onMounted(async () => {
  cycles.value = await improvementPlansApi.cycles().catch(() => []);
  await load();
});
async function load() {
  const id = String(route.params.id || '');
  if (!id) return;
  loading.value = true;
  try { sync(await improvementPlansApi.getDetail(id)); } finally { loading.value = false; }
}
function sync(value: ImprovementPlan) {
  plan.value = value;
  form.improvementNeed = value.improvementNeed ?? '';
  form.cycleId = value.cycleId ?? '';
  form.targetDate = value.targetDate?.slice(0, 10) ?? '';
  form.goals = value.goals?.map((goal) => ({ ...goal })) ?? [];
  const previous = value.status === 'self_eval' ? value.selfEvaluation
    : value.status === 'manager_review' ? value.managerEvaluation
      : value.status === 'dept_review' ? value.departmentEvaluation : null;
  evaluation.items = value.goals.map((goal) => ({ goalId: goal.id,
    score: previous?.items.find((item) => item.goalId === goal.id)?.score ?? null,
    comment: previous?.items.find((item) => item.goalId === goal.id)?.comment ?? '',
  }));
  evaluation.overallComment = previous?.overallComment ?? '';
  decisionDialogOpen.value = false;
  decisionComment.value = '';
  Object.keys(goalSuggestions).forEach((key) => delete goalSuggestions[key]);
  Object.keys(errors).forEach((key) => delete errors[key]);
}
function addGoal() { form.goals.push({ id: crypto.randomUUID(), name: '', description: '', weight: 0 }); }
function removeGoal(index: number) { form.goals.splice(index, 1); }
function validateTargets() {
  Object.keys(errors).forEach((key) => delete errors[key]);
  if (!form.improvementNeed.trim()) errors.background = '请填写改进背景';
  if (!form.goals.length) errors.goals = '至少添加一项目标';
  form.goals.forEach((goal, index) => {
    if (!goal.name.trim()) errors[`name-${index}`] = '请填写目标名称';
    if (!goal.description.trim()) errors[`description-${index}`] = '请填写目标描述';
    if (!(Number(goal.weight) > 0 && Number(goal.weight) <= 100)) errors[`weight-${index}`] = '权重须大于 0 且不超过 100%';
  });
  if (Math.abs(weightTotal.value - 100) > 0.001) errors.total = '目标权重合计必须为 100%';
  return !Object.keys(errors).length;
}
function draftBody() { return { improvementNeed: form.improvementNeed, cycleId: form.cycleId || null,
  targetDate: form.targetDate || null, goals: form.goals }; }
async function saveTargets(submit: boolean) {
  if (!plan.value || (submit && !validateTargets())) return;
  busy.value = true;
  try {
    await improvementPlansApi.update(plan.value.id, draftBody());
    const updated = submit ? await improvementPlansApi.submitGoals(plan.value.id) : await improvementPlansApi.getDetail(plan.value.id);
    sync(updated);
    ElMessage.success(submit ? '目标已提交，等待部门负责人或员工确认' : '草稿已保存');
  } finally { busy.value = false; }
}
async function decideGoals(approve: boolean) {
  if (!plan.value) return;
  delete errors.decision;
  const suggestions = !approve && employeeGoalConfirmation.value ? plan.value.goals
    .map((goal) => ({ goalId: goal.id, comment: goalSuggestions[goal.id]?.trim() ?? '' }))
    .filter((item) => item.comment) : [];
  if (!approve && !decisionComment.value.trim() && !suggestions.length) {
    errors.decision = employeeGoalConfirmation.value ? '请填写具体目标建议或整体意见' : '退回时请填写理由'; return;
  }
  busy.value = true;
  const id = plan.value.id;
  const expectedStatus = approve
    ? plan.value.status === 'goal_dept_review' ? 'goal_employee_confirm' : 'self_eval'
    : 'goal_revision';
  try {
    sync(await improvementPlansApi.decideGoals(id, { approve, comment: approve ? '' : decisionComment.value,
      ...(suggestions.length ? { suggestions } : {}) }));
    ElMessage.success(approve ? '目标已确认' : '目标已退回发起人修改');
  } catch (error) {
    if (isAxiosError(error) && !error.response) {
      try {
        const updated = await improvementPlansApi.getDetail(id);
        if (updated.status === expectedStatus) {
          sync(updated);
          ElMessage.success(approve ? '目标已确认' : '目标已退回发起人修改');
          return;
        }
      } catch { /* 下面统一提示当前结果无法确认。 */ }
      ElMessage.error('处理结果暂未确认，请刷新页面查看，避免重复提交');
      return;
    }
    const message = isAxiosError<{ message?: string }>(error)
      ? error.response?.data?.message
      : error instanceof Error ? error.message : null;
    ElMessage.error(typeof message === 'string' && message.trim() ? message : '操作未完成，请稍后重试');
  } finally { busy.value = false; }
}
function validateEvaluation() {
  Object.keys(errors).forEach((key) => delete errors[key]);
  evaluation.items.forEach((item, index) => {
    if (item.score === null || item.score < 0 || item.score > 100) errors[`score-${index}`] = '请填写 0 至 100 分';
    if (!item.comment.trim()) errors[`comment-${index}`] = '请填写该目标评价内容';
  });
  if (!evaluation.overallComment.trim()) errors.overall = '请填写总体评价内容';
  return !Object.keys(errors).length;
}
async function saveEvaluation(submit: boolean) {
  if (!plan.value || (submit && !validateEvaluation())) return;
  busy.value = true;
  try {
    const body = { items: evaluation.items, overallComment: evaluation.overallComment };
    sync(submit ? await improvementPlansApi.evaluate(plan.value.id, body)
      : await improvementPlansApi.saveEvaluation(plan.value.id, body));
    ElMessage.success(submit ? '评价已提交' : '评价草稿已保存');
  } finally { busy.value = false; }
}
async function decideFinal(approve: boolean) {
  if (!plan.value) return;
  if (!approve && !decisionComment.value.trim()) { errors.decision = '驳回时请填写理由'; return; }
  busy.value = true;
  try {
    sync(await improvementPlansApi.decideFinal(plan.value.id, { approve, comment: approve ? '' : decisionComment.value }));
    ElMessage.success(approve ? '改进计划已审核完成' : '已退回当前直属上级重新评价');
  } finally { busy.value = false; }
}
function openDecisionDialog(action: DecisionDialogAction) {
  delete errors.decision;
  decisionDialogAction.value = action;
  decisionDialogOpen.value = true;
}
async function submitDecisionDialog() {
  if (decisionDialogForGoals.value) await decideGoals(!decisionDialogReject.value);
  else await decideFinal(!decisionDialogReject.value);
}
function priorScore(kind: 'self' | 'manager' | 'department', goalId: string) {
  const source = kind === 'self' ? plan.value?.selfEvaluation
    : kind === 'manager' ? plan.value?.managerEvaluation : plan.value?.departmentEvaluation;
  const item = source?.items.find((entry) => entry.goalId === goalId);
  return item ? `${item.score ?? '-'} 分 · ${item.comment}` : '';
}
function actionLabel(record: ImprovementPlanRecord) {
  const labels: Record<string, string> = {
    create: '创建草稿', save_draft: '保存目标草稿', submit_goals: '提交改进目标',
    confirm_goals: '确认目标', reject_goals: '退回目标',
    save_evaluation_draft: '保存评价草稿', submit_selfEvaluation: '提交员工自评',
    submit_managerEvaluation: '提交直属上级评价', submit_departmentEvaluation: '提交部门负责人评价',
    approve_final: '确认改进计划', reject_final: '退回直属上级重评',
  };
  return labels[record.action] ?? record.action;
}
function recordTitle(record: ImprovementPlanRecord) {
  const titles: Record<string, string> = {
    create: '改进目标', save_draft: '改进目标', submit_goals: '改进目标',
    confirm_goals: '目标确认', reject_goals: '目标确认',
    save_evaluation_draft: '评价内容', submit_selfEvaluation: '员工自评',
    submit_managerEvaluation: '直属上级评价', submit_departmentEvaluation: '部门负责人评价',
    approve_final: '分管总审核', reject_final: '分管总审核',
  };
  return titles[record.action] ?? actionLabel(record);
}
function recordTone(record: ImprovementPlanRecord) {
  if (record.action === 'reject_goals' || record.action === 'reject_final') return 'danger';
  if (record.action === 'create' || record.action === 'save_draft' || record.action === 'save_evaluation_draft') return 'neutral';
  return 'success';
}
function recordNote(record: ImprovementPlanRecord) {
  const value = record.newValue;
  const evaluation = value?.evaluation as { overallComment?: string } | undefined;
  return String(value?.comment ?? evaluation?.overallComment ?? '');
}
function recordAuto(record: ImprovementPlanRecord) {
  return record.newValue?.autoDepartmentConfirm ? '部门负责人自动确认'
    : record.newValue?.autoDepartmentEvaluation ? '部门评价自动沿用直属上级评价' : '';
}
function recordGoals(record: ImprovementPlanRecord): ImprovementGoal[] {
  return Array.isArray(record.newValue?.goals) ? record.newValue.goals as ImprovementGoal[] : [];
}
function recordSuggestions(record: ImprovementPlanRecord): ImprovementGoalSuggestion[] {
  return Array.isArray(record.newValue?.suggestions) ? record.newValue.suggestions as ImprovementGoalSuggestion[] : [];
}
function latestSuggestion(goalId: string): string {
  return latestGoalRejection.value
    ? recordSuggestions(latestGoalRejection.value).find((item) => item.goalId === goalId)?.comment ?? '' : '';
}
function recordEvaluation(record: ImprovementPlanRecord): ImprovementEvaluation | null {
  const value = record.newValue?.evaluation;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ImprovementEvaluation : null;
}
function goalName(goalId: string): string {
  return plan.value?.goals.find((goal) => goal.id === goalId)?.name ?? '已调整的目标';
}
</script>

<template>
  <div v-loading="loading" class="improvement-detail page-stack">
    <template v-if="plan">
      <ChartCard class="plan-overview-card">
        <template #title><div class="title-row"><el-button link @click="router.push('/improvement-plans')">返回列表</el-button><strong>绩效改进计划</strong></div></template>
        <template #extra>
          <div class="header-actions">
            <el-tag :type="IMPROVEMENT_PLAN_STATUS_META[plan.status]?.type as any">{{ IMPROVEMENT_PLAN_STATUS_META[plan.status]?.label }}</el-tag>
            <template v-if="canDecideGoals">
              <el-button type="danger" plain :loading="busy" @click="openDecisionDialog('goals-reject')">退回发起人修改</el-button>
              <el-button type="primary" :loading="busy" @click="openDecisionDialog('goals-approve')">确认目标</el-button>
            </template>
            <template v-else-if="canDecideFinal">
              <el-button type="danger" plain :loading="busy" @click="openDecisionDialog('final-reject')">退回直属上级重评</el-button>
              <el-button type="primary" :loading="busy" @click="openDecisionDialog('final-approve')">审核确认</el-button>
            </template>
          </div>
        </template>
        <el-descriptions :column="2" border size="small" class="plan-info">
          <el-descriptions-item label="员工">{{ plan.employeeName }}（{{ plan.employeeNo || '-' }}）</el-descriptions-item>
          <el-descriptions-item label="部门">{{ plan.deptName || '-' }}</el-descriptions-item>
          <el-descriptions-item label="关联周期">{{ plan.cycleName || '未关联' }}</el-descriptions-item>
          <el-descriptions-item label="发起人">{{ plan.creatorName || '-' }}</el-descriptions-item>
          <el-descriptions-item label="预计完成">{{ plan.targetDate ? formatDate(plan.targetDate) : '未设定' }}</el-descriptions-item>
          <el-descriptions-item label="开始执行">{{ plan.startedAt ? formatDateTime(plan.startedAt) : '待目标确认' }}</el-descriptions-item>
        </el-descriptions>
        <el-alert v-if="plan.workflowVersion === 1" type="info" :closable="false" title="历史改进计划记录，仅供查看" />
        <el-alert v-else-if="deadlineHint" type="warning" :closable="false" :title="deadlineHint" />
      </ChartCard>

      <ChartCard data-testid="improvement-content-evaluation">
        <template #title>{{ showEvaluation ? '改进内容与评价' : '改进背景与目标' }}</template>
        <template v-if="canEdit">
          <el-form label-position="top">
            <el-form-item label="改进背景" required>
              <el-input v-model="form.improvementNeed" aria-label="改进背景" type="textarea" :rows="3" maxlength="4000" />
              <small v-if="errors.background" class="field-error">{{ errors.background }}</small>
            </el-form-item>
            <div class="plan-fields">
              <el-form-item label="关联绩效周期计划（选填）">
                <el-select v-model="form.cycleId" aria-label="关联绩效周期计划" clearable placeholder="不关联">
                  <el-option v-for="cycle in cycles" :key="cycle.id" :label="cycle.name" :value="cycle.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="预计完成日期（选填）"><el-date-picker v-model="form.targetDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" /></el-form-item>
            </div>
          </el-form>
        </template>
        <p v-else class="background-text">{{ plan.improvementNeed || '未填写改进背景' }}</p>
        <div v-if="canEdit && latestGoalRejection && recordNote(latestGoalRejection)" class="feedback-note">
          <b>上轮整体意见</b><span>{{ recordNote(latestGoalRejection) }}</span>
        </div>
        <div class="section-heading"><strong>改进目标</strong><span>权重合计 {{ canEdit ? weightTotal : plan.goals.reduce((sum, goal) => sum + goal.weight, 0) }}%</span><el-button v-if="canEdit" link type="primary" @click="addGoal">添加目标</el-button></div>
        <small v-if="errors.goals || errors.total" class="field-error">{{ errors.goals || errors.total }}</small>
        <div v-for="(goal, index) in (canEdit ? form.goals : plan.goals)" :key="goal.id" class="goal-card"
          :data-testid="showEvaluation ? 'improvement-goal-evaluation' : undefined">
          <div class="goal-card__head"><strong>{{ index + 1 }}. {{ canEdit ? '改进目标' : goal.name }}</strong><el-button v-if="canEdit" link type="danger" @click="removeGoal(index)">删除</el-button><span v-else>{{ goal.weight }}%</span></div>
          <template v-if="canEdit">
            <el-input v-model="goal.name" :aria-label="`目标名称 ${index + 1}`" placeholder="目标名称" maxlength="200" />
            <small v-if="errors[`name-${index}`]" class="field-error">{{ errors[`name-${index}`] }}</small>
            <el-input v-model="goal.description" :aria-label="`目标描述 ${index + 1}`" type="textarea" :rows="2" placeholder="目标描述" maxlength="4000" />
            <small v-if="errors[`description-${index}`]" class="field-error">{{ errors[`description-${index}`] }}</small>
            <label class="weight-field">权重 <input v-model.number="goal.weight" type="number" min="0" max="100" step="0.01" :aria-label="`目标权重 ${index + 1}`">%</label>
            <small v-if="errors[`weight-${index}`]" class="field-error">{{ errors[`weight-${index}`] }}</small>
            <div v-if="latestSuggestion(goal.id)" class="feedback-note"><b>员工修改建议</b><span>{{ latestSuggestion(goal.id) }}</span></div>
          </template>
          <template v-else>
            <p>{{ goal.description }}</p>
            <div v-if="showEvaluation" class="goal-evaluation">
              <div class="evaluation-stage"><strong>评价进展</strong><el-tag v-if="canEvaluate" size="small" type="primary">当前环节 · {{ currentEvaluationLabel }}</el-tag></div>
              <div v-if="priorScore('self', goal.id) && plan.status !== 'self_eval'" class="prior-score"><b>员工自评</b>{{ priorScore('self', goal.id) }}</div>
              <div v-if="priorScore('manager', goal.id) && plan.status !== 'manager_review'" class="prior-score"><b>直属上级评价</b>{{ priorScore('manager', goal.id) }}</div>
              <div v-if="priorScore('department', goal.id) && plan.status !== 'dept_review'" class="prior-score"><b>部门负责人评价</b>{{ priorScore('department', goal.id) }}</div>
              <div v-if="canEvaluate" class="current-evaluation">
                <label class="score-field">本环节评分 <input v-model.number="evaluation.items[index].score" type="number" min="0" max="100" step="0.1" :aria-label="`目标评分 ${index + 1}`"> 分</label>
                <small v-if="errors[`score-${index}`]" class="field-error">{{ errors[`score-${index}`] }}</small>
                <el-input v-model="evaluation.items[index].comment" :aria-label="`目标评价 ${index + 1}`" type="textarea" :rows="2" placeholder="填写这项目标的评价内容" />
                <small v-if="errors[`comment-${index}`]" class="field-error">{{ errors[`comment-${index}`] }}</small>
              </div>
            </div>
          </template>
        </div>
        <div v-if="canEdit" class="form-actions"><el-button :loading="busy" @click="saveTargets(false)">保存草稿</el-button><el-button type="primary" :loading="busy" @click="saveTargets(true)">提交目标</el-button></div>
        <template v-if="canEvaluate">
          <div class="evaluation-summary">
            <p class="weighted-total">加权综合分：{{ draftTotal ?? '待填写全部评分' }}</p>
            <el-form label-position="top"><el-form-item label="总体评价内容" required><el-input v-model="evaluation.overallComment" aria-label="总体评价内容" type="textarea" :rows="3" maxlength="4000" /><small v-if="errors.overall" class="field-error">{{ errors.overall }}</small></el-form-item></el-form>
            <div class="form-actions"><el-button :loading="busy" @click="saveEvaluation(false)">保存草稿</el-button><el-button type="primary" :loading="busy" @click="saveEvaluation(true)">提交评价</el-button></div>
          </div>
        </template>
        <template v-else-if="plan.status === 'completed'"><p class="weighted-total">最终综合分：{{ plan.finalScore ?? '-' }}</p><p>{{ plan.departmentEvaluation?.overallComment || '-' }}</p></template>
      </ChartCard>

      <ChartCard v-if="plan.workflowVersion === 1"><template #title>历史计划内容</template><p>改进目标：{{ plan.improvementGoal || '-' }}</p><p>最终评分（原 1–10 分制）：{{ plan.finalScore ?? '-' }}</p></ChartCard>

      <ChartCard><template #title>操作记录</template>
        <p v-if="!plan.records?.length" class="empty-note">暂无操作记录</p>
        <ol v-else class="improvement-operation" data-testid="improvement-operation-timeline" aria-label="操作记录">
          <li v-for="record in plan.records" :key="record.id" :class="`is-${recordTone(record)}`" data-testid="improvement-operation-record">
            <span class="improvement-operation__dot" aria-hidden="true" />
            <article class="improvement-operation__content">
              <time :datetime="record.createdAt">{{ formatDateTime(record.createdAt) }}</time>
              <div class="improvement-operation__title">{{ recordTitle(record) }}</div>
              <div class="improvement-operation__actor">
                <span class="improvement-operation__avatar" aria-hidden="true">{{ (record.actorName || '系统').slice(0, 1) }}</span>
                <span>{{ record.actorName || '系统' }}</span>
                <strong>{{ actionLabel(record) }}</strong>
                <small v-if="recordAuto(record)">{{ recordAuto(record) }}</small>
              </div>
              <p v-if="recordNote(record)" class="improvement-operation__note">{{ recordNote(record) }}</p>
              <div v-if="recordSuggestions(record).length" class="record-snapshot improvement-operation__note">
              <div v-for="item in recordSuggestions(record)" :key="item.goalId">
                <b>{{ item.goalName || goalName(item.goalId) }}的修改建议</b><span>{{ item.comment }}</span>
              </div>
                </div>
              <details v-if="recordGoals(record).length || recordEvaluation(record)">
                <summary>查看本次内容</summary>
                <div v-if="recordGoals(record).length" class="record-snapshot">
                  <p v-if="record.newValue?.background"><b>改进背景</b> {{ record.newValue.background }}</p>
                  <div v-for="goal in recordGoals(record)" :key="goal.id">
                    <b>{{ goal.name }}（{{ goal.weight }}%）</b><span>{{ goal.description }}</span>
                  </div>
                </div>
                <div v-if="recordEvaluation(record)" class="record-snapshot">
                  <div v-for="item in recordEvaluation(record)?.items" :key="item.goalId">
                    <b>{{ goalName(item.goalId) }} · {{ item.score ?? '未评分' }}{{ item.score == null ? '' : ' 分' }}</b><span>{{ item.comment || '未填写评价' }}</span>
                  </div>
                  <p v-if="recordEvaluation(record)?.weightedScore != null">加权综合分：{{ recordEvaluation(record)?.weightedScore }}</p>
                </div>
              </details>
            </article>
          </li>
        </ol>
      </ChartCard>

      <el-dialog v-model="decisionDialogOpen" :title="decisionDialogTitle" width="min(560px, calc(100vw - 32px))"
        :close-on-click-modal="false" destroy-on-close>
        <template v-if="decisionDialogForGoals">
          <p v-if="!decisionDialogReject">{{ employeeGoalConfirmation ? '确认后将进入员工自评，无需填写意见。' : '确认后将进入员工确认，无需填写意见。' }}</p>
          <template v-else>
            <p>{{ employeeGoalConfirmation ? '请填写需要调整的具体目标建议或整体意见。' : '请填写退回原因。' }}</p>
            <div v-if="employeeGoalConfirmation" class="dialog-suggestions">
              <label v-for="(goal, index) in plan.goals" :key="goal.id">
                <span>{{ index + 1 }}. {{ goal.name }}的修改建议（选填）</span>
                <el-input v-model="goalSuggestions[goal.id]" :aria-label="`目标 ${index + 1} 修改建议`"
                  type="textarea" :rows="2" maxlength="4000" placeholder="填写这项目标的修改建议" />
              </label>
            </div>
            <div class="decision-label">{{ employeeGoalConfirmation ? '整体意见（选填）' : '退回原因（必填）' }}</div>
            <el-input v-model="decisionComment" :aria-label="employeeGoalConfirmation ? '整体意见' : '目标退回原因'"
              type="textarea" :rows="3" maxlength="4000"
              :placeholder="employeeGoalConfirmation ? '填写整体意见' : '填写退回原因'" />
          </template>
        </template>
        <template v-else>
          <p>请查看目标、自评及业务评价，确认或退回直属上级重新评价。最终综合分以部门负责人评价为准。</p>
          <p class="weighted-total">待确认综合分：{{ plan.departmentEvaluation?.weightedScore ?? '-' }}</p>
          <template v-if="decisionDialogReject">
            <div class="decision-label">退回原因（必填）</div>
            <el-input v-model="decisionComment" aria-label="分管总审核意见" type="textarea" :rows="3" maxlength="4000" placeholder="填写退回原因" />
          </template>
          <p v-else>确认后将完成改进计划，无需填写审核意见。</p>
        </template>
        <small v-if="errors.decision" class="field-error">{{ errors.decision }}</small>
        <template #footer>
          <el-button :disabled="busy" @click="decisionDialogOpen = false">取消</el-button>
          <el-button :type="decisionDialogReject ? 'danger' : 'primary'" :loading="busy" @click="submitDecisionDialog">
            {{ decisionDialogReject ? '确认退回' : decisionDialogForGoals ? '确认目标' : '确认审核' }}
          </el-button>
        </template>
      </el-dialog>
    </template>
    <EmptyState v-else-if="!loading" description="改进计划不存在或无权查看" />
  </div>
</template>

<style scoped>
.title-row,.header-actions,.section-heading,.goal-card__head,.form-actions { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.header-actions { justify-content:flex-end; }
.section-heading,.goal-card__head { justify-content:space-between; }
.section-heading { margin:20px 0 10px; }
.plan-info { margin-bottom:14px; }
.plan-fields { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.plan-fields :deep(.el-select),.plan-fields :deep(.el-date-editor) { width:100%; }
.background-text,.goal-card p { white-space:pre-wrap; overflow-wrap:anywhere; }
.goal-card { display:grid; gap:10px; margin:10px 0; padding:14px; border:1px solid var(--el-border-color); border-radius:6px; }
.goal-card__head span { color:var(--el-text-color-secondary); font-size:13px; }
.weight-field,.score-field { display:flex; align-items:center; gap:8px; font-size:13px; }
.weight-field input,.score-field input { width:100px; height:34px; padding:0 8px; border:1px solid var(--el-border-color); border-radius:4px; }
.prior-score { display:grid; grid-template-columns:110px 1fr; gap:8px; padding:8px 10px; background:var(--el-fill-color-light); font-size:13px; white-space:pre-wrap; overflow-wrap:anywhere; }
.goal-evaluation { display:grid; gap:8px; margin-top:4px; padding-top:12px; border-top:1px solid var(--el-border-color-lighter); }
.evaluation-stage { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
.current-evaluation { display:grid; gap:8px; padding:10px 12px; border-radius:6px; background:var(--el-color-primary-light-9); }
.evaluation-summary { margin-top:18px; padding-top:16px; border-top:1px solid var(--el-border-color-lighter); }
.weighted-total { font-weight:600; }
.field-error { display:block; color:var(--el-color-danger); line-height:1.5; }
.feedback-note { display:grid; gap:3px; padding:8px 10px; background:var(--el-fill-color-light); font-size:13px; white-space:pre-wrap; overflow-wrap:anywhere; }
.decision-label { margin-bottom:8px; font-weight:600; }
.dialog-suggestions { display:grid; gap:12px; margin:14px 0; }
.dialog-suggestions label { display:grid; gap:6px; }
.form-actions { justify-content:flex-end; margin-top:16px; }
.improvement-operation { width:min(100%,760px); list-style:none; margin:0; padding:2px 0 0; }
.improvement-operation li { position:relative; padding:0 0 26px 28px; overflow-wrap:anywhere; }
.improvement-operation li:not(:last-child)::before { content:''; position:absolute; top:15px; bottom:-3px; left:6px; width:2px; background:var(--el-border-color-lighter); }
.improvement-operation li:last-child { padding-bottom:4px; }
.improvement-operation__dot { position:absolute; top:4px; left:0; width:12px; height:12px; border:3px solid var(--el-border-color); border-radius:50%; background:var(--el-bg-color); box-sizing:border-box; }
.improvement-operation li.is-success .improvement-operation__dot { border-color:var(--el-color-success); }
.improvement-operation li.is-danger .improvement-operation__dot { border-color:var(--el-color-danger); }
.improvement-operation__content time { display:block; margin-bottom:8px; color:var(--el-text-color-secondary); font-size:13px; line-height:20px; }
.improvement-operation__title { margin-bottom:8px; color:var(--el-text-color-primary); font-size:16px; font-weight:600; line-height:24px; }
.improvement-operation__actor { display:flex; align-items:center; gap:6px; min-height:26px; color:var(--el-text-color-regular); font-size:14px; }
.improvement-operation__avatar { display:inline-flex; width:24px; height:24px; align-items:center; justify-content:center; border-radius:50%; background:var(--el-fill-color-dark); color:var(--el-text-color-regular); font-size:12px; }
.improvement-operation__actor strong { color:var(--el-color-success); font-weight:600; }
.improvement-operation li.is-danger .improvement-operation__actor strong { color:var(--el-color-danger); }
.improvement-operation li.is-neutral .improvement-operation__actor strong { color:var(--el-text-color-secondary); }
.improvement-operation__actor small { color:var(--el-text-color-secondary); }
.improvement-operation__note { margin:10px 0 0; padding:9px 12px; border-radius:5px; background:var(--el-fill-color-light); color:var(--el-text-color-regular); font-size:13px; line-height:1.6; white-space:pre-wrap; overflow-wrap:anywhere; }
.improvement-operation details { margin-top:10px; font-size:12px; }
.record-snapshot { display:grid; gap:8px; margin-top:8px; padding:10px; background:var(--el-fill-color-light); }
.record-snapshot div { display:grid; gap:3px; overflow-wrap:anywhere; }
.record-snapshot span { white-space:pre-wrap; }
.empty-note { color:var(--el-text-color-secondary); }
@media(max-width:600px) {
  .plan-overview-card :deep(.chart-card__head) { align-items:flex-start; flex-wrap:wrap; gap:10px; }
  .plan-overview-card :deep(.chart-card__extra) { width:100%; }
  .header-actions { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); width:100%; }
  .header-actions :deep(.el-tag) { grid-column:1 / -1; justify-self:start; }
  .header-actions :deep(.el-button) { width:100%; margin-left:0; }
  .plan-fields { grid-template-columns:1fr; gap:0; }
  .goal-card { padding:10px; }
  .prior-score { grid-template-columns:1fr; }
  .form-actions { justify-content:stretch; }
  .form-actions :deep(.el-button) { flex:1; margin-left:0; }
}
</style>
