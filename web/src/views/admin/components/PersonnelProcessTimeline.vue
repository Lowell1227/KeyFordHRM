<script setup lang="ts">
import type { PersonnelProcessStep } from './personnel-process-timeline';

withDefaults(defineProps<{
  items: PersonnelProcessStep[];
  label?: string;
}>(), {
  label: '办理流程',
});

function actorInitial(actor?: string) {
  return actor?.trim().slice(0, 1) || '';
}
</script>

<template>
  <ol class="personnel-process-timeline" :aria-label="label">
    <li
      v-for="item in items"
      :key="item.key"
      class="personnel-process-timeline__item"
      :class="`is-${item.tone}`"
      :data-tone="item.tone"
      :aria-current="item.current ? 'step' : undefined"
    >
      <span class="personnel-process-timeline__dot" aria-hidden="true" />
      <time v-if="item.time">{{ item.time }}</time>
      <div class="personnel-process-timeline__title">{{ item.title }}</div>
      <div class="personnel-process-timeline__state" :class="`is-${item.tone}`">
        <span v-if="item.actor" class="personnel-process-timeline__avatar">{{ actorInitial(item.actor) }}</span>
        <span v-if="item.actor">{{ item.actor }}</span>
        <strong>{{ item.status }}</strong>
      </div>

      <div v-if="item.details?.length" class="personnel-process-timeline__details">
        <div v-for="detail in item.details" :key="detail.key" class="personnel-process-timeline__detail">
          <div class="personnel-process-timeline__detail-head">
            <strong>{{ detail.title }}</strong>
            <time v-if="detail.time">{{ detail.time }}</time>
          </div>
          <div class="personnel-process-timeline__state" :class="`is-${detail.tone}`">
            <span v-if="detail.actor" class="personnel-process-timeline__avatar">{{ actorInitial(detail.actor) }}</span>
            <span v-if="detail.actor">{{ detail.actor }}</span>
            <strong>{{ detail.status }}</strong>
          </div>
        </div>
      </div>

      <p v-if="item.note" class="personnel-process-timeline__note">{{ item.note }}</p>
    </li>
  </ol>
</template>

<style scoped>
.personnel-process-timeline {
  margin: 0;
  padding: 0 0 0 8px;
  list-style: none;
}

.personnel-process-timeline__item {
  --node-color: var(--el-border-color);
  position: relative;
  padding: 0 0 24px 26px;
  border-left: 2px solid var(--el-border-color-lighter);
}

.personnel-process-timeline__item:last-child {
  padding-bottom: 2px;
  border-left-color: transparent;
}

.personnel-process-timeline__item.is-success { --node-color: var(--el-color-success); }
.personnel-process-timeline__item.is-current { --node-color: var(--el-color-primary); }
.personnel-process-timeline__item.is-danger { --node-color: var(--el-color-danger); }

.personnel-process-timeline__dot {
  position: absolute;
  top: 4px;
  left: -7px;
  width: 12px;
  height: 12px;
  box-sizing: border-box;
  border: 3px solid var(--node-color);
  border-radius: 50%;
  background: var(--el-bg-color);
}

.personnel-process-timeline__item > time {
  display: block;
  margin-bottom: 7px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.personnel-process-timeline__title {
  margin-bottom: 8px;
  color: var(--el-text-color-primary);
  font-size: 14px;
  font-weight: 600;
}

.personnel-process-timeline__item.is-waiting .personnel-process-timeline__title,
.personnel-process-timeline__item.is-neutral .personnel-process-timeline__title {
  color: var(--el-text-color-secondary);
}

.personnel-process-timeline__state {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 15px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.personnel-process-timeline__state strong { font-weight: 600; }
.personnel-process-timeline__state.is-success { background: var(--el-color-success-light-9); color: var(--el-color-success); }
.personnel-process-timeline__state.is-current { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.personnel-process-timeline__state.is-danger { background: var(--el-color-danger-light-9); color: var(--el-color-danger); }

.personnel-process-timeline__avatar {
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgb(255 255 255 / 72%);
  color: inherit;
  font-size: 11px;
}

.personnel-process-timeline__details {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.personnel-process-timeline__detail {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 14px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--el-fill-color-extra-light);
}

.personnel-process-timeline__detail-head {
  display: grid;
  gap: 3px;
}

.personnel-process-timeline__detail-head time {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.personnel-process-timeline__note {
  margin: 10px 0 0;
  padding: 10px 12px;
  border-radius: 7px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  line-height: 1.6;
}

@media (max-width: 640px) {
  .personnel-process-timeline__item { padding-left: 22px; }
  .personnel-process-timeline__detail { align-items: flex-start; flex-direction: column; }
}
</style>
