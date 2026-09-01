<script setup lang="ts">
import { computed } from 'vue';
import { ArrowLeft } from '@element-plus/icons-vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import type { TeamTaskListItem } from '@/types/api.types';
import type { TeamStageState, TeamTaskStage } from '@/types/enums';

const props = withDefaults(
  defineProps<{
    stage: TeamTaskStage;
    members: TeamTaskListItem[];
    task?: TeamTaskListItem;
    loading?: boolean;
    error?: string;
  }>(),
  {
    task: undefined,
    loading: false,
    error: '',
  },
);

defineEmits<{
  back: [];
  retry: [];
  'member-selected': [taskId: string];
}>();

const title = computed(() => props.stage === 'goal-review' ? '目标审核' : '主管评分');

const managerPeriodStatus = computed(() => {
  const status = props.task?.periodReview?.status;
  if (status === 'manager_scoring') return '主管评分中';
  if (status === 'self_eval') return '员工自评中';
  if (status === 'completed') return '本期已完成';
  if (status === 'no_result') return '本期无结果';
  if (status === 'unopened') return '未开始';
  return '';
});

function stageStateLabel(state: TeamStageState): string {
  const labels: Record<TeamStageState, string> = {
    not_started: '未开始',
    pending: '待处理',
    completed: '已完成',
    exempted: '已豁免',
  };
  return labels[state];
}
</script>

<template>
  <section class="team-task-workspace" data-testid="team-task-workspace">
    <header class="team-task-workspace__bar">
      <el-button
        text
        class="team-task-workspace__back"
        data-testid="team-task-workspace-back"
        aria-label="返回团队绩效待办"
        :icon="ArrowLeft"
        @click="$emit('back')"
      />
      <div class="team-task-workspace__title">
        <h1>{{ title }}</h1>
        <el-tag v-if="task?.cycleName" size="small" effect="light">{{ task.cycleName }}</el-tag>
      </div>
    </header>

    <div class="team-task-workspace__layout">
      <nav class="team-task-workspace__members" aria-label="直属下属">
        <button
          v-for="member in members"
          :key="member.id"
          type="button"
          class="team-task-workspace__member"
          :class="{ 'is-current': member.id === task?.id }"
          :data-testid="`team-task-row-${member.id}`"
          :aria-current="member.id === task?.id ? 'true' : undefined"
          :aria-label="`查看 ${member.employeeName} 的${title}`"
          @click="$emit('member-selected', member.id)"
        >
          <el-avatar :size="34" :src="member.avatarUrl || undefined">
            {{ member.employeeName.slice(0, 1) }}
          </el-avatar>
          <span class="team-task-workspace__member-copy">
            <strong>{{ member.employeeName }}</strong>
            <small>{{ stageStateLabel(member.stageState) }}</small>
          </span>
        </button>
      </nav>

      <main class="team-task-workspace__main">
        <el-skeleton v-if="loading" class="team-task-workspace__state" animated :rows="8" />

        <el-result
          v-else-if="error"
          class="team-task-workspace__state"
          icon="error"
          title="员工绩效加载失败"
          :sub-title="error"
        >
          <template #extra>
            <el-button type="primary" @click="$emit('retry')">重试</el-button>
          </template>
        </el-result>

        <template v-else-if="task">
          <section class="team-task-workspace__profile">
            <el-avatar :size="48" :src="task.avatarUrl || undefined">
              {{ task.employeeName.slice(0, 1) }}
            </el-avatar>
            <div class="team-task-workspace__identity">
              <div>
                <h2>{{ task.employeeName }}</h2>
                <el-tag v-if="stage === 'manager-eval' && managerPeriodStatus" size="small" type="warning">
                  {{ managerPeriodStatus }}
                </el-tag>
                <StatusBadge v-else :status="task.status" size="small" />
              </div>
              <p>
                <span>{{ task.employeeNo || '-' }}</span>
                <span>{{ task.deptName || '-' }}</span>
                <span>{{ task.position || '-' }}</span>
              </p>
            </div>
          </section>

          <section class="team-task-workspace__content">
            <slot />
          </section>
        </template>

        <el-empty v-else class="team-task-workspace__state" description="未找到所选员工" />
      </main>
    </div>
  </section>
</template>

<style scoped>
.team-task-workspace {
  min-width: 0;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: #f4f6fa;
}

.team-task-workspace__bar {
  min-height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px;
  background: #fff;
  border-bottom: 1px solid #edf0f5;
}

.team-task-workspace__back {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  padding: 0;
}

.team-task-workspace__title {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.team-task-workspace__title h1 {
  flex-shrink: 0;
  margin: 0;
  color: #172033;
  font-size: 18px;
  line-height: 1.3;
  white-space: nowrap;
}

.team-task-workspace__title :deep(.el-tag) {
  min-width: 0;
  flex: 1 1 auto;
  justify-content: flex-start;
  overflow: hidden;
}

.team-task-workspace__title :deep(.el-tag__content) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-task-workspace__layout {
  min-width: 0;
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
}

.team-task-workspace__members {
  min-width: 0;
  min-height: 0;
  padding: 10px 8px;
  overflow-y: auto;
  background: #fff;
  border-right: 1px solid #e8ecf2;
}

.team-task-workspace__member {
  width: 100%;
  min-width: 0;
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 4px;
  padding: 4px 8px;
  border: 0;
  border-radius: 8px;
  color: #30384b;
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.team-task-workspace__member:hover {
  background: #f3f6fb;
}

.team-task-workspace__member.is-current {
  color: #1768d3;
  background: #e7f2ff;
}

.team-task-workspace__member-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.team-task-workspace__member-copy strong,
.team-task-workspace__member-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-task-workspace__member-copy strong {
  font-size: 13px;
}

.team-task-workspace__member-copy small {
  color: #8490a3;
  font-size: 11px;
}

.team-task-workspace__main {
  min-width: 0;
  min-height: 0;
  padding: 16px;
  overflow: auto;
}

.team-task-workspace__profile {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  padding: 12px 16px;
  border: 0;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(31 45 61 / 4%);
}

.team-task-workspace__identity {
  min-width: 0;
}

.team-task-workspace__identity > div,
.team-task-workspace__identity p {
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 12px;
}

.team-task-workspace__identity h2 {
  margin: 0;
  color: #20283a;
  font-size: 19px;
}

.team-task-workspace__identity p {
  margin: 5px 0 0;
  color: #727c8f;
  font-size: 12px;
}

.team-task-workspace__identity p span + span::before {
  content: '·';
  margin-right: 12px;
  color: #c0c6d0;
}

.team-task-workspace__content {
  min-width: 0;
}

.team-task-workspace__state {
  min-height: 420px;
  padding: 24px;
  border: 1px solid #e8ebf0;
  border-radius: 10px;
  background: #fff;
}

@media (max-width: 768px) {
  .team-task-workspace__bar {
    min-height: 54px;
    padding: 0 10px;
  }

  .team-task-workspace__layout {
    display: flex;
    flex-direction: column;
  }

  .team-task-workspace__members {
    display: flex;
    flex-shrink: 0;
    gap: 6px;
    padding: 8px 10px;
    overflow-x: auto;
    overflow-y: hidden;
    border-right: 0;
    border-bottom: 1px solid #e3e7ee;
  }

  .team-task-workspace__member {
    width: auto;
    min-width: 132px;
    margin: 0;
  }

  .team-task-workspace__main {
    overflow: visible;
    padding: 10px;
  }

  .team-task-workspace__profile {
    padding: 12px;
  }
}
</style>
