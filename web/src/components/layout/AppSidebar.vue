<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowDown, Briefcase, HomeFilled, Setting, UserFilled } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';
import { buildNavigation } from '@/router/navigation';
import { routes } from '@/router/routes';
import type { NavigationGroup, NavigationModule, NavigationModuleKey } from '@/router/navigation.types';

const COLLAPSED_GROUPS_KEY = 'kayford.sidebar.collapsedGroups';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const moduleIcons: Record<NavigationModuleKey, Component> = {
  workbench: HomeFilled,
  performance: Briefcase,
  people: UserFilled,
  analysis: Setting,
};

function readCollapsedGroups(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === 'boolean'),
    ) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function saveCollapsedGroups(value: Record<string, boolean>) {
  localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(value));
}

const collapsedGroups = ref<Record<string, boolean>>(readCollapsedGroups());
const navigation = computed(() => (auth.user ? buildNavigation(routes, auth.user) : []));
const activeNavigationModule = computed(() => {
  const matched = [...route.matched].reverse().find((record) => record.meta.navigation);
  return matched?.meta.navigation?.module;
});
const activeModule = computed<NavigationModule | undefined>(() =>
  navigation.value.find((module) => module.key === activeNavigationModule.value) ?? navigation.value[0],
);
const validCollapseKeys = computed(() =>
  navigation.value.flatMap((module) => module.groups.map(collapseKey)),
);

watch(
  validCollapseKeys,
  (keys) => {
    if (!auth.user) return;
    const keySet = new Set(keys);
    const normalized = Object.fromEntries(
      Object.entries(collapsedGroups.value).filter(([key]) => keySet.has(key)),
    );
    if (JSON.stringify(normalized) !== JSON.stringify(collapsedGroups.value)) {
      collapsedGroups.value = normalized;
      saveCollapsedGroups(normalized);
    }
  },
  { immediate: true },
);

function collapseKey(group: NavigationGroup): string {
  return group.key;
}

function isCollapsed(group: NavigationGroup): boolean {
  return Boolean(collapsedGroups.value[collapseKey(group)]);
}

function toggleGroup(group: NavigationGroup) {
  const key = collapseKey(group);
  collapsedGroups.value = { ...collapsedGroups.value, [key]: !collapsedGroups.value[key] };
  saveCollapsedGroups(collapsedGroups.value);
}

function navigate(path: string) {
  router.push(path);
}

function isMenuActive(path: string): boolean {
  return router.resolve(path).path === route.path;
}
</script>

<template>
  <aside class="app-sidebar" aria-label="系统导航">
    <nav class="app-rail" aria-label="一级模块">
      <div class="rail-logo" aria-label="KAYFORD 尚德">
        <img src="/kayford-logo.jpg" alt="KAYFORD 尚德" />
      </div>
      <button
        v-for="module in navigation"
        :key="module.key"
        class="rail-item"
        :class="{ 'is-active': module.key === activeModule?.key }"
        :data-testid="`nav-module-${module.key}`"
        type="button"
        @click="navigate(module.defaultPath)"
      >
        <span class="rail-icon"><el-icon><component :is="moduleIcons[module.key]" /></el-icon></span>
        <span>{{ module.label }}</span>
      </button>
    </nav>

    <div v-if="activeModule" class="menu-panel">
      <div class="menu-brand">
        <span class="menu-brand__mark"><el-icon><component :is="moduleIcons[activeModule.key]" /></el-icon></span>
        <span>{{ activeModule.label }}</span>
      </div>

      <div class="menu-scroll">
        <section v-for="group in activeModule.groups" :key="group.key" class="menu-group">
          <button
            v-if="group.label"
            class="menu-group__title"
            type="button"
            :aria-expanded="!isCollapsed(group)"
            @click="toggleGroup(group)"
          >
            <span>{{ group.label }}</span>
            <el-icon class="menu-arrow" :class="{ 'is-collapsed': isCollapsed(group) }"><ArrowDown /></el-icon>
          </button>
          <div v-show="!isCollapsed(group)" class="menu-group__items">
            <button
              v-for="item in group.items"
              :key="String(item.name)"
              class="menu-link"
              :class="{ 'is-active': isMenuActive(item.path) }"
              type="button"
              @click="navigate(item.path)"
            >
              <span class="menu-dot" />
              <span>{{ item.label }}</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.app-sidebar {
  width: 244px;
  height: 100%;
  flex-shrink: 0;
  display: flex;
  background: #fff;
  border-right: 1px solid #e6eaf2;
  z-index: 2;
}

.app-rail {
  width: 72px;
  min-width: 72px;
  padding: 14px 8px;
  box-sizing: border-box;
  background: #455fc6;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rail-logo {
  width: 42px;
  height: 42px;
  margin: 0 auto 8px;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.rail-logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.rail-item {
  width: 56px;
  min-height: 58px;
  margin: 0 auto;
  padding: 6px 2px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #dfe7ff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
}

.rail-item:hover,
.rail-item.is-active {
  color: #314aab;
  background: #fff;
}

.rail-icon {
  display: inline-flex;
  font-size: 18px;
}

.menu-panel {
  width: 172px;
  min-width: 172px;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.menu-brand {
  height: 58px;
  padding: 0 16px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #202b4d;
  font-weight: 700;
  border-bottom: 1px solid #edf0f5;
}

.menu-brand__mark {
  width: 20px;
  height: 20px;
  color: #3b70d9;
  background: #eaf1ff;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.menu-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
}

.menu-group {
  margin-bottom: 10px;
}

.menu-group__title,
.menu-link {
  width: 100%;
  min-height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 4px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #5e6783;
  background: transparent;
  text-align: left;
  font-size: 13px;
}

.menu-group__title {
  color: #343d5e;
  font-weight: 700;
  cursor: pointer;
}

.menu-group__title:hover {
  background: #f4f6fb;
}

.menu-arrow {
  margin-left: auto;
  color: #9ca6c0;
  transition: transform 0.18s;
}

.menu-arrow.is-collapsed {
  transform: rotate(-90deg);
}

.menu-group__items {
  padding-top: 2px;
}

.menu-link {
  margin: 2px 0;
  cursor: pointer;
}

.menu-link:hover,
.menu-link.is-active {
  color: #2f67d1;
  background: #edf4ff;
}

.menu-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #9eb5e9;
}

.menu-link.is-active .menu-dot {
  background: currentcolor;
}

@media (max-width: 1180px) {
  .app-sidebar { width: 218px; }
  .app-rail { width: 62px; min-width: 62px; padding-inline: 5px; }
  .rail-item { width: 50px; font-size: 10px; }
  .menu-panel { width: 156px; min-width: 156px; }
}

@media (max-width: 768px) {
  .app-sidebar { width: 100%; height: auto; flex-direction: column; }
  .app-rail {
    width: 100%;
    min-width: 0;
    height: 58px;
    padding: 7px 10px;
    flex-direction: row;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .app-rail::-webkit-scrollbar { display: none; }
  .rail-logo { display: none; }
  .rail-item { min-width: 54px; min-height: 44px; margin: 0; flex-direction: row; font-size: 12px; }
  .rail-icon { font-size: 16px; }
  .menu-panel { width: 100%; min-width: 0; height: 48px; flex-direction: row; }
  .menu-brand { display: none; }
  .menu-scroll { display: flex; align-items: center; overflow-x: auto; overflow-y: hidden; padding: 6px 10px; scrollbar-width: none; }
  .menu-scroll::-webkit-scrollbar { display: none; }
  .menu-group { min-width: max-content; margin: 0; }
  .menu-group__title { display: none; }
  .menu-group__items { display: flex !important; gap: 4px; padding: 0; }
  .menu-link { width: auto; min-height: 32px; margin: 0; white-space: nowrap; }
}
</style>
