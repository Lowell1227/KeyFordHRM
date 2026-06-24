<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import * as echarts from 'echarts/core';
import { PieChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

interface ProgressItem {
  name: string;
  value: number;
}

const props = withDefaults(
  defineProps<{
    data: ProgressItem[];
    title?: string;
    height?: number;
  }>(),
  {
    title: '完成进度',
    height: 240,
  },
);

const chartRef = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;
let resizeObserver: ResizeObserver | null = null;

const COLORS = ['#1677ff', '#52c41a', '#faad14', '#f5222d', '#999'];

function render() {
  if (!chart) return;
  const option: EChartsCoreOption = {
    title: { text: props.title, left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0 },
    series: [
      {
        type: 'pie',
        radius: ['45%', '70%'],
        center: ['50%', '45%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 6,
          borderColor: '#fff',
          borderWidth: 2,
        },
        label: { show: true, formatter: '{b}\n{c}' },
        data: props.data.map((d, i) => ({
          ...d,
          itemStyle: { color: COLORS[i % COLORS.length] },
        })),
      },
    ],
  };
  chart.setOption(option);
}

onMounted(() => {
  if (!chartRef.value) return;
  echarts.use([PieChart]);
  requestAnimationFrame(() => {
    if (!chartRef.value) return;
    chart = echarts.init(chartRef.value);
    render();
    window.addEventListener('resize', handleResize);
    resizeObserver = new ResizeObserver(() => {
      chart?.resize();
    });
    resizeObserver.observe(chartRef.value);
  });
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  resizeObserver?.disconnect();
  resizeObserver = null;
  chart?.dispose();
  chart = null;
});

watch(() => props.data, render, { deep: true });
watch(() => props.title, render);

function handleResize() {
  chart?.resize();
}
</script>

<template>
  <div ref="chartRef" class="progress-pie-chart" :style="{ height: `${height}px` }" />
</template>

<style scoped>
.progress-pie-chart {
  width: 100%;
}
</style>
