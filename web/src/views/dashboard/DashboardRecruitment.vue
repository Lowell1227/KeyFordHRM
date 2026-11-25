<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowRight, Refresh } from '@element-plus/icons-vue';
import { talentRecruitmentApi } from '@/api/talent-recruitment.api';
import { useAuthStore } from '@/stores/auth.store';
import type { RecruitmentWorkbenchGroup, RecruitmentWorkbenchItem, RecruitmentWorkbenchKey } from '@/types/talent.types';

const auth = useAuthStore(), router = useRouter();
const groups = ref<RecruitmentWorkbenchGroup[]>([]), activeKey = ref<RecruitmentWorkbenchKey>('interview');
const loading = ref(false), error = ref('');
let session = 0;
const labels: Record<RecruitmentWorkbenchKey, string> = {
  follow_up: '待跟进', interview: '待参加面试', feedback: '待补反馈', hiring_review: '待录用确认', onboarding: '待办入职',
  intake_review: '待核对简历', intake_assignment: '待归岗位', entry_overdue: '到岗日期已过待确认',
};
const current = computed(() => groups.value.find(group => group.key === activeKey.value));
const total = computed(() => loading.value || error.value ? null : groups.value.reduce((sum, group) => sum + group.total, 0));
async function load() {
  const token = ++session, userId = auth.user?.id;
  if (!userId || auth.user?.isAssessorOnly) { groups.value = []; loading.value = false; error.value = ''; return; }
  loading.value = true; error.value = '';
  try {
    const result = await talentRecruitmentApi.workbench();
    if (token !== session || auth.user?.id !== userId) return;
    groups.value = result.groups;
    if (!result.groups.some(group => group.key === activeKey.value && group.total)) {
      activeKey.value = result.groups.find(group => group.total)?.key ?? result.groups[0]?.key ?? 'interview';
    }
  } catch {
    if (token === session) { groups.value = []; error.value = '招聘事项读取失败，请重试'; }
  } finally { if (token === session) loading.value = false; }
}
function open(key: RecruitmentWorkbenchKey, item: RecruitmentWorkbenchItem) {
  if (key === 'intake_review' || key === 'intake_assignment') {
    if (item.intakeId && auth.user?.id) void router.push({ path: '/recruitment/intakes', query: { workQueue: key === 'intake_review' ? 'review' : 'assignment', ownerId: auth.user.id, intakeId: item.intakeId } });
  } else if (key === 'entry_overdue') {
    if (item.onboardingRequestId) void router.push({ path: '/entry-exit', query: { requestId: item.onboardingRequestId } });
    else if (item.candidateId && item.applicationId) void router.push({ path: '/talent-interviews', query: { work: 'applications', scope: 'all', overdueOnly: 'true', candidateId: item.candidateId, applicationId: item.applicationId } });
  } else if (key === 'interview' || key === 'feedback') void router.push({ path: `/talent-interviews/${item.id}`, query: { work: 'interviews', scope: 'mine', bucket: key === 'feedback' ? 'feedback' : 'upcoming' } });
  else if (key === 'hiring_review') void router.push({ path: '/talent-hiring', query: { applicationId: item.id } });
  else if (key === 'onboarding' && item.candidateId && item.applicationId) {
    void router.push({ path: '/entry-exit', query: { talentId: item.candidateId, talentApplicationId: item.applicationId } });
  } else if (item.candidateId) void router.push({ path: '/talents', query: { candidateId: item.candidateId } });
}
function openAll(key: RecruitmentWorkbenchKey) {
  if (key === 'intake_review' || key === 'intake_assignment') {
    if (auth.user?.id) void router.push({ path: '/recruitment/intakes', query: { workQueue: key === 'intake_review' ? 'review' : 'assignment', ownerId: auth.user.id } });
  }
  else if (key === 'entry_overdue') void router.push({ path: '/talent-interviews', query: { work: 'applications', scope: 'all', overdueOnly: 'true' } });
  else if (key === 'interview' || key === 'feedback') void router.push({ path: '/talent-interviews', query: { work: 'interviews', scope: 'mine', bucket: key === 'feedback' ? 'feedback' : 'upcoming' } });
  else if (key === 'hiring_review') void router.push('/talent-hiring');
  else void router.push({ path: '/talents', query: key === 'follow_up'
    ? { responsibilityScope: 'talent', dueOnly: 'true' }
    : { responsibilityScope: 'application', applicationStage: 'accepted' } });
}
function dateLabel(group: RecruitmentWorkbenchKey, value: string | null) {
  if (!value) return '';
  if (group === 'follow_up' || group === 'onboarding' || group === 'entry_overdue') return value.slice(0, 10);
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
watch(() => [auth.user?.id, auth.user?.isAssessorOnly], () => { groups.value = []; void load(); }, { immediate: true });
onBeforeUnmount(() => { ++session; });
</script>

<template>
  <section v-if="auth.user && !auth.user.isAssessorOnly" v-loading="loading" class="dashboard-recruitment" data-testid="dashboard-recruitment">
    <header><h2>招聘事项 <span v-if="total !== null">{{ total }}</span></h2><el-tooltip content="刷新招聘事项"><el-button :icon="Refresh" circle aria-label="刷新招聘事项" :loading="loading" @click="load" /></el-tooltip></header>
    <el-alert v-if="error" :title="error" type="error" :closable="false"><el-button link @click="load">重试</el-button></el-alert>
    <p v-else-if="loading" class="empty" role="status">正在读取招聘事项</p>
    <el-tabs v-else-if="groups.length" v-model="activeKey">
      <el-tab-pane v-for="group in groups" :key="group.key" :name="group.key" :label="`${labels[group.key]} ${group.total}`">
        <ul v-if="group.items.length">
          <li v-for="item in group.items" :key="item.id"><button type="button" @click="open(group.key, item)"><strong>{{ item.title }}</strong><span>{{ item.subtitle }}<template v-if="item.nextAction"><small>经办：{{ item.ownerName || '待核对' }} · {{ item.nextAction }}</small></template></span><time v-if="item.date">{{ dateLabel(group.key, item.date) }}</time><el-icon><ArrowRight /></el-icon></button></li>
        </ul>
        <p v-else-if="!loading" class="empty">暂无{{ labels[group.key] }}事项</p>
      </el-tab-pane>
    </el-tabs>
    <p v-else-if="!loading" class="empty">暂无招聘事项</p>
    <footer v-if="current && !error && !loading"><span>{{ current.total > current.items.length ? `显示前 ${current.items.length} 条，共 ${current.total} 条` : '' }}</span><el-button link type="primary" :icon="ArrowRight" @click="openAll(current.key)">{{ current.key.startsWith('intake_') ? '全部收件' : current.key === 'entry_overdue' || current.key === 'hiring_review' ? '全部申请' : current.key === 'interview' || current.key === 'feedback' ? '全部邀约' : '人才库' }}</el-button></footer>
  </section>
</template>

<style scoped>
.dashboard-recruitment { padding: 16px 0; border-top: 1px solid var(--el-border-color-light); min-width: 0; }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { font-size: 16px; margin: 0; } h2 span, footer, .empty { color: var(--el-text-color-secondary); font-size: 13px; }
ul { list-style: none; margin: 0; padding: 0; }
li { border-bottom: 1px solid var(--el-border-color-lighter); }
li button { width: 100%; min-height: 48px; padding: 10px 4px; display: grid; grid-template-columns: minmax(100px, 1fr) minmax(0, 2fr) auto 20px; gap: 12px; align-items: center; border: 0; background: transparent; text-align: left; cursor: pointer; color: var(--el-text-color-primary); font: inherit; }
li button:hover { background: var(--el-fill-color-light); }
li strong, li span { overflow-wrap: anywhere; min-width: 0; }
li span, li time { color: var(--el-text-color-secondary); font-size: 13px; }
li small { display: block; font-size: 12px; margin-top: 4px; }
footer { margin-top: 10px; }
@media (max-width: 767px) { li button { grid-template-columns: minmax(0, 1fr) 20px; gap: 6px; } li span, li time { grid-column: 1; } li .el-icon { grid-column: 2; grid-row: 1 / 4; } }
</style>
