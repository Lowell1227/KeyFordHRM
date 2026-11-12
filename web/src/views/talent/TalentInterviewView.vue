<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Refresh, ArrowLeft } from '@element-plus/icons-vue';
import { talentInterviewsApi } from '@/api/talent-pool.api';
import { INTERVIEW_STATUS_LABELS, type TalentInterviewView } from '@/types/talent.types';
import TalentInterviewContent from './components/TalentInterviewContent.vue';
import TalentInterviewPanel from './components/TalentInterviewPanel.vue';
import { useTalentPermissions } from './useTalentPermissions';
import { formatInterviewTime } from './interview-time';

const { canEdit } = useTalentPermissions();

const route = useRoute(), router = useRouter();
const loading = ref(false), error = ref('');
const scope = ref<'mine' | 'created'>('mine');
const detail = ref<TalentInterviewView | null>(null), list = ref<TalentInterviewView[]>([]);
let generation = 0;
async function load() {
  const current = ++generation;
  loading.value = true; error.value = ''; detail.value = null; list.value = [];
  try {
    if (typeof route.params.id === 'string') {
      const result = await talentInterviewsApi.detail(route.params.id);
      if (current === generation) detail.value = result;
    } else {
      const result = await talentInterviewsApi.list({ scope: canEdit.value ? scope.value : 'mine' });
      if (current === generation) list.value = result;
    }
  } catch {
    if (current === generation) error.value = '邀约无法读取或无权查看，请刷新重试';
  } finally { if (current === generation) loading.value = false; }
}
watch(() => [route.params.id, scope.value, canEdit.value], load, { immediate: true });
</script>

<template>
  <section v-loading="loading" class="interview-page">
    <div class="interview-page__toolbar">
      <el-tooltip v-if="route.params.id" content="我的面试邀约"><el-button :icon="ArrowLeft" aria-label="我的面试邀约" @click="router.push('/talent-interviews')" /></el-tooltip>
      <el-tooltip content="刷新"><el-button :icon="Refresh" aria-label="刷新" @click="load" /></el-tooltip>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <TalentInterviewPanel v-else-if="detail?.candidateId && canEdit" :key="detail.id" :candidate-id="detail.candidateId" :invitation-id="detail.id" editable />
    <TalentInterviewContent v-else-if="detail" :invitation="detail" />
    <template v-else-if="!route.params.id">
      <el-tabs v-if="canEdit" v-model="scope">
        <el-tab-pane label="我参与的" name="mine" />
        <el-tab-pane label="我发起的" name="created" />
      </el-tabs>
      <el-empty v-if="!loading && !list.length" description="暂无面试邀约" />
      <ul v-else class="interview-page__list">
        <li v-for="item in list" :key="item.id">
          <router-link :to="`/talent-interviews/${item.id}`">{{ item.candidateNameSnapshot }}</router-link>
          <span>{{ formatInterviewTime(item.startsAt) }}（北京时间）</span>
          <el-tag size="small">{{ INTERVIEW_STATUS_LABELS[item.status] }}</el-tag>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.interview-page { max-width: 960px; margin: 0 auto; padding: 16px; min-width: 0; }
.interview-page__toolbar { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 12px; }
.interview-page__toolbar .el-button { margin-left: 0; }
.interview-page__list { list-style: none; padding: 0; }
.interview-page__list li { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 16px 0; border-bottom: 1px solid var(--el-border-color-lighter); overflow-wrap: anywhere; }
.interview-page__list a { color: var(--el-color-primary); }
@media (max-width: 768px) { .interview-page { padding: 8px; } }
</style>
