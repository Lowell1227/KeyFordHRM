<script setup lang="ts">
import { computed } from 'vue';

type PerformanceSection = 'tracking' | 'map' | 'tasks';

const props = withDefaults(
  defineProps<{
    title: string;
    activeSection: PerformanceSection;
    showContext?: boolean;
    sections?: readonly PerformanceSection[];
  }>(),
  {
    showContext: true,
    sections: () => ['tracking', 'map', 'tasks'],
  },
);

const allSections = [
  { key: 'tracking', label: '目标跟进', to: '/action-items' },
  { key: 'map', label: '目标地图', to: '/objectives' },
  { key: 'tasks', label: '绩效待办', to: '/tasks' },
] as const;

const visibleSections = computed(() =>
  allSections.filter((section) => props.sections.includes(section.key)),
);
</script>

<template>
  <section class="performance-workspace">
    <header class="performance-workspace__header">
      <h1>{{ title }}</h1>
      <div class="performance-workspace__toolbar">
        <slot name="toolbar" />
      </div>
    </header>

    <div class="performance-workspace__body">
      <nav
        class="performance-workspace__nav"
        aria-label="绩效功能"
        data-testid="performance-secondary-nav"
      >
        <RouterLink
          v-for="section in visibleSections"
          :key="section.key"
          :to="section.to"
          class="performance-workspace__nav-link"
          :class="{ 'is-active': section.key === activeSection }"
          :aria-current="section.key === activeSection ? 'page' : undefined"
        >
          {{ section.label }}
        </RouterLink>
      </nav>

      <aside v-if="showContext" class="performance-workspace__context">
        <slot name="context" />
      </aside>

      <section class="performance-workspace__content" aria-label="绩效工作区内容">
        <slot />
      </section>
    </div>
  </section>
</template>

<style scoped>
.performance-workspace {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f5f7fb;
}

.performance-workspace__header {
  min-height: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 24px;
  background: #fff;
  border-bottom: 1px solid #e5e8ef;
}

.performance-workspace__header h1 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: #172033;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.performance-workspace__toolbar {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.performance-workspace__body {
  min-width: 0;
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: 148px 256px minmax(0, 1fr);
  overflow: hidden;
}

.performance-workspace__nav {
  min-width: 0;
  padding: 14px 10px;
  overflow: auto;
  background: #fff;
  border-right: 1px solid #e5e8ef;
}

.performance-workspace__nav-link {
  min-height: 38px;
  display: flex;
  align-items: center;
  margin-bottom: 2px;
  padding: 0 10px;
  border-radius: 5px;
  color: #30384b;
  font-size: 14px;
  text-decoration: none;
  transition: background-color var(--app-transition), color var(--app-transition);
}

.performance-workspace__nav-link:hover {
  background: #f4f6fa;
  color: #1d5fd1;
}

.performance-workspace__nav-link.is-active {
  background: #e9edf3;
  color: #172033;
  font-weight: 600;
}

.performance-workspace__context {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #fff;
  border-right: 1px solid #dfe4ec;
}

.performance-workspace__content {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: #f5f7fb;
}

.performance-workspace__body:not(:has(.performance-workspace__context)) {
  grid-template-columns: 148px minmax(0, 1fr);
}

@media (max-width: 900px) {
  .performance-workspace__body {
    grid-template-columns: 132px 220px minmax(0, 1fr);
  }

  .performance-workspace__body:not(:has(.performance-workspace__context)) {
    grid-template-columns: 132px minmax(0, 1fr);
  }
}

@media (max-width: 768px) {
  .performance-workspace {
    overflow: auto;
  }

  .performance-workspace__header {
    min-height: 52px;
    padding: 8px 12px;
  }

  .performance-workspace__header h1 {
    font-size: 18px;
  }

  .performance-workspace__body,
  .performance-workspace__body:not(:has(.performance-workspace__context)) {
    min-height: auto;
    display: flex;
    flex-direction: column;
    overflow: visible;
  }

  .performance-workspace__nav {
    display: flex;
    flex-shrink: 0;
    gap: 4px;
    padding: 6px 10px;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid #e5e8ef;
  }

  .performance-workspace__nav-link {
    min-width: max-content;
    min-height: 34px;
    margin: 0;
    padding: 0 12px;
  }

  .performance-workspace__context {
    flex-shrink: 0;
    overflow: visible;
    border-right: 0;
    border-bottom: 1px solid #dfe4ec;
  }

  .performance-workspace__content {
    min-height: 420px;
    flex: none;
    overflow: visible;
  }
}
</style>
