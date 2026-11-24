<script setup lang="ts">
import { computed } from 'vue';
import { describeDemandSeats, type DemandSeatValues } from '../demand-seat-presentation';

const props = defineProps<{ value: DemandSeatValues | null }>();
const fields = computed(() => describeDemandSeats(props.value));
</script>

<template>
  <section class="demand-seats" aria-label="招聘名额">
    <dl>
      <div><dt>已接受待到岗</dt><dd>{{ fields.accepted }}</dd></div>
      <div><dt>已到岗</dt><dd>{{ fields.hired }}</dd></div>
      <div><dt>剩余名额</dt><dd>{{ fields.remaining }}</dd></div>
    </dl>
    <p v-if="fields.over && fields.over > 0">超出批准人数 {{ fields.over }} 人</p>
  </section>
</template>

<style scoped>
.demand-seats { padding: 12px 0; border-top: 1px solid var(--el-border-color-lighter); }
dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 0; }
dl > div { min-width: 0; }
dt { font-size: 13px; line-height: 1.5; color: var(--el-text-color-secondary); overflow-wrap: anywhere; }
dd { margin: 6px 0 0; font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
p { margin: 10px 0 0; color: var(--el-color-warning-dark-2); font-size: 13px; }
</style>
