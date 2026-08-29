<script setup lang="ts">
import { computed, ref } from 'vue';

const props = withDefaults(defineProps<{
  showReference?: boolean;
  referenceTitle?: string;
  referenceTestId?: string;
}>(), {
  showReference: true,
  referenceTitle: '参考信息',
  referenceTestId: 'performance-form-reference',
});

const referenceOpen = ref(false);
const referenceActionLabel = computed(() => referenceOpen.value ? '收起参考信息' : '展开参考信息');
</script>

<template>
  <div class="performance-form-workspace" :class="{ 'has-reference': showReference }">
    <main class="performance-form-workspace__main">
      <slot name="main" />
    </main>
    <aside
      v-if="showReference"
      class="performance-form-workspace__reference"
      :class="{ 'is-open': referenceOpen }"
      :data-testid="referenceTestId"
    >
      <button
        type="button"
        class="performance-form-workspace__reference-toggle"
        :aria-label="referenceActionLabel"
        :aria-expanded="referenceOpen"
        @click="referenceOpen = !referenceOpen"
      >
        <strong>{{ referenceTitle }}</strong>
        <span>{{ referenceOpen ? '收起' : '展开' }}</span>
      </button>
      <div class="performance-form-workspace__reference-heading">{{ referenceTitle }}</div>
      <div class="performance-form-workspace__reference-body">
        <slot name="reference" />
      </div>
    </aside>
  </div>
</template>

<style scoped>
.performance-form-workspace {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: 14px;
}

.performance-form-workspace.has-reference {
  grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
}

.performance-form-workspace__main,
.performance-form-workspace__reference {
  min-width: 0;
}

.performance-form-workspace__main {
  display: grid;
  gap: 14px;
}

.performance-form-workspace__reference {
  overflow: hidden;
  border: 1px solid #e7ebf2;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(31 45 61 / 4%);
}

.performance-form-workspace__reference-heading {
  min-height: 50px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid #edf0f5;
  color: #20283a;
  font-size: 16px;
  font-weight: 700;
}

.performance-form-workspace__reference-toggle {
  display: none;
}

@media (max-width: 1100px) {
  .performance-form-workspace.has-reference {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 767px) {
  .performance-form-workspace__reference-heading {
    display: none;
  }

  .performance-form-workspace__reference-toggle {
    width: 100%;
    min-height: 50px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 15px;
    border: 0;
    background: #fff;
    color: #20283a;
    font: inherit;
  }

  .performance-form-workspace__reference-toggle span {
    color: #4f67d8;
    font-size: 13px;
  }

  .performance-form-workspace__reference-body {
    display: none;
    border-top: 1px solid #edf0f5;
  }

  .performance-form-workspace__reference.is-open .performance-form-workspace__reference-body {
    display: block;
  }
}
</style>
