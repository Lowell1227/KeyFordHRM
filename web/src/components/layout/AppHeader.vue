<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowDown } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { isPerformanceWorkspacePath } from '@/router/performance-workspace';
import NotificationBell from './NotificationBell.vue';
import { formatBusinessIdentityLabel } from './business-identity';
import { formatPersonnelIdentityLabel } from '@/utils/personnel-identity';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const userName = computed(() => auth.user?.name ?? '未登录');
const pageTitle = computed(() => (route.meta.title as string) ?? '孚德绩效管理');
const isPerformanceWorkspace = computed(() => isPerformanceWorkspacePath(route.path));
const businessIdentities = computed(() => auth.user?.businessCapabilities?.identities ?? []);
const personnelIdentityLabel = computed(() => formatPersonnelIdentityLabel(auth.user?.status));
const systemPermissionLabel = computed(() => {
  const labels: Record<string, string> = {
    employee: '标准用户',
    manager: '标准用户',
    dept_head: '标准用户',
    vp: '标准用户',
    hr: 'HR 管理员',
    chairman: '标准用户',
    system_admin: '系统管理员',
  };
  return labels[auth.user?.sysRole ?? ''] ?? auth.user?.sysRole ?? '未设置';
});

async function onLogout() {
  await router.push('/login');
  auth.logout();
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
            <div class="account-summary" data-testid="header-account-summary">
              <strong>{{ userName }}</strong>
              <span class="account-summary__role">人员身份：{{ personnelIdentityLabel }}</span>
              <span class="account-summary__role">系统权限：{{ systemPermissionLabel }}</span>
              <span v-if="auth.user?.canViewAll" class="account-summary__identity">查看范围：全量只读</span>
              <template v-if="businessIdentities.length">
                <span class="account-summary__label">当前业务职责</span>
                <span
                  v-for="identity in businessIdentities"
                  :key="identity.type"
                  class="account-summary__identity"
                  :data-testid="`header-business-identity-${identity.type}`"
                >
                  {{ formatBusinessIdentityLabel(identity) }}
                </span>
              </template>
            </div>
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
  margin-left: auto;
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

.account-summary {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 210px;
  max-width: min(300px, calc(100vw - 24px));
  padding: 10px 14px 8px;
  color: var(--el-text-color-primary);
}

.account-summary__role,
.account-summary__label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.account-summary__label {
  margin-top: 4px;
}

.account-summary__identity {
  width: fit-content;
  max-width: 100%;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 12px;
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
