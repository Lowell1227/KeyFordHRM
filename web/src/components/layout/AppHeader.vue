<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowDown } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { PERFORMANCE_WORKSPACE_PATHS } from '@/router/performance-workspace';
import NotificationBell from './NotificationBell.vue';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const userName = computed(() => auth.user?.name ?? '未登录');
const pageTitle = computed(() => (route.meta.title as string) ?? '孚德绩效管理');
const isPerformanceWorkspace = computed(() => PERFORMANCE_WORKSPACE_PATHS.has(route.path));

function onLogout() {
  auth.logout();
  router.push('/login');
}
</script>

<template>
  <el-header class="app-header">
    <div v-if="!isPerformanceWorkspace" class="app-header__left">
      <div class="page-title" data-testid="app-route-title">
        <span>{{ pageTitle }}</span>
      </div>
    </div>

    <div class="app-header__right">
      <NotificationBell />

      <el-dropdown @command="onLogout">
        <span class="user-chip" data-testid="header-user-menu">
          <UserAvatar :name="userName" :src="auth.user?.avatarUrl" :size="28" />
          <span class="user-name">{{ userName }}</span>
          <el-icon><ArrowDown /></el-icon>
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="logout" data-testid="header-logout">退出登录</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </el-header>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #f3f6ff;
  border-bottom: 0;
  padding: 0 18px 0 24px;
  height: 48px;
  flex-shrink: 0;
}

.app-header__left {
  display: flex;
  align-items: center;
  min-width: 0;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #2f3655;
  font-size: 14px;
  min-width: 0;
}

.page-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-header__right {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}

.user-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 0;
  border-radius: 50%;
  transition: background 0.2s;
}

.user-chip:hover {
  background: transparent;
}

.user-name {
  font-size: 14px;
  color: var(--el-text-color-primary);
}

@media (max-width: 768px) {
  .app-header {
    height: 44px;
    padding: 0 10px;
  }

  .page-title {
    max-width: calc(100vw - 136px);
    font-size: 13px;
    gap: 6px;
  }

  .app-header__right {
    gap: 9px;
  }

  .user-name {
    display: none;
  }
}

@media (max-width: 420px) {
  .page-title {
    max-width: calc(100vw - 92px);
  }
}
</style>
