<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Search } from '@element-plus/icons-vue';
import { tasksApi } from '@/api/tasks.api';
import { OBJECTIVE_LEVEL_LABELS } from '@/types/enums';
import type { IndicatorInstance, IndicatorReferenceItem } from '@/types/api.types';

const props = withDefaults(defineProps<{
  cycleId?: string;
  employeeId?: string;
  indicators?: IndicatorInstance[];
}>(), {
  cycleId: undefined,
  employeeId: undefined,
  indicators: () => [],
});

const references = ref<IndicatorReferenceItem[]>([]);
const loading = ref(false);
let requestSerial = 0;

const alignedTargets = computed(() => props.indicators.flatMap((indicator) => (
  indicator.alignedObjectives.map((objective) => ({
    id: `${indicator.id}:${objective.id}`,
    indicatorName: indicator.name,
    objective,
  }))
)));

function formatWeight(weight: number): string {
  const percent = weight <= 1 ? weight * 100 : weight;
  return `${Number(percent.toFixed(2))}%`;
}

async function loadReferences(keyword = '') {
  if (!props.cycleId || !props.employeeId) {
    references.value = [];
    return;
  }
  const requestId = ++requestSerial;
  loading.value = true;
  try {
    const response = await tasksApi.findReferenceIndicators({
      page: 1,
      pageSize: 20,
      cycleId: props.cycleId,
      ownerId: props.employeeId,
      keyword: keyword.trim() || undefined,
    });
    if (requestId === requestSerial) references.value = response.items ?? [];
  } catch {
    if (requestId === requestSerial) references.value = [];
  } finally {
    if (requestId === requestSerial) loading.value = false;
  }
}

watch(
  () => [props.cycleId, props.employeeId],
  () => { void loadReferences(); },
  { immediate: true },
);
</script>

<template>
  <aside class="goal-review-reference" data-testid="goal-review-reference-panel">
    <p class="goal-review-reference__purpose">
      仅用于判断员工目标是否与上级、部门方向一致；不参与权重计算，也不直接决定审核结果。
    </p>

    <section class="goal-review-reference__section">
      <header>
        <h3>本次已对齐</h3>
        <span>{{ alignedTargets.length }} 项</span>
      </header>
      <p class="goal-review-reference__hint">员工已关联到本次指标的上级或部门目标</p>
      <ul v-if="alignedTargets.length" class="goal-review-reference__list">
        <li v-for="item in alignedTargets" :key="item.id">
          <div>
            <strong>{{ item.objective.title }}</strong>
            <span>{{ OBJECTIVE_LEVEL_LABELS[item.objective.level] }} · 对应“{{ item.indicatorName }}”</span>
          </div>
        </li>
      </ul>
      <el-empty v-else :image-size="46" description="本次目标尚未设置对齐关系" />
    </section>

    <section class="goal-review-reference__section">
      <header>
        <h3>其他可参考目标</h3>
        <span>{{ references.length }} 项</span>
      </header>
      <p class="goal-review-reference__hint">该员工有权查看、但本次尚未关联的目标</p>
      <el-input
        aria-label="搜索可参考目标"
        clearable
        :prefix-icon="Search"
        placeholder="搜索目标名称"
        @input="loadReferences"
        @clear="loadReferences()"
      />
      <ul v-loading="loading" class="goal-review-reference__list">
        <li v-for="reference in references" :key="reference.id">
          <div>
            <strong>{{ reference.name }}</strong>
            <span>{{ reference.employeeName }} · 权重 {{ formatWeight(reference.weight) }}</span>
          </div>
        </li>
      </ul>
      <el-empty v-if="!loading && !references.length" :image-size="46" description="暂无其他可参考目标" />
    </section>
  </aside>
</template>

<style scoped>
.goal-review-reference {
  display: grid;
  gap: 20px;
  padding: 0 16px 18px;
}

.goal-review-reference__purpose {
  margin: 0;
  padding: 11px 12px;
  border-radius: 8px;
  color: #53657d;
  background: #eef5ff;
  font-size: 12px;
  line-height: 1.7;
}

.goal-review-reference__section header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.goal-review-reference__section h3 {
  margin: 0;
  color: #253047;
  font-size: 15px;
}

.goal-review-reference__section header span,
.goal-review-reference__hint,
.goal-review-reference__list span {
  color: #8490a3;
  font-size: 12px;
}

.goal-review-reference__hint {
  margin: 4px 0 10px;
}

.goal-review-reference__list {
  min-height: 30px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.goal-review-reference__list li {
  padding: 11px 0;
  border-bottom: 1px solid #edf0f5;
}

.goal-review-reference__list li:last-child {
  border-bottom: 0;
}

.goal-review-reference__list strong,
.goal-review-reference__list span {
  display: block;
}

.goal-review-reference__list strong {
  color: #344054;
  font-size: 13px;
  line-height: 1.6;
}

.goal-review-reference__list span {
  margin-top: 3px;
  line-height: 1.5;
}
</style>
