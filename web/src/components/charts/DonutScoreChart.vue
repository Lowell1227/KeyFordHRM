<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import * as echarts from 'echarts/core';
import { PieChart } from 'echarts/charts';
import { TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([PieChart, TooltipComponent, LegendComponent, CanvasRenderer]);

interface DonutItem {
  name: string;
  value: number;
  color?: string;
}

const props = withDefaults(
  defineProps<{
    data: DonutItem[];
    /** 圆环中心主文字，如「137人」 */
    centerValue?: string;
    /** 圆环中心副文字，如「参评人数」 */
    centerLabel?: string;
    height?: number;
  }>(),
  {
    height: 200,
  },
);

const DEFAULT_COLORS = ['#ff8f8f', '#ffce6e', '#5fd0a0', '#9b8cff', '#4e8cff'];

const chartRef = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;
let resizeObserver: ResizeObserver | null = null;

const chartCenter: [string, string] = ['38%', '52%'];

function render() {
  if (!chart) return;
  const option: EChartsCoreOption = {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: {
      orient: 'vertical',
      right: '6%',
      top: 'center',
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 14,
      textStyle: { color: '#5f6782', fontSize: 12, fontWeight: 500 },
    },
    series: [
      {
        type: 'pie',
        radius: ['64%', '78%'],
        center: chartCenter,
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        emphasis: { scale: true, scaleSize: 3 },
        data: props.data.map((d, i) => ({
          name: d.name,
          value: d.value,
          itemStyle: { color: d.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length] },
        })),
      },
    ],
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

watch(() => props.data, render, { deep: true });
watch([() => props.centerValue, () => props.centerLabel], render);
</script>

<template>
  <div class="donut-score-chart" :style="{ height: `${height}px` }">
    <div ref="chartRef" class="donut-score-chart__canvas" />
    <div v-if="centerValue" class="donut-score-chart__center">
      <div class="donut-score-chart__value">{{ centerValue }}</div>
      <div class="donut-score-chart__label">{{ centerLabel }}</div>
    </div>
  </div>
</template>

<style scoped>
.donut-score-chart {
  width: 100%;
  position: relative;
}

.donut-score-chart__canvas {
  width: 100%;
  height: 100%;
}

.donut-score-chart__center {
  position: absolute;
  left: 38%;
  top: 52%;
  transform: translate(-50%, -50%);
  width: 96px;
  text-align: center;
  pointer-events: none;
  line-height: 1.15;
}

.donut-score-chart__value {
  color: #1f2329;
  font-size: 26px;
  font-weight: 800;
}

.donut-score-chart__label {
  margin-top: 4px;
  color: #8f959e;
  font-size: 12px;
  font-weight: 500;
}
</style>
