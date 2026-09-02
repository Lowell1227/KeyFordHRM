<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowDown } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { isPerformanceWorkspacePath } from '@/router/performance-workspace';
import NotificationBell from './NotificationBell.vue';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const userName = computed(() => auth.user?.name ?? '未登录');
const pageTitle = computed(() => (route.meta.title as string) ?? '孚德绩效管理');
const isPerformanceWorkspace = computed(() => isPerformanceWorkspacePath(route.path));
const profileMeta = computed(() => [auth.user?.deptName, auth.user?.position].filter(Boolean).join(' · '));
const employmentStatusLabel = computed(() => {
  const labels: Record<string, string> = {
    active: '在职',
    probation: '试用期',
    resigned: '离职',
  };
  return labels[auth.user?.status ?? ''] ?? '未设置';
});
const systemPermissionLabel = computed(() => {
  const labels: Record<string, string> = {
    standard_user: '标准用户',
    hr_user: 'HR 用户',
    hr_admin: 'HR 管理员',
    employee: '标准用户',
    manager: '标准用户',
    dept_head: '标准用户',
    vp: '标准用户',
    hr: 'HR 管理员',
    chairman: '标准用户',
    system_admin: '系统管理员',
  };
  const permission = auth.user?.systemPermission ?? auth.user?.sysRole ?? '';
  return labels[permission] ?? (permission || '未设置');
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
              <div class="account-summary__person">
                <UserAvatar :name="userName" :src="auth.user?.avatarUrl" :size="36" />
                <div class="account-summary__person-text">
                  <strong>{{ userName }}</strong>
                  <span v-if="profileMeta" class="account-summary__meta">{{ profileMeta }}</span>
                </div>
              </div>

              <div class="account-summary__section">
                <span class="account-summary__section-title">账号信息</span>
                <dl class="account-summary__details">
                  <div class="account-summary__detail">
                    <dt>任职状态</dt>
                    <dd>{{ employmentStatusLabel }}</dd>
                  </div>
                  <div class="account-summary__detail">
                    <dt>系统权限</dt>
                    <dd>{{ systemPermissionLabel }}</dd>
                  </div>
                  <div v-if="auth.user?.canViewAll" class="account-summary__detail">
                    <dt>数据范围</dt>
                    <dd class="account-summary__scope">全量只读</dd>
                  </div>
                </dl>
              </div>
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
  gap: 12px;
  min-width: 260px;
  max-width: min(320px, calc(100vw - 24px));
  padding: 14px;
  color: var(--el-text-color-primary);
}

.account-summary__person {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.account-summary__person-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.account-summary__person-text strong,
.account-summary__meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-summary__meta,
.account-summary__section-title,
.account-summary__detail dt {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.account-summary__section {
  padding-top: 10px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.account-summary__section-title {
  display: block;
  margin-bottom: 7px;
}

.account-summary__details {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 0;
}

.account-summary__detail {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.account-summary__detail dd {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: 12px;
  font-weight: 500;
  text-align: right;
}

.account-summary__detail .account-summary__scope {
  color: var(--el-color-primary);
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
