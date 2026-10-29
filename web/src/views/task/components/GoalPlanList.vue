<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  GOAL_STEP_LABELS,
  goalPlansApi,
  type GoalScope,
  type GoalPlanItem,
} from '@/api/goal-plans.api';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
const props = defineProps<{ scope: GoalScope; allowed: boolean }>();
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
const title = computed(
  () =>
    ({ mine: '我的计划', review: '待我审核', monitor: '计划进度' })[
      props.scope
    ],
);
async function load() {
  const serial = ++request;
  error.value = '';
  items.value = [];
  if (!props.allowed) return;
  await router.replace({
    path: '/tasks',
    query: {
      ...route.query,
      cycleId: cycleId.value || undefined,
      deptId: deptId.value || undefined,
      employeeName: employeeName.value || undefined,
      page: page.value > 1 ? String(page.value) : undefined,
    },
  });
  loading.value = true;
  try {
    const result = await goalPlansApi.findAll({
      scope: props.scope,
      cycleId: cycleId.value || undefined,
      deptId: deptId.value || undefined,
      employeeName: employeeName.value || undefined,
      page: page.value,
      pageSize: 20,
    });
    if (serial === request) {
      items.value = result.items;
      total.value = result.total;
    }
  } catch {
    if (serial === request) error.value = '目标计划加载失败，请重试';
  } finally {
    if (serial === request) loading.value = false;
  }
}
watch(
  () => props.scope,
  async () => {
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
        options.value = await goalPlansApi.options(props.scope);
      } catch {
        optionsError.value = '筛选选项加载失败，请刷新页面重试';
      }
    }
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
      /><el-alert v-if="error" :title="error" type="error" :closable="false"
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
