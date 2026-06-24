<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([LineChart, TitleComponent, TooltipComponent, GridComponent, LegendComponent, CanvasRenderer]);

interface TrendItem {
  cycleName: string;
  averageScore: number;
}

const props = withDefaults(
  defineProps<{
    data: TrendItem[];
    title?: string;
    height?: number;
  }>(),
  {
    title: '均分趋势',
    height: 240,
  },
);

const chartRef = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;
let resizeObserver: ResizeObserver | null = null;

function render() {
  if (!chart) return;
  const option: EChartsCoreOption = {
    title: { text: props.title, left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: props.data.map((d) => d.cycleName),
    },
    yAxis: { type: 'value', min: 0, max: 100 },
    series: [
      {
        type: 'line',
        data: props.data.map((d) => d.averageScore),
        smooth: true,
        areaStyle: {
          color: 'rgba(22, 119, 255, 0.1)',
        },
        itemStyle: { color: '#1677ff' },
        lineStyle: { width: 3 },
        label: { show: true, formatter: '{c}' },
      },
    ],
  };
  chart.setOption(option);
}

onMounted(() => {
  echarts.use([LineChart, TitleComponent, TooltipComponent, GridComponent, LegendComponent, CanvasRenderer]);
  if (!chartRef.value) return;
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
  <div ref="chartRef" class="score-trend-chart" :style="{ height: `${height}px` }" />
</template>

<style scoped>
.score-trend-chart {
  width: 100%;
}
</style>
