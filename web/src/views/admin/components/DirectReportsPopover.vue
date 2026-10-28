<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { usersApi } from '@/api/users.api';
import type { DirectReport } from '@/types/api.types';

const props = withDefaults(defineProps<{ userId: string; userName: string; count?: number }>(), { count: 0 });
const visible = ref(false);
const loading = ref(false);
const failed = ref(false);
const reports = ref<DirectReport[]>([]);
const reference = ref<HTMLElement>();
const panel = ref<HTMLElement>();
let requestVersion = 0;
let pinnedByClick = false;

function setVisible(value: boolean) {
  visible.value = value;
  if (!value) pinnedByClick = false;
}

function toggleFromClick() {
  if (pinnedByClick) setVisible(false);
  else {
    pinnedByClick = true;
    visible.value = true;
  }
}

function containsFocus(target: EventTarget | null = document.activeElement) {
  return target instanceof Node && (reference.value?.contains(target) || panel.value?.contains(target));
}

function updateVisibility(value: boolean) {
  if (value || !containsFocus()) setVisible(value);
}

function handleBlur(event: FocusEvent) {
  if (!containsFocus(event.relatedTarget)) setVisible(false);
}

async function focusPanel(event?: KeyboardEvent) {
  if (event?.shiftKey) return;
  event?.preventDefault();
  visible.value = true;
  await nextTick();
  (panel.value?.querySelector<HTMLElement>('button, [tabindex="0"]') ?? panel.value)?.focus();
}

function closePanel() {
  reference.value?.querySelector<HTMLElement>('button')?.focus();
  setVisible(false);
}

watch(() => [props.userId, props.count], () => {
  requestVersion++;
  setVisible(false);
  loading.value = false;
  failed.value = false;
  reports.value = [];
});

async function loadReports() {
  if (loading.value) return;
  const version = ++requestVersion;
  loading.value = true;
  failed.value = false;
  try {
    const result = await usersApi.getSubordinates(props.userId);
    if (version === requestVersion) reports.value = result;
  } catch {
    if (version === requestVersion) failed.value = true;
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}
</script>

<template>
  <el-popover
    v-if="count > 0"
    :visible="visible"
    trigger="hover"
    placement="bottom-start"
    :width="340"
    :popper-style="{ maxWidth: 'calc(100vw - 24px)' }"
    @update:visible="updateVisibility"
    @show="loadReports"
  >
    <template #reference>
      <span ref="reference">
        <el-button
          link type="primary"
          :aria-label="`查看${userName}的直属下属（${count}人）`"
          :aria-expanded="visible"
          @focus="visible = true"
          @click="toggleFromClick"
          @blur="handleBlur"
          @keydown.tab="focusPanel"
          @keydown.down="focusPanel"
          @keydown.esc.stop.prevent="closePanel"
        >{{ count }}人</el-button>
      </span>
    </template>
    <div ref="panel" tabindex="-1" @focusout="handleBlur" @keydown.esc.stop.prevent="closePanel">
      <strong class="direct-reports-title">{{ userName }}的直属下属</strong>
      <p v-if="loading" class="direct-reports-hint" role="status">正在加载名单…</p>
      <div v-else-if="failed" class="direct-reports-error" role="alert">
        <span>名单加载失败</span>
        <el-button link type="primary" @click="loadReports">重试</el-button>
      </div>
      <ul v-else-if="reports.length" tabindex="0" class="direct-reports-list" :aria-label="`${userName}的直属下属`">
        <li v-for="person in reports" :key="person.id">
          <strong>{{ person.name }}</strong>
          <span>{{ person.deptName || '部门未设置' }} · {{ person.position || '岗位未设置' }}</span>
        </li>
      </ul>
      <p v-else class="direct-reports-hint">暂无在职直属下属</p>
    </div>
  </el-popover>
  <span v-else class="direct-reports-zero">0人</span>
</template>

<style scoped>
.direct-reports-title { display: block; margin-bottom: 8px; color: var(--el-text-color-primary); overflow-wrap: anywhere; }
.direct-reports-list { max-height: min(320px, 50vh); overflow: auto; overscroll-behavior: contain; list-style: none; padding: 0; margin: 0; }
.direct-reports-list li { display: grid; gap: 3px; padding: 8px 0; border-bottom: 1px solid var(--el-border-color-lighter); overflow-wrap: anywhere; }
.direct-reports-list li:last-child { border-bottom: 0; }
.direct-reports-list strong { color: var(--el-text-color-primary); }
.direct-reports-list span, .direct-reports-hint, .direct-reports-zero { color: var(--el-text-color-secondary); }
.direct-reports-hint { margin: 8px 0; }
.direct-reports-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
</style>
