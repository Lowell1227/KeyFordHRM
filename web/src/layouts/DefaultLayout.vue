<script setup lang="ts">
import AppHeader from '@/components/layout/AppHeader.vue';
import AppSidebar from '@/components/layout/AppSidebar.vue';
</script>

<template>
  <el-container class="app-shell">
    <AppSidebar />
    <el-container class="app-content">
      <AppHeader />
      <el-main class="app-main">
        <slot />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
/* 固定视口三段式：壳层锁死一屏高、自身不滚动，
   头部固定，侧边栏与内容区各自独立滚动。 */
.app-shell {
  height: 100vh;
  flex-direction: row;
  overflow: hidden;
  background: var(--app-bg);
}

.app-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.app-main {
  background: var(--app-bg);
  padding: 16px 18px 18px;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

@media (max-width: 1180px) {
  .app-main {
    padding: 14px;
  }
}

@media (max-width: 768px) {
  .app-shell {
    flex-direction: column;
    height: 100dvh;
    min-height: 100dvh;
    overflow: hidden;
  }

  .app-content {
    min-height: 0;
    overflow: hidden;
  }

  .app-main {
    flex: 1;
    min-height: 0;
    padding: 10px;
    overflow: auto;
  }
}
</style>
