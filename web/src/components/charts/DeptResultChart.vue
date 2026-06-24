<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { TooltipComponent, GridComponent, LegendComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([BarChart, TooltipComponent, GridComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);

interface SeriesItem {
  name: string;
  data: number[];
  color?: string;
}

const props = withDefaults(
  defineProps<{
    /** Y 轴分类，如「全公司」「财务部」 */
    categories: string[];
    /** 堆叠系列 */
    series: SeriesItem[];
    height?: number;
  }>(),
  {
    height: 280,
  },
);

const chartRef = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;
let resizeObserver: ResizeObserver | null = null;

function render() {
  if (!chart) return;
  const needsScroll = props.categories.length > 9;
  const lastIndex = props.series.length - 1;
  const option: EChartsCoreOption = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter(params: unknown) {
        const items = Array.isArray(params) ? params : [];
        const title = (items[0] as { axisValue?: string } | undefined)?.axisValue ?? '';
        const rows = items
          .map((item) => {
            const p = item as { marker?: string; seriesName?: string; value?: number };
            return `${p.marker ?? ''}${p.seriesName ?? ''}<span style="float:right;margin-left:18px;font-weight:700;">${p.value ?? 0}</span>`;
          })
          .join('<br/>');
        return `<div style="font-weight:700;margin-bottom:6px;">${title}</div>${rows}`;
      },
    },
    legend: {
      top: 0,
      right: 0,
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 16,
      textStyle: { color: '#646a73', fontSize: 12 },
    },
    grid: { left: 116, right: needsScroll ? 34 : 20, bottom: 24, top: 42, containLabel: false },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#f0f1f3', type: 'dashed' } },
      axisLabel: { color: '#8f959e', fontSize: 12 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'category',
      data: props.categories,
      inverse: true,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e5e6eb' } },
      axisLabel: {
        color: (value: string) => (value === '全公司' ? '#1f253d' : '#7a8299'),
        fontSize: 12,
        fontWeight: (value: string) => (value === '全公司' ? 700 : 500),
        width: 108,
        overflow: 'truncate',
      },
    },
    dataZoom: needsScroll
      ? [
          {
            type: 'slider',
            yAxisIndex: 0,
            right: 4,
            width: 12,
            startValue: 0,
            endValue: 8,
            filterMode: 'none',
            showDetail: false,
            borderColor: 'transparent',
            fillerColor: 'rgba(93, 120, 255, 0.16)',
            handleSize: 0,
          },
          { type: 'inside', yAxisIndex: 0, filterMode: 'none' },
        ]
      : undefined,
    series: props.series.map((s, i) => ({
      name: s.name,
      type: 'bar',
      stack: 'total',
      barWidth: 14,
      itemStyle: {
        color: s.color,
        // 横向堆叠时仅最右侧系列加圆角
        borderRadius: i === lastIndex ? [0, 4, 4, 0] : [0, 0, 0, 0],
      },
      emphasis: { focus: 'series' },
      data: s.data,
    })),
  };
  chart.setOption(option, true);
}

onMounted(() => {
  if (!chartRef.value) return;
  requestAnimationFrame(() => {
    if (!chartRef.value) return;
    chart = echarts.init(chartRef.value);
    render();
    resizeObserver = new ResizeObserver(() => chart?.resize());
    resizeObserver.observe(chartRef.value);
  });
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  chart?.dispose();
  chart = null;
});

watch([() => props.categories, () => props.series], render, { deep: true });
</script>

<template>
  <div ref="chartRef" class="dept-result-chart" :style="{ height: `${height}px` }" />
</template>

<style scoped>
.dept-result-chart {
  width: 100%;
}
</style>
