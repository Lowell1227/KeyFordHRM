<script setup lang="ts">
import { Close } from '@element-plus/icons-vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import type { TeamTaskListItem } from '@/types/api.types';
import type { TeamTaskStage } from '@/types/enums';

withDefaults(
  defineProps<{
    task?: TeamTaskListItem;
    taskId?: string;
    stage: TeamTaskStage;
    loading?: boolean;
  }>(),
  {
    task: undefined,
    taskId: undefined,
    loading: false,
  },
);

defineEmits<{
  close: [];
}>();
</script>

<template>
  <aside class="team-member-rail" data-testid="team-member-rail">
    <header class="team-member-rail__header">
      <h2>成员详情</h2>
      <el-tooltip content="关闭" placement="top">
        <el-button
          text
          circle
          :icon="Close"
          aria-label="关闭成员详情"
          @click="$emit('close')"
        />
      </el-tooltip>
    </header>

    <div class="team-member-rail__body">
      <el-skeleton v-if="loading" animated :rows="7" />

      <template v-else-if="task">
        <section class="member-profile">
          <el-avatar :size="44" :src="task.avatarUrl || undefined">
            {{ task.employeeName.slice(0, 1) }}
          </el-avatar>
          <div class="member-profile__copy">
            <strong>{{ task.employeeName }}</strong>
            <span>{{ task.employeeNo || '-' }}<template v-if="task.position"> · {{ task.position }}</template></span>
          </div>
        </section>

        <dl class="member-facts">
          <div>
            <dt>部门</dt>
            <dd>{{ task.deptName || '-' }}</dd>
          </div>
          <div>
            <dt>考核周期</dt>
            <dd>{{ task.cycleName }}</dd>
          </div>
          <div>
            <dt>当前状态</dt>
            <dd><StatusBadge :status="task.status" size="small" /></dd>
          </div>
          <div>
            <dt>绩效结果</dt>
            <dd>{{ task.totalScore ?? task.rawGrade ?? '-' }}</dd>
          </div>
        </dl>

        <section class="member-detail-shell">
          <h3>{{ stage === 'goal-review' ? '指标审核' : '主管评分' }}</h3>
          <el-empty
            :image-size="54"
            :description="stage === 'goal-review' ? '暂无指标明细' : '暂无评分明细'"
          />
        </section>
      </template>

      <el-empty v-else :image-size="64" description="未找到所选成员" />
    </div>
  </aside>
</template>

<style scoped>
.team-member-rail {
  width: 320px;
  min-width: 0;
  min-height: 520px;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #dfe4ec;
  border-radius: 7px;
  overflow: hidden;
}

.team-member-rail__header {
  min-height: 54px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 0 16px;
  border-bottom: 1px solid #e8ebf0;
}

.team-member-rail__header h2,
.member-detail-shell h3 {
  margin: 0;
  color: #20283a;
  font-size: 15px;
  font-weight: 650;
}

.team-member-rail__body {
  min-height: 0;
  flex: 1;
  padding: 16px;
  overflow: auto;
}

.member-profile {
  display: flex;
  align-items: center;
  gap: 11px;
  padding-bottom: 16px;
  border-bottom: 1px solid #edf0f4;
}

.member-profile__copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.member-profile__copy strong,
.member-profile__copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-profile__copy strong {
  color: #20283a;
  font-size: 15px;
}

.member-profile__copy span {
  color: #727c8f;
  font-size: 12px;
}

.member-facts {
  margin: 0;
  padding: 8px 0 14px;
  border-bottom: 1px solid #edf0f4;
}

.member-facts > div {
  min-height: 38px;
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.member-facts dt {
  color: #7a8495;
  font-size: 12px;
}

.member-facts dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: #30384b;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-detail-shell {
  padding-top: 16px;
}

@media (max-width: 1180px) {
  .team-member-rail {
    width: 288px;
  }
}

@media (max-width: 768px) {
  .team-member-rail {
    width: 100%;
    min-height: 390px;
  }
}
</style>
