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
      :data-step-key="item.key"
      :data-occurred-at="item.occurredAt || undefined"
      :data-event-id="item.eventId"
      :data-event-action="item.eventAction"
      :aria-current="item.current ? 'step' : undefined"
    >
      <span class="personnel-process-timeline__dot" aria-hidden="true" />
      <time v-if="item.time" :datetime="item.occurredAt || undefined">{{ item.time }}</time>
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
      <details v-if="item.differenceStatus" class="personnel-process-timeline__differences">
        <summary>{{ item.revisionVersion ? `版本 ${item.revisionVersion} · ` : '' }}字段差异{{ item.differenceStatus === '未记录' ? '：未记录' : '' }}</summary>
        <p v-if="item.differenceStatus === '未记录'">历史版本关联或快照未记录</p>
        <template v-else>
          <section v-for="group in item.differences" :key="group.key">
            <h4>{{ group.title }}</h4>
            <dl>
              <div v-for="field in group.fields" :key="field.key">
                <dt>{{ field.label }}</dt><dd>{{ field.before }} → {{ field.after }}</dd>
              </div>
            </dl>
          </section>
          <p v-if="!item.differences?.length">未发现可展示的字段差异</p>
        </template>
      </details>
      <slot name="step-action" :item="item" />
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
  min-width: 0;
  overflow-wrap: anywhere;
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
  flex-wrap: wrap;
  max-width: 100%;
  box-sizing: border-box;
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
  flex-shrink: 0;
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

.personnel-process-timeline__differences { margin-top: 10px; min-width: 0; font-size: 13px; }
.personnel-process-timeline__differences summary { cursor: pointer; color: var(--el-color-primary); line-height: 24px; }
.personnel-process-timeline__differences h4 { margin: 12px 0 4px; font-size: 13px; }
.personnel-process-timeline__differences dl { margin: 0; }
.personnel-process-timeline__differences dl > div { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.personnel-process-timeline__differences dd { margin: 0; color: var(--el-text-color-regular); }

@media (max-width: 640px) {
  .personnel-process-timeline__item { padding-left: 22px; }
  .personnel-process-timeline__detail { align-items: flex-start; flex-direction: column; }
  .personnel-process-timeline__differences dl > div { grid-template-columns: 1fr; gap: 4px; }
}
</style>
