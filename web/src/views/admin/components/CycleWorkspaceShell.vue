<script setup lang="ts">
import { computed } from 'vue';
import { ArrowLeft } from '@element-plus/icons-vue';
import dayjs from 'dayjs';
import type { AssessmentCycle, LaunchPreflightResult } from '@/types/api.types';
import type { CycleStatus } from '@/types/enums';
import { formatDate } from '@/utils/date';
import { cycleNextStep, cycleStageIndex } from '../cycle-management';

const props = withDefaults(defineProps<{
  cycle?: AssessmentCycle | null;
  loading?: boolean;
  error?: string;
  preflight?: LaunchPreflightResult | null;
  preflightLoading?: boolean;
  preflightError?: string;
  launching?: boolean;
  canOpenImmediately?: boolean;
}>(), {
  cycle: null,
  loading: false,
  error: '',
  preflight: null,
  preflightLoading: false,
  preflightError: '',
  launching: false,
  canOpenImmediately: false,
});

const emit = defineEmits<{
  back: [];
  retry: [];
  preflight: [];
  launch: [];
  schedule: [];
  edit: [];
  'resolve-blocker': [code: string];
}>();

const stages = ['规划配置', '目标制定', '绩效评价', '校准审批', '公示归档'];
const currentStage = computed(() => props.cycle ? cycleStageIndex(props.cycle.status) : 0);
const nextStep = computed(() => props.cycle ? cycleNextStep(props.cycle) : null);

const STATUS_LABEL: Record<CycleStatus, string> = {
  draft: '草稿',
  scheduled: '待发起',
  launch_blocked: '发起受阻',
  indicator_setting: '指标制定中',
  self_eval: '员工自评中',
  manager_score: '主管评分中',
  hr_calibration: 'HR校准中',
  approval: '审批中',
  published: '已公示',
  appeal: '申诉中',
  closed: '已关闭',
};

function formatDateTime(value?: string): string {
  if (!value) return '未设置';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm') : '未设置';
}

function blockerActionLabel(code: string): string {
  if (code.startsWith('TEMPLATE_') || code === 'NO_ACTIVE_TEMPLATES') return '去配置模板';
  if (code === 'ORGANIZATION_RELATION_INVALID') return '去完善人员关系';
  return '';
}

</script>

<template>
  <section class="cycle-workspace" data-testid="cycle-workspace">
    <header class="cycle-workspace__header">
      <div class="cycle-workspace__identity">
        <el-button
          text
          :icon="ArrowLeft"
          data-testid="cycle-workspace-back"
          aria-label="返回周期列表"
          @click="emit('back')"
        />
        <div>
          <div class="cycle-workspace__title-row">
            <h1>{{ cycle?.name || '周期详情' }}</h1>
            <el-tag v-if="cycle" size="small" effect="light">{{ STATUS_LABEL[cycle.status] }}</el-tag>
          </div>
          <p v-if="cycle">{{ formatDate(cycle.startDate) }}–{{ formatDate(cycle.endDate) }}</p>
        </div>
      </div>
      <div
        v-if="cycle && ['draft', 'launch_blocked'].includes(cycle.status)"
        class="cycle-workspace__header-actions"
      >
        <el-button
          v-if="cycle.status === 'draft'"
          data-testid="cycle-workspace-edit"
          @click="emit('edit')"
        >编辑</el-button>
        <el-button
          data-testid="cycle-workspace-submit"
          type="primary"
          :loading="preflightLoading"
          @click="emit('preflight')"
        >提交</el-button>
      </div>
    </header>

    <el-skeleton v-if="loading" class="cycle-workspace__surface" animated :rows="8" />
    <el-result
      v-else-if="error"
      class="cycle-workspace__surface"
      icon="error"
      title="周期详情加载失败"
      :sub-title="error"
    >
      <template #extra><el-button type="primary" @click="emit('retry')">重试</el-button></template>
    </el-result>

    <template v-else-if="cycle">
      <nav class="cycle-stage-strip" aria-label="周期流程阶段">
        <div
          v-for="(stage, index) in stages"
          :key="stage"
          :data-testid="`cycle-stage-${index}`"
          class="cycle-stage-strip__item"
          :class="{
            'is-completed': index < currentStage,
            'is-current': index === currentStage,
            'is-blocked': index === currentStage && cycle.status === 'launch_blocked',
          }"
          :aria-current="index === currentStage ? 'step' : undefined"
        >
          <span>{{ index + 1 }}</span>
          <strong>{{ stage }}</strong>
        </div>
      </nav>

      <main class="cycle-workspace__main">
        <section class="cycle-current-action" data-testid="cycle-current-action">
          <div class="cycle-current-action__heading">
            <div>
              <span>当前任务</span>
              <h2>{{ nextStep?.label }}</h2>
              <p v-if="nextStep?.time">计划时间：{{ formatDateTime(nextStep.time) }}</p>
            </div>
            <el-tag :type="cycle.status === 'launch_blocked' ? 'danger' : 'primary'" effect="light">
              {{ STATUS_LABEL[cycle.status] }}
            </el-tag>
          </div>

          <div v-if="cycle.taskStats" class="cycle-stat-grid">
            <div><span>参与任务</span><strong>{{ cycle.taskStats.total }}</strong></div>
            <div><span>目标已完成</span><strong>{{ cycle.taskStats.goalCompleted }}</strong></div>
            <div><span>待主管审核</span><strong>{{ cycle.taskStats.pendingManagerReview }}</strong></div>
            <div><span>已逾期</span><strong :class="{ 'is-danger': cycle.taskStats.overdue > 0 }">{{ cycle.taskStats.overdue }}</strong></div>
          </div>

          <section v-if="['draft', 'launch_blocked'].includes(cycle.status)" class="cycle-preflight-panel">
            <el-skeleton v-if="preflightLoading" animated :rows="4" />
            <el-alert
              v-else-if="preflightError"
              type="error"
              :closable="false"
              show-icon
              title="发起检查失败"
              :description="preflightError"
            >
              <template #default><el-button size="small" @click="emit('preflight')">重新检查</el-button></template>
            </el-alert>

            <template v-else-if="preflight">
              <el-alert
                :type="preflight.ready ? 'success' : 'error'"
                :closable="false"
                show-icon
                :title="preflight.ready ? '发起检查通过' : '请先处理阻断项'"
              />
              <div class="cycle-preflight-summary">
                <span><strong>{{ preflight.participantCount }}</strong> 名参与员工</span>
                <span><strong>{{ preflight.templateCount }}</strong> 套匹配模板</span>
                <span>目标制定开放时间 {{ formatDateTime(preflight.cycle.goalSettingOpenAt) }}</span>
              </div>
              <div
                v-if="preflight.blockers.length"
                class="cycle-preflight-blockers"
                data-testid="cycle-preflight-blockers"
              >
                <article v-for="blocker in preflight.blockers" :key="blocker.code">
                  <div>
                    <strong>{{ blocker.message }}</strong>
                    <span>请完成相关人员、组织或模板配置后重新检查。</span>
                  </div>
                  <el-button
                    v-if="blockerActionLabel(blocker.code)"
                    type="primary"
                    plain
                    size="small"
                    @click="emit('resolve-blocker', blocker.code)"
                  >
                    {{ blockerActionLabel(blocker.code) }}
                  </el-button>
                </article>
              </div>
              <details
                v-if="preflight.participants.length"
                class="cycle-preflight-details"
                data-testid="cycle-preflight-details"
              >
                <summary>查看检查明细（{{ preflight.participants.length }}）</summary>
                <el-table :data="preflight.participants" size="small" max-height="360">
                  <el-table-column prop="employeeName" label="员工" min-width="100" />
                  <el-table-column prop="deptName" label="部门" min-width="140" />
                  <el-table-column prop="managerName" label="直属主管" min-width="110" />
                  <el-table-column prop="templateName" label="匹配模板" min-width="180" />
                </el-table>
              </details>
              <div v-if="preflight.ready" class="cycle-preflight-actions">
                <el-button
                  v-if="canOpenImmediately"
                  type="primary"
                  :loading="launching"
                  @click="emit('launch')"
                >
                  立即发起
                </el-button>
                <el-button v-else type="primary" :loading="launching" @click="emit('schedule')">
                  预约发起（{{ formatDateTime(preflight.cycle.goalSettingOpenAt) }}）
                </el-button>
              </div>
              <el-button v-else type="primary" plain @click="emit('preflight')">重新检查</el-button>
            </template>

            <div v-else class="cycle-preflight-empty">
              <p>检查参与人员、直属主管、绩效模板和时间设置是否准备完成。</p>
              <el-button type="primary" @click="emit('preflight')">开始检查</el-button>
            </div>
          </section>
        </section>
      </main>
    </template>
  </section>
</template>

<style scoped>
.cycle-workspace {
  min-width: 0;
  min-height: 100%;
  padding: 0 0 24px;
  background: #f4f6fa;
}

.cycle-workspace__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px;
  background: #fff;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.cycle-workspace__identity,
.cycle-workspace__header-actions,
.cycle-workspace__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cycle-workspace__identity h1 {
  margin: 0;
  font-size: 21px;
}

.cycle-workspace__identity p {
  margin: 5px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.cycle-stage-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(130px, 1fr));
  gap: 0;
  margin: 16px 20px;
  padding: 16px 18px;
  overflow-x: auto;
  background: #fff;
  border-radius: 10px;
}

.cycle-stage-strip__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--el-text-color-secondary);
}

.cycle-stage-strip__item:not(:last-child)::after {
  position: absolute;
  right: 12px;
  width: calc(100% - 118px);
  height: 2px;
  content: '';
  background: var(--el-border-color-light);
}

.cycle-stage-strip__item > span {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  font-size: 12px;
  background: var(--el-fill-color);
  border-radius: 50%;
}

.cycle-stage-strip__item.is-completed,
.cycle-stage-strip__item.is-current {
  color: var(--el-color-primary);
}

.cycle-stage-strip__item.is-completed > span,
.cycle-stage-strip__item.is-current > span {
  color: #fff;
  background: var(--el-color-primary);
}

.cycle-stage-strip__item.is-blocked,
.cycle-stage-strip__item.is-blocked > span {
  color: var(--el-color-danger);
}

.cycle-stage-strip__item.is-blocked > span {
  color: #fff;
  background: var(--el-color-danger);
}

.cycle-workspace__main,
.cycle-workspace__surface {
  margin: 0 20px;
}

.cycle-current-action {
  padding: 22px;
  background: #fff;
  border-radius: 10px;
}

.cycle-current-action__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.cycle-current-action__heading span,
.cycle-current-action__heading p,
.cycle-stat-grid span {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.cycle-current-action__heading h2 {
  margin: 5px 0;
  font-size: 20px;
}

.cycle-current-action__heading p {
  margin: 0;
}

.cycle-stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 20px;
}

.cycle-stat-grid > div {
  display: grid;
  gap: 7px;
  padding: 14px;
  background: var(--el-fill-color-lighter);
  border-radius: 8px;
}

.cycle-stat-grid strong {
  font-size: 22px;
}

.cycle-stat-grid strong.is-danger {
  color: var(--el-color-danger);
}

.cycle-preflight-panel {
  display: grid;
  gap: 16px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.cycle-preflight-summary,
.cycle-preflight-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 18px;
}

.cycle-preflight-summary span {
  color: var(--el-text-color-secondary);
}

.cycle-preflight-summary strong {
  color: var(--el-text-color-primary);
}

.cycle-preflight-blockers {
  display: grid;
  gap: 10px;
}

.cycle-preflight-blockers article {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  border-radius: 8px;
}

.cycle-preflight-blockers article > div {
  display: grid;
  gap: 4px;
}

.cycle-preflight-blockers span {
  font-size: 12px;
}

.cycle-preflight-details summary {
  padding: 8px 0;
  color: var(--el-color-primary);
  cursor: pointer;
}

.cycle-preflight-empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px;
  background: var(--el-fill-color-lighter);
  border-radius: 8px;
}

.cycle-preflight-empty p {
  margin: 0;
  color: var(--el-text-color-secondary);
}

@media (max-width: 767px) {
  .cycle-workspace__header {
    align-items: flex-start;
    flex-wrap: wrap;
    padding: 14px 12px;
  }

  .cycle-workspace__identity {
    align-items: flex-start;
  }

  .cycle-workspace__identity h1 {
    font-size: 18px;
  }

  .cycle-workspace__header-actions {
    display: flex;
    justify-content: flex-end;
    width: 100%;
  }

  .cycle-stage-strip {
    margin: 12px;
    padding: 14px;
  }

  .cycle-workspace__main,
  .cycle-workspace__surface {
    margin: 0 12px;
  }

  .cycle-current-action {
    padding: 16px;
  }

  .cycle-current-action__heading,
  .cycle-preflight-blockers article,
  .cycle-preflight-empty {
    align-items: stretch;
    flex-direction: column;
  }

  .cycle-current-action__heading > .el-button,
  .cycle-preflight-blockers article .el-button,
  .cycle-preflight-empty .el-button {
    width: 100%;
  }

  .cycle-stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
