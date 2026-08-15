<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Aim, Minus, Plus } from '@element-plus/icons-vue';
import type { Objective } from '@/types/api.types';
import type { ObjectiveMapEdge, ObjectiveMapLayout } from '../objective-map-layout';
import type { ObjectiveMapDisplayOptions } from '../objective-map-settings';
import ObjectiveMapCard from './ObjectiveMapCard.vue';

const props = defineProps<{
  layout: ObjectiveMapLayout;
  display: ObjectiveMapDisplayOptions;
  loading: boolean;
  error: string;
  canManage: boolean;
}>();

const emit = defineEmits<{
  open: [objective: Objective];
  edit: [objective: Objective];
  progress: [objective: Objective];
  track: [objective: Objective];
  remove: [objective: Objective];
  retry: [];
}>();

const viewport = ref<HTMLElement | null>(null);
const scale = ref(1);
const offsetX = ref(0);
const offsetY = ref(0);
const dragging = ref(false);
let dragStartX = 0;
let dragStartY = 0;
let startOffsetX = 0;
let startOffsetY = 0;
let resizeObserver: ResizeObserver | null = null;

const zoomLabel = computed(() => `${Math.round(scale.value * 100)}%`);
const worldStyle = computed(() => ({
  width: `${props.layout.width}px`,
  height: `${props.layout.height}px`,
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value})`,
}));

function clampScale(value: number): number {
  return Math.min(1.5, Math.max(0.5, Math.round(value * 100) / 100));
}

function centerAtScale(nextScale: number) {
  const element = viewport.value;
  if (!element || props.layout.nodes.length === 0) {
    scale.value = 1;
    offsetX.value = 0;
    offsetY.value = 0;
    return;
  }
  scale.value = clampScale(nextScale);
  offsetX.value = (element.clientWidth - props.layout.width * scale.value) / 2;
  offsetY.value = (element.clientHeight - props.layout.height * scale.value) / 2;
}

function fitToView() {
  const element = viewport.value;
  if (!element || props.layout.nodes.length === 0) {
    centerAtScale(1);
    return;
  }
  const availableWidth = Math.max(1, element.clientWidth - 48);
  const availableHeight = Math.max(1, element.clientHeight - 48);
  centerAtScale(Math.min(1, availableWidth / props.layout.width, availableHeight / props.layout.height));
}

function zoomAt(nextScale: number, clientX: number, clientY: number) {
  const element = viewport.value;
  if (!element) return;
  const bounded = clampScale(nextScale);
  const rect = element.getBoundingClientRect();
  const pointerX = clientX - rect.left;
  const pointerY = clientY - rect.top;
  const worldX = (pointerX - offsetX.value) / scale.value;
  const worldY = (pointerY - offsetY.value) / scale.value;
  scale.value = bounded;
  offsetX.value = pointerX - worldX * bounded;
  offsetY.value = pointerY - worldY * bounded;
}

function zoomBy(delta: number) {
  const element = viewport.value;
  if (!element) return;
  const rect = element.getBoundingClientRect();
  zoomAt(scale.value + delta, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function handleWheel(event: WheelEvent) {
  event.preventDefault();
  zoomAt(scale.value + (event.deltaY < 0 ? 0.1 : -0.1), event.clientX, event.clientY);
}

function startPan(event: PointerEvent) {
  const target = event.target as HTMLElement;
  if (target.closest('.objective-map-card') || target.closest('.objective-map-canvas__controls')) return;
  dragging.value = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  startOffsetX = offsetX.value;
  startOffsetY = offsetY.value;
  viewport.value?.setPointerCapture(event.pointerId);
}

function movePan(event: PointerEvent) {
  if (!dragging.value) return;
  offsetX.value = startOffsetX + event.clientX - dragStartX;
  offsetY.value = startOffsetY + event.clientY - dragStartY;
}

function endPan(event: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  viewport.value?.releasePointerCapture(event.pointerId);
}

function edgePath(edge: ObjectiveMapEdge): string {
  const middleY = edge.fromY + (edge.toY - edge.fromY) / 2;
  return `M ${edge.fromX} ${edge.fromY} V ${middleY} H ${edge.toX} V ${edge.toY}`;
}

watch(() => props.layout, async () => {
  await nextTick();
  centerAtScale(1);
}, { deep: true, immediate: true });

onMounted(() => {
  viewport.value?.addEventListener('wheel', handleWheel, { passive: false });
  resizeObserver = new ResizeObserver(() => centerAtScale(scale.value));
  if (viewport.value) resizeObserver.observe(viewport.value);
});

onBeforeUnmount(() => {
  viewport.value?.removeEventListener('wheel', handleWheel);
  resizeObserver?.disconnect();
});

defineExpose({ fitToView });
</script>

<template>
  <div
    ref="viewport"
    v-loading="loading"
    data-testid="objective-map-canvas"
    class="objective-map-canvas"
    :class="{ 'is-dragging': dragging }"
    @pointerdown="startPan"
    @pointermove="movePan"
    @pointerup="endPan"
    @pointercancel="endPan"
  >
    <div
      v-if="layout.nodes.length > 0"
      data-testid="objective-map-world"
      class="objective-map-canvas__world"
      :style="worldStyle"
    >
      <svg
        v-if="display.showConnections"
        data-testid="objective-map-edges"
        class="objective-map-canvas__edges"
        aria-hidden="true"
        :width="layout.width"
        :height="layout.height"
      >
        <path v-for="edge in layout.edges" :key="edge.id" :d="edgePath(edge)" />
      </svg>

      <ObjectiveMapCard
        v-for="node in layout.nodes"
        :key="node.objective.id"
        :objective="node.objective"
        :display="display"
        :can-manage="canManage"
        :style="{ left: `${node.x}px`, top: `${node.y}px` }"
        @open="emit('open', $event)"
        @edit="emit('edit', $event)"
        @progress="emit('progress', $event)"
        @track="emit('track', $event)"
        @remove="emit('remove', $event)"
      />
    </div>

    <div v-if="!loading && error" class="objective-map-canvas__state" role="alert">
      <span>{{ error }}</span>
      <el-button type="primary" plain @click="emit('retry')">重新加载</el-button>
    </div>
    <div v-else-if="!loading && layout.nodes.length === 0" class="objective-map-canvas__state">
      暂无目标
    </div>

    <div class="objective-map-canvas__controls" aria-label="目标地图缩放控制">
      <button type="button" aria-label="定位全部目标" @click="fitToView">
        <el-icon><Aim /></el-icon>
      </button>
      <span class="objective-map-canvas__control-divider" aria-hidden="true" />
      <button type="button" aria-label="缩小目标地图" :disabled="scale <= 0.5" @click="zoomBy(-0.1)">
        <el-icon><Minus /></el-icon>
      </button>
      <span data-testid="objective-map-zoom-value" class="objective-map-canvas__zoom-value">{{ zoomLabel }}</span>
      <button type="button" aria-label="放大目标地图" :disabled="scale >= 1.5" @click="zoomBy(0.1)">
        <el-icon><Plus /></el-icon>
      </button>
    </div>
  </div>
</template>

<style scoped>
.objective-map-canvas {
  position: relative;
  width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 520px;
  overflow: hidden;
  background: #f3f6fc;
  cursor: grab;
  touch-action: none;
}

.objective-map-canvas.is-dragging {
  cursor: grabbing;
}

.objective-map-canvas__world {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  transition: transform 160ms ease;
}

.objective-map-canvas.is-dragging .objective-map-canvas__world {
  transition: none;
}

.objective-map-canvas__edges {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}

.objective-map-canvas__edges path {
  fill: none;
  stroke: #c9d4e6;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.5;
}

.objective-map-canvas__state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 14px;
  color: #8a95a8;
  font-size: 14px;
}

.objective-map-canvas__controls {
  position: absolute;
  z-index: 5;
  left: 24px;
  bottom: 18px;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 0 8px;
  background: #fff;
  border: 1px solid #e7ebf2;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgb(35 55 88 / 10%);
}

.objective-map-canvas__controls button {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: #526078;
  background: transparent;
  cursor: pointer;
}

.objective-map-canvas__controls button:hover:not(:disabled) {
  color: #2468da;
  background: #edf4ff;
}

.objective-map-canvas__controls button:disabled {
  color: #c2c9d4;
  cursor: not-allowed;
}

.objective-map-canvas__controls button:focus-visible {
  outline: 2px solid #195dcc;
  outline-offset: 1px;
}

.objective-map-canvas__control-divider {
  width: 1px;
  height: 18px;
  margin: 0 3px;
  background: #e0e5ed;
}

.objective-map-canvas__zoom-value {
  min-width: 42px;
  color: #354158;
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .objective-map-canvas__world {
    transition: none;
  }
}

@media (max-width: 768px) {
  .objective-map-canvas {
    min-height: 420px;
  }

  .objective-map-canvas__controls {
    left: 10px;
    bottom: 10px;
  }
}
</style>
