<script setup lang="ts">
import { computed } from 'vue';
import { payrollTimeline } from './payroll-workflow-presentation';
const props = defineProps<{ records: unknown[]; person?: (id: string) => string }>();
const rows = computed(() => payrollTimeline(props.records, props.person));
</script>
<template>
  <section class="business-records" data-testid="payroll-business-records">
    <el-timeline v-if="rows.length"><el-timeline-item v-for="(row, index) in rows" :key="index" :timestamp="row.time"><strong>{{ row.title }}</strong><p>{{ row.actor }}</p><p v-if="row.note">{{ row.note }}</p></el-timeline-item></el-timeline>
    <p v-else>暂无办理记录</p>
  </section>
</template>
<style scoped>
.business-records{min-width:0;overflow-wrap:anywhere;padding-top:12px;}strong,p{font-size:13px;line-height:1.6;}strong{font-weight:500;}p{margin:4px 0;} :deep(.el-timeline){padding-left:6px;}
</style>
