<script setup lang="ts">
import { computed } from 'vue';
import { payrollEvidenceRows } from './payroll-workflow-presentation';
const props = defineProps<{ evidence: unknown }>();
const rows = computed(() => payrollEvidenceRows(props.evidence));
</script>
<template>
  <section class="calculation-evidence" data-testid="payroll-calculation-evidence">
    <dl><div v-for="(row, index) in rows" :key="index"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div></dl>
    <p v-if="!rows.length">该记录暂无可展示的计算明细，请核对原始依据。</p>
    <details><summary>高级追溯 · 原始计算依据</summary><pre>{{ JSON.stringify(evidence, null, 2) }}</pre></details>
  </section>
</template>
<style scoped>
.calculation-evidence{min-width:0;padding:0 12px;}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:12px 0;}dt{font-size:12px;color:var(--el-text-color-secondary);}dd{margin:4px 0 0;font-size:13px;overflow-wrap:anywhere;font-variant-numeric:tabular-nums;}p,summary{font-size:13px;overflow-wrap:anywhere;}summary{cursor:pointer;}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;}
@media(max-width:480px){dl{grid-template-columns:minmax(0,1fr);}}
</style>
