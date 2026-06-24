<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import type { PerfGrade } from '@/types/enums';
import { GRADE_COLORS } from '@/types/enums';
import { getGradeLabel } from '@/utils/grade';

echarts.use([BarChart, TitleComponent, TooltipComponent, GridComponent, LegendComponent, CanvasRenderer]);

interface GradeDistItem {
  grade: PerfGrade;
  count: number;
}

const props = withDefaults(
  defineProps<{
    data: Record<PerfGrade, number> | GradeDistItem[];
    title?: string;
    height?: number;
  }>(),
  {
    title: '等级分布',
    height: 240,
  },
);

const chartRef = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;
let resizeObserver: ResizeObserver | null = null;

function normalizeData(): GradeDistItem[] {
  const data = props.data;
  if (Array.isArray(data)) {
    return data;
  }
  const grades: PerfGrade[] = ['A', 'B', 'C', 'D'];
  return grades.map((g) => ({ grade: g, count: data[g] ?? 0 }));
}

function render() {
  if (!chart) return;
  const list = normalizeData();
  const option: EChartsCoreOption = {
    title: { text: props.title, left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: {
      type: 'category',
      data: list.map((d) => getGradeLabel(d.grade)),
      axisTick: { alignWithLabel: true },
    },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        type: 'bar',
        data: list.map((d) => ({
          value: d.count,
          itemStyle: {
            color: GRADE_COLORS[d.grade].text,
          },
        })),
        barWidth: '40%',
        label: { show: true, position: 'top' },
      },
    ],
  };
  chart.setOption(option);
}

onMounted(() => {
  echarts.use([BarChart, TitleComponent, TooltipComponent, GridComponent, LegendComponent, CanvasRenderer]);
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
  <div ref="chartRef" class="grade-dist-chart" :style="{ height: `${height}px` }" />
</template>

<style scoped>
.grade-dist-chart {
  width: 100%;
}
</style>
