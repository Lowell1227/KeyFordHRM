<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { talentPoolApi } from '@/api/talent-pool.api';
import { INTERVIEW_STATUS_LABELS, type TalentDeleteImpact } from '@/types/talent.types';
import { useTalentPermissions } from '../useTalentPermissions';
import { formatInterviewTime } from '../interview-time';

const props = defineProps<{ modelValue: boolean; targets: Array<{ id: string; name: string }> }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; removed: [ids: string[]] }>();
const { canDelete } = useTalentPermissions();
const entries = ref<Array<{ id: string; name: string; impact: TalentDeleteImpact | null; error: string }>>([]);
const loading = ref(false);
const deleting = ref(false);
const deletedCount = ref(0);
let generation = 0;
const ready = computed(() => props.modelValue && canDelete.value && !loading.value && !deleting.value
  && entries.value.length > 0 && entries.value.every(item => item.impact));
const visible = computed({ get: () => props.modelValue && canDelete.value, set: value => { if (!deleting.value) emit('update:modelValue', value); } });

watch(() => props.modelValue, open => {
  ++generation;
  if (!open) return;
  deleting.value = false;
  loading.value = false;
  deletedCount.value = 0;
  entries.value = [...new Map(props.targets.map(item => [item.id, { ...item, impact: null, error: '' }])).values()];
  void loadImpacts();
});
onBeforeUnmount(() => { ++generation; });

async function loadImpacts() {
  if (!props.modelValue || !canDelete.value || deleting.value) return;
  const token = ++generation;
  loading.value = true;
  await Promise.all(entries.value.map(async item => {
    try {
      const impact = await talentPoolApi.deleteImpact(item.id);
      if (token !== generation) return;
      item.impact = impact; item.error = '';
    } catch (error) {
      if (token !== generation) return;
      const status = (error as { response?: { status?: number } }).response?.status;
      item.impact = null;
      item.error = status === 403 ? '无权删除此人才' : status === 404 ? '记录已删除或不可访问，请关闭后刷新列表' : '关联影响读取失败，请重试';
    }
  }));
  if (token === generation) loading.value = false;
}

async function confirmDelete() {
  if (!ready.value) return;
  const token = generation, removed: string[] = [];
  deleting.value = true;
  for (const item of entries.value) {
    if (token !== generation || !canDelete.value) break;
    try {
      await talentPoolApi.remove(item.id, { impactVersion: item.impact!.version, force: item.impact!.requiresForce });
      removed.push(item.id);
    } catch (error) {
      if (token !== generation) break;
      const response = (error as { response?: { status?: number; data?: { data?: { impact?: TalentDeleteImpact } } } }).response;
      const latest = response?.data?.data?.impact;
      if (response?.status === 409 && latest?.candidateId === item.id) {
        item.impact = latest;
        item.error = '关联影响已变化，请重新核对后删除';
      } else if (response?.status === 401 || response?.status === 403) {
        item.impact = null;
        item.error = '当前账号无权删除，请核对权限';
        break;
      } else {
        item.error = '删除结果未确认，可重试；已完成的记录不会重复删除';
      }
    }
  }
  if (token !== generation) return;
  deleting.value = false;
  deletedCount.value += removed.length;
  entries.value = entries.value.filter(item => !removed.includes(item.id));
  if (removed.length) emit('removed', removed);
  if (!entries.value.length) {
    ElMessage.success(`已删除 ${deletedCount.value} 条人才记录`);
    visible.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="删除人才" width="min(560px, 94vw)" append-to-body
    :close-on-click-modal="false" :close-on-press-escape="!deleting" :show-close="!deleting">
    <p v-if="deletedCount" role="status">已删除 {{ deletedCount }} 项，剩余 {{ entries.length }} 项未完成。</p>
    <p v-else>将删除以下 {{ entries.length }} 条人才记录，请核对。</p>
    <p class="talent-delete__hint">人才将从列表移除，不删除员工档案。关联面试、钉钉日程和入职申请不会自动取消，需分别处理。</p>
    <div v-loading="loading" class="talent-delete__list">
      <div v-for="item in entries" :key="item.id" class="talent-delete__item">
        <strong>{{ item.name }}</strong>
        <div v-if="item.impact" class="talent-delete__hint">
          待进行面试 {{ item.impact.interviews.length }} 项 · 办理中入职 {{ item.impact.requests.length }} 项
          <ul v-if="item.impact.interviews.length || item.impact.requests.length" class="talent-delete__details">
            <li v-for="interview in item.impact.interviews" :key="interview.id">面试：{{ formatInterviewTime(interview.startsAt) }}（北京时间） · {{ INTERVIEW_STATUS_LABELS[interview.status] }}</li>
            <li v-for="request in item.impact.requests" :key="request.id">入职申请 {{ request.id.slice(0, 8) }}：{{ ({ draft: '草稿', submitted: '审核中', pending_entry: '待到岗' } as Record<string, string>)[request.onboardingStatus] ?? request.recordStatus }}</li>
          </ul>
        </div>
        <div v-if="item.error" class="talent-delete__error" role="alert">{{ item.error }}</div>
      </div>
    </div>
    <template #footer>
      <el-button :disabled="deleting" @click="visible = false">{{ deletedCount ? '关闭' : '取消' }}</el-button>
      <el-button v-if="!loading && entries.some(item => !item.impact)" :disabled="deleting" @click="loadImpacts">重试读取</el-button>
      <el-button type="danger" :loading="deleting" :disabled="!ready" @click="confirmDelete">删除</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.talent-delete__list { max-height: 45vh; overflow-y: auto; }
.talent-delete__item { padding: 10px 0; border-bottom: 1px solid var(--el-border-color-lighter); overflow-wrap: anywhere; }
.talent-delete__details { margin: 6px 0 0; padding-left: 20px; }
.talent-delete__hint { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; }
.talent-delete__error { color: var(--el-color-danger); font-size: 13px; }
</style>
