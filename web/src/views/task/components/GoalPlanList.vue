<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  GOAL_STEP_LABELS,
  goalPlansApi,
  type GoalScope,
  type GoalPlanItem,
} from '@/api/goal-plans.api';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import { useVisibleRefresh } from '@/composables/useVisibleRefresh';
import { useAuthStore } from '@/stores/auth.store';
const props = defineProps<{ scope: GoalScope; allowed: boolean }>();
const emit = defineEmits<{ refreshed: [total: number | null] }>();
const auth = useAuthStore();
const router = useRouter(),
  route = useRoute();
const items = ref<GoalPlanItem[]>([]),
  total = ref(0),
  page = ref(1),
  loading = ref(false),
  error = ref(''),
  optionsError = ref('');
const cycleId = ref(''),
  deptId = ref(''),
  employeeName = ref('');
const options = ref<{
  cycles: { id: string; name: string }[];
  departments: { id: string; name: string }[];
}>({ cycles: [], departments: [] });
let request = 0;
const accessDenied = ref(false), appliedQuery = ref('');
const queryKey = () => JSON.stringify([props.scope, cycleId.value, deptId.value, employeeName.value, page.value]);
const refreshBlocked = () => loading.value || queryKey() !== appliedQuery.value;
const title = computed(
  () =>
    ({ mine: '我的计划', review: '待我审核', monitor: '计划进度' })[
      props.scope
    ],
);
async function load() {
  accessDenied.value = false;
  return fetchPlans(false);
}
async function fetchPlans(background: boolean, canApply = () => true) {
  if (background && (refreshBlocked() || accessDenied.value)) return;
  const serial = ++request;
  if (!props.allowed) return;
  const key = queryKey(), scope = props.scope;
  const unfiltered = !cycleId.value && !deptId.value && !employeeName.value;
  if (!background) { loading.value = true; error.value = ''; appliedQuery.value = key; }
  const current = () => serial === request && props.allowed && key === queryKey()
    && (!background || (canApply() && !refreshBlocked()));
  try {
    if (!background) await router.replace({
      path: '/tasks',
      query: { ...route.query, cycleId: cycleId.value || undefined, deptId: deptId.value || undefined,
        employeeName: employeeName.value || undefined, page: page.value > 1 ? String(page.value) : undefined },
    });
    if (serial !== request || !props.allowed) return;
    const result = await goalPlansApi.findAll({
      scope,
      cycleId: cycleId.value || undefined,
      deptId: deptId.value || undefined,
      employeeName: employeeName.value || undefined,
      page: page.value,
      pageSize: 20,
    });
    if (current()) {
      items.value = result.items;
      total.value = result.total;
      error.value = '';
      if (scope === 'review' && unfiltered) emit('refreshed', result.total);
    }
  } catch (cause) {
    if (serial !== request || !props.allowed) return;
    const status = (cause as { response?: { status?: number } })?.response?.status;
    if (status === 401 || status === 403) {
      accessDenied.value = true; items.value = []; total.value = 0; options.value = { cycles: [], departments: [] };
      error.value = '当前无权读取目标计划，请重新登录或联系管理员';
    } else if (current()) {
      if (!background) items.value = [];
      error.value = '目标计划更新失败，请重试';
    } else return;
    if (scope === 'review' && (unfiltered || accessDenied.value)) emit('refreshed', null);
  } finally {
    if (!background && serial === request) loading.value = false;
  }
}
useVisibleRefresh({ enabled: () => props.allowed && !accessDenied.value,
  blocked: refreshBlocked, refresh: guard => fetchPlans(true, guard) });
onUnmounted(() => { request++; });
watch(
  () => [props.scope, props.allowed, auth.user],
  async () => {
    const serial = ++request;
    items.value = []; total.value = 0; loading.value = false; accessDenied.value = false;
    page.value = Math.max(1, Number(route.query.page) || 1);
    cycleId.value =
      typeof route.query.cycleId === 'string' ? route.query.cycleId : '';
    deptId.value =
      typeof route.query.deptId === 'string' ? route.query.deptId : '';
    employeeName.value =
      typeof route.query.employeeName === 'string'
        ? route.query.employeeName
        : '';
    optionsError.value = '';
    options.value = { cycles: [], departments: [] };
    if (props.allowed) {
      try {
        const result = await goalPlansApi.options(props.scope);
        if (serial !== request) return;
        options.value = result;
      } catch {
        if (serial !== request) return;
        optionsError.value = '筛选选项加载失败，请刷新页面重试';
      }
    }
    if (serial !== request || !props.allowed) return;
    await load();
  },
  { immediate: true },
);
function open(item: GoalPlanItem) {
  router.push({
    path: `/tasks/${item.id}`,
    query: {
      goalView: props.scope === 'monitor' ? 'monitor' : undefined,
      stage:
        item.status === 'indicator_confirming' ||
        item.status === 'indicator_approving'
          ? 'goal-confirmation'
          : 'goal-setting',
      returnTo: route.fullPath,
    },
  });
}
function search() {
  page.value = 1;
  void load();
}
</script>
<template>
  <BusinessListPage
    variant="workflow"
    :loading="loading"
    data-testid="goal-plan-list"
  >
    <template #subtitle>{{ title }} · 目标内容与审批进度</template>
    <template #filters
      ><div class="goal-filters" v-if="allowed">
        <el-select
          v-model="cycleId"
          placeholder="全部周期"
          clearable
          aria-label="考核周期"
          @change="search"
          ><el-option
            v-for="c in options.cycles"
            :key="c.id"
            :label="c.name"
            :value="c.id"
        /></el-select>
        <el-select
          v-model="deptId"
          placeholder="全部部门"
          clearable
          aria-label="部门"
          @change="search"
          ><el-option
            v-for="d in options.departments"
            :key="d.id"
            :label="d.name"
            :value="d.id"
        /></el-select>
        <el-input
          v-model="employeeName"
          placeholder="员工姓名"
          aria-label="员工姓名"
          clearable
          @keyup.enter="search"
        /><el-button @click="search">查询</el-button>
      </div></template
    >
    <template #feedback
      ><el-alert
        v-if="!allowed"
        title="无权查看全员目标计划"
        type="warning"
        :closable="false"
      /><el-alert v-if="optionsError" :title="optionsError" type="warning" :closable="false" />
      <el-alert v-if="error" :title="error" type="error" :closable="false"
        ><el-button @click="load">重试</el-button></el-alert
      ></template
    >
    <template #desktop-list
      ><el-table :data="items" empty-text="暂无目标计划"
        ><el-table-column
          prop="employeeName"
          label="员工"
          min-width="100"
        /><el-table-column
          prop="deptName"
          label="部门"
          min-width="130"
        /><el-table-column
          prop="cycleName"
          label="考核周期"
          min-width="180"
        /><el-table-column label="当前阶段" min-width="180"
          ><template #default="{ row }">{{
            GOAL_STEP_LABELS[row.currentStep as keyof typeof GOAL_STEP_LABELS]
          }}</template></el-table-column
        ><el-table-column
          prop="currentHandlerName"
          label="当前办理人"
          min-width="110"
        /><el-table-column label="操作" width="110" fixed="right"
          ><template #default="{ row }"
            ><el-button
              link
              type="primary"
              @click="open(row as GoalPlanItem)"
              >{{ scope === 'review' ? '办理目标' : '查看计划' }}</el-button
            ></template
          ></el-table-column
        ></el-table
      ></template
    >
    <template #mobile-list
      ><el-empty
        v-if="!items.length"
        description="暂无目标计划"
      /><MobileResultCard
        v-for="item in items"
        :key="item.id"
        class="goal-mobile"
        ><template #title
          >{{ item.employeeName }} · {{ item.deptName }}</template
        >
        <p>{{ item.cycleName }}</p>
        <p>{{ GOAL_STEP_LABELS[item.currentStep] }}</p>
        <p>当前办理人：{{ item.currentHandlerName || '—' }}</p>
        <template #actions
          ><el-button @click="open(item)">{{
            scope === 'review' ? '办理目标' : '查看计划'
          }}</el-button></template
        ></MobileResultCard
      ></template
    >
    <template #pagination
      ><el-pagination
        v-model:current-page="page"
        :total="total"
        :page-size="20"
        layout="prev, pager, next"
        @current-change="load"
    /></template>
  </BusinessListPage>
</template>
<style scoped>
.goal-filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.goal-filters .el-select,
.goal-filters .el-input {
  width: 190px;
}
.goal-mobile {
  padding: 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  overflow-wrap: anywhere;
}
.goal-mobile p {
  margin: 8px 0;
}
@media (max-width: 768px) {
  .goal-filters .el-select,
  .goal-filters .el-input {
    width: 100%;
  }
}
</style>
