<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Refresh, ArrowRight } from '@element-plus/icons-vue';
import { talentInterviewsApi } from '@/api/talent-pool.api';
import type { TalentInterviewView } from '@/types/talent.types';

const router = useRouter();
const rows = ref<TalentInterviewView[]>([]);
const loading = ref(false);
const error = ref(false);
const upcoming = computed(() => rows.value.filter(row => row.status === 'scheduled' && new Date(row.endsAt).getTime() >= Date.now())
  .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()));
const formatTime = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai',
}).format(new Date(value));
async function load() {
  loading.value = true; error.value = false;
  try { rows.value = await talentInterviewsApi.list({ scope: 'mine' }); }
  catch { error.value = true; }
  finally { loading.value = false; }
}
onMounted(load);
</script>

<template>
  <section v-loading="loading" class="dashboard-interviews" data-testid="dashboard-interviews">
    <header>
      <h2>我的面试 <span v-if="upcoming.length">{{ upcoming.length }}</span></h2>
      <div>
        <el-tooltip content="刷新面试邀约"><el-button :icon="Refresh" circle aria-label="刷新面试邀约" :loading="loading" @click="load" /></el-tooltip>
        <el-button link type="primary" :icon="ArrowRight" @click="router.push('/talent-interviews')">全部邀约</el-button>
      </div>
    </header>
    <el-alert v-if="error" title="面试邀约加载失败，请重试" type="error" :closable="false" />
    <ul v-else-if="upcoming.length">
      <li v-for="row in upcoming.slice(0, 5)" :key="row.id">
        <button type="button" @click="router.push(`/talent-interviews/${row.id}`)">
          <strong>{{ row.candidateNameSnapshot }}</strong>
          <time>{{ formatTime(row.startsAt) }} 至 {{ formatTime(row.endsAt) }}</time>
          <span>{{ row.participantNames.join('、') }}</span>
          <el-icon><ArrowRight /></el-icon>
        </button>
      </li>
    </ul>
    <p v-else-if="!loading" class="empty">暂无待参加的面试</p>
  </section>
</template>

<style scoped>
.dashboard-interviews { padding: 16px 0; border-top: 1px solid var(--el-border-color-light); }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
h2 { font-size: 16px; margin: 0; } h2 span { color: var(--el-text-color-secondary); font-size: 13px; }
header > div { display: flex; align-items: center; gap: 12px; }
ul { list-style: none; margin: 12px 0 0; padding: 0; }
li { border-bottom: 1px solid var(--el-border-color-lighter); }
li button { width: 100%; min-height: 48px; padding: 10px 4px; display: grid; grid-template-columns: minmax(100px, 1fr) minmax(240px, 1fr) minmax(100px, 2fr) 20px; gap: 12px; align-items: center; border: 0; background: transparent; text-align: left; cursor: pointer; color: var(--el-text-color-primary); }
li button:hover { background: var(--el-fill-color-light); }
li strong, li span { overflow-wrap: anywhere; min-width: 0; }
li time, li span, .empty { color: var(--el-text-color-secondary); font-size: 13px; }
@media (max-width: 767px) { li button { grid-template-columns: minmax(0, 1fr) 20px; gap: 6px; } li time, li span { grid-column: 1; } li .el-icon { grid-column: 2; grid-row: 1 / 4; } }
</style>
