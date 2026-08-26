<script setup lang="ts">
import { computed } from 'vue';
import { MoreFilled } from '@element-plus/icons-vue';
import type { Objective } from '@/types/api.types';
import { OBJECTIVE_REVIEW_STATUS_META } from '@/types/enums';
import type { ObjectiveMapDisplayOptions } from '../objective-map-settings';

const props = defineProps<{
  objective: Objective;
  display: ObjectiveMapDisplayOptions;
  canManage: boolean;
  canTrack: boolean;
}>();

const emit = defineEmits<{
  open: [objective: Objective];
  edit: [objective: Objective];
  progress: [objective: Objective];
  track: [objective: Objective];
  remove: [objective: Objective];
}>();

const levelLabel = computed(() => ({
  company: '公司',
  department: '部门',
  individual: '个人',
})[props.objective.level]);

const ownerLabel = computed(() => (
  props.objective.ownerName || props.objective.deptName || '未指定负责人'
));

const reviewMeta = computed(() => OBJECTIVE_REVIEW_STATUS_META[props.objective.reviewStatus]);
const showReviewBadge = computed(() => props.objective.reviewStatus !== 'not_required');
const reviewTitle = computed(() => (
  props.objective.reviewStatus === 'pending' && props.objective.reviewerName
    ? `待${props.objective.reviewerName}审核`
    : reviewMeta.value.label
));

function handleCommand(command: 'edit' | 'progress' | 'track' | 'remove') {
  if (command === 'edit') emit('edit', props.objective);
  if (command === 'progress') emit('progress', props.objective);
  if (command === 'track') emit('track', props.objective);
  if (command === 'remove') emit('remove', props.objective);
}
</script>

<template>
  <article
    :data-testid="`objective-map-card-${objective.id}`"
    class="objective-map-card"
    :class="`is-${objective.level}`"
    tabindex="0"
    role="button"
    :aria-label="`${levelLabel}目标：${objective.title}，进度${objective.progress}%`"
    @click="emit('open', objective)"
    @keydown.enter.prevent="emit('open', objective)"
    @keydown.space.prevent="emit('open', objective)"
  >
    <div class="objective-map-card__header">
      <span class="objective-map-card__level">{{ levelLabel }}</span>
      <span v-if="display.showOwner" class="objective-map-card__owner">{{ ownerLabel }}</span>
      <span
        v-if="showReviewBadge"
        class="objective-map-card__review"
        :class="`is-${objective.reviewStatus}`"
        :title="reviewTitle"
      >{{ reviewMeta.label }}</span>
      <el-dropdown
        v-if="canManage"
        trigger="click"
        placement="bottom-end"
        @command="handleCommand"
        @click.stop
      >
        <button
          type="button"
          class="objective-map-card__more"
          aria-label="更多操作"
          @click.stop
        >
          <el-icon><MoreFilled /></el-icon>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="edit">编辑目标</el-dropdown-item>
            <el-dropdown-item command="progress">更新进度</el-dropdown-item>
            <el-dropdown-item v-if="canTrack" command="track">目标跟进</el-dropdown-item>
            <el-dropdown-item divided command="remove">删除目标</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div class="objective-map-card__body">
      <span class="objective-map-card__target" aria-hidden="true" />
      <span class="objective-map-card__title">{{ objective.title }}</span>
      <span
        v-if="display.showProgress"
        class="objective-map-card__progress"
        :aria-label="`进度 ${objective.progress}%`"
      >{{ objective.progress }}%</span>
    </div>

    <div
      v-if="objective.level === 'department' && objective.deptName"
      class="objective-map-card__department"
    >
      {{ objective.deptName }}
    </div>
  </article>
</template>

<style scoped>
.objective-map-card {
  position: absolute;
  width: 292px;
  height: 88px;
  box-sizing: border-box;
  padding: 12px 12px 10px;
  overflow: hidden;
  color: #27334a;
  background: #fff;
  border: 1px solid rgb(225 231 241 / 90%);
  border-radius: 10px;
  box-shadow: 0 5px 18px rgb(39 55 86 / 9%);
  cursor: pointer;
  user-select: none;
  transition: box-shadow 160ms ease, transform 160ms ease;
}

.objective-map-card:hover {
  z-index: 2;
  box-shadow: 0 9px 24px rgb(39 55 86 / 15%);
}

.objective-map-card:focus-visible {
  outline: 2px solid #2269dc;
  outline-offset: 3px;
}

.objective-map-card__header,
.objective-map-card__body {
  display: flex;
  align-items: center;
}

.objective-map-card__header {
  min-height: 23px;
  gap: 8px;
}

.objective-map-card__level {
  min-width: 32px;
  min-height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  border-radius: 6px;
  color: #fff;
  background: #25adc0;
  font-size: 11px;
  font-weight: 600;
}

.objective-map-card.is-company .objective-map-card__level {
  background: #315dba;
}

.objective-map-card.is-department .objective-map-card__level {
  background: #6657d9;
}

.objective-map-card__owner {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: #939db0;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.objective-map-card__review {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: 5px;
  color: #7a4f00;
  background: #fff2cf;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
}

.objective-map-card__review.is-approved {
  color: #237a48;
  background: #e7f7ee;
}

.objective-map-card__review.is-changes_requested {
  color: #b23a42;
  background: #fdecef;
}

.objective-map-card__review.is-draft {
  color: #69758a;
  background: #eef1f5;
}

.objective-map-card__more {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: -3px -4px -3px 0;
  padding: 0;
  border: 0;
  border-radius: 5px;
  color: #9aa4b5;
  background: transparent;
  opacity: 0;
  cursor: pointer;
}

.objective-map-card:hover .objective-map-card__more,
.objective-map-card:focus-within .objective-map-card__more {
  opacity: 1;
}

.objective-map-card__more:hover {
  color: #2568d8;
  background: #eef4ff;
}

.objective-map-card__body {
  gap: 8px;
  margin-top: 11px;
}

.objective-map-card__target {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  border: 4px solid #dbe9ff;
  border-radius: 50%;
  box-shadow: inset 0 0 0 2px #2f7cf5;
}

.objective-map-card__title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.objective-map-card__progress {
  flex: 0 0 auto;
  padding: 3px 7px;
  border-radius: 5px;
  color: #e89712;
  background: #fff4d9;
  font-size: 12px;
  font-weight: 600;
}

.objective-map-card__department {
  position: absolute;
  top: 13px;
  right: 42px;
  max-width: 112px;
  overflow: hidden;
  color: #a1aabc;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .objective-map-card {
    transition: none;
  }
}
</style>
