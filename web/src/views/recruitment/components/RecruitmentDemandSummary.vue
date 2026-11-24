<script setup lang="ts">
import type { RecruitmentDemandSnapshot, RecruitmentDemandView } from '@/types/recruitment-demand.types';
import { DEMAND_SOURCE_LABELS, safeDemandSourceLink } from '../demand-presentation';
import RecruitmentDemandSeats from './RecruitmentDemandSeats.vue';
defineProps<{ snapshot: RecruitmentDemandSnapshot; current: RecruitmentDemandView | null }>();
</script>

<template>
  <section class="demand-summary" aria-label="录用需求依据">
    <h5>提交录用时的需求快照</h5>
    <dl><dt>需求单</dt><dd>{{ snapshot.instanceId }} · 版本 {{ snapshot.revision }}</dd><dt>部门 / 岗位</dt><dd>{{ snapshot.departmentName }} / {{ snapshot.positionName }}</dd><dt>批准人数</dt><dd>{{ snapshot.approvedHeadcount }}</dd><dt>原单</dt><dd><a v-if="safeDemandSourceLink(snapshot.sourceLink)" :href="safeDemandSourceLink(snapshot.sourceLink)" target="_blank" rel="noopener noreferrer">查看钉钉原单</a><span v-else>未提供可用链接</span></dd></dl>
    <h5>需求当前状态</h5>
    <p v-if="current">版本 {{ current.revision }} · {{ DEMAND_SOURCE_LABELS[current.sourceState] }} · {{ current.usable ? '已核对，可使用' : '待核对或不可使用' }}</p>
    <p v-else>当前需求未取得；提交时快照保留。</p>
    <RecruitmentDemandSeats :value="current" />
    <p v-if="current && current.revision !== snapshot.revision" class="changed">需求已有后续变更，以上快照为本次提交时的依据，不代表当前状态。</p>
  </section>
</template>

<style scoped>
.demand-summary { border-top: 1px solid var(--el-border-color-lighter); margin-top: 16px; padding-top: 12px; font-size: 13px; overflow-wrap: anywhere; }
h5 { margin: 8px 0; font-size: 13px; }
dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px; }
dt { color: var(--el-text-color-secondary); } dd { margin: 0; }
p { line-height: 1.7; } .changed { color: var(--el-color-warning-dark-2); }
</style>
