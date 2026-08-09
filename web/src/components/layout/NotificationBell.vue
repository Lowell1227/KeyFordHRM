<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Bell } from '@element-plus/icons-vue';
import { useNotificationStore } from '@/stores/notification.store';
import { useAuthStore } from '@/stores/auth.store';
import { navigateNotificationTarget, resolveNotificationTarget } from './notification-target';

const store = useNotificationStore();
const auth = useAuthStore();
const router = useRouter();

const POLL_INTERVAL = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
const popoverVisible = ref(false);
const activeNotificationId = ref<string | null>(null);
let activationSerial = 0;
let componentMounted = false;

const badgeValue = computed(() => (store.unreadCount > 0 ? store.unreadCount : undefined));

function fetchIfLoggedIn() {
  if (auth.isLoggedIn) {
    store.fetchUnreadCount();
  }
}

function startPolling() {
  if (!auth.isLoggedIn || timer) return;
  fetchIfLoggedIn();
  timer = setInterval(() => {
    if (!document.hidden) {
      fetchIfLoggedIn();
    }
  }, POLL_INTERVAL);
}

function stopPolling() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function onVisibilityChange() {
  if (document.hidden) return;
  // 切回前台立即刷新一次并恢复轮询
  fetchIfLoggedIn();
  if (!timer) {
    startPolling();
  }
}

onMounted(() => {
  componentMounted = true;
  startPolling();
  document.addEventListener('visibilitychange', onVisibilityChange);
});

onUnmounted(() => {
  componentMounted = false;
  activationSerial += 1;
  stopPolling();
  document.removeEventListener('visibilitychange', onVisibilityChange);
});

// 退出登录时立即停止轮询，防止登出后仍发请求
watch(
  () => auth.isLoggedIn,
  (loggedIn) => {
    if (loggedIn) {
      startPolling();
    } else {
      stopPolling();
    }
  },
);

function onOpenPopover() {
  store.fetchRecent();
}

function markAllRead() {
  store.markAllAsRead();
}

function notificationTarget(item: (typeof store.recent)[number]) {
  const role = auth.user?.sysRole;
  return role ? resolveNotificationTarget(item, role) : null;
}

function isProcessing(id: string) {
  return activeNotificationId.value === id;
}

function isCurrentActivation(serial: number) {
  return componentMounted && activationSerial === serial;
}

async function openNotification(item: (typeof store.recent)[number]) {
  const target = notificationTarget(item);
  if (!target || activeNotificationId.value !== null) return;

  const serial = ++activationSerial;
  activeNotificationId.value = item.id;
  try {
    if (!item.isRead) {
      try {
        await store.markAsRead(item.id);
      } catch {
        if (!isCurrentActivation(serial)) return;
        ElMessage.warning('标记通知已读失败，仍将继续跳转');
      }
    }

    if (!isCurrentActivation(serial)) return;
    const navigationSucceeded = await navigateNotificationTarget(target, (location) => router.push(location));
    if (!isCurrentActivation(serial)) return;
    if (!navigationSucceeded) {
      ElMessage.warning('页面跳转未完成，请稍后重试');
    }
  } catch {
    if (!isCurrentActivation(serial)) return;
    ElMessage.warning('页面跳转失败，请稍后重试');
  } finally {
    if (isCurrentActivation(serial)) {
      popoverVisible.value = false;
      activeNotificationId.value = null;
    }
  }
}
</script>

<template>
  <el-popover v-model:visible="popoverVisible" placement="bottom-end" :width="320" trigger="click" @show="onOpenPopover">
    <template #reference>
      <button type="button" class="notification-bell" data-testid="app-notifications" aria-label="通知">
        <el-badge :value="badgeValue" :max="99" class="notification-bell__badge">
          <el-icon :size="20"><Bell /></el-icon>
        </el-badge>
      </button>
    </template>

    <div class="notification-popover">
      <div class="notification-popover__header">
        <span>通知</span>
        <el-button v-if="store.hasUnread" link type="primary" size="small" @click="markAllRead"> 全部已读 </el-button>
      </div>

      <el-scrollbar max-height="320px">
        <div v-if="store.loading" class="notification-popover__empty">加载中...</div>
        <template v-else-if="store.recent.length">
          <template v-for="item in store.recent" :key="item.id">
            <button
              v-if="notificationTarget(item)"
              type="button"
              role="button"
              class="notification-popover__item notification-popover__item--actionable"
              :class="{ 'is-unread': !item.isRead }"
              :data-testid="`notification-item-${item.id}`"
              :disabled="activeNotificationId !== null"
              :aria-busy="isProcessing(item.id) || undefined"
              @click="openNotification(item)"
            >
              <div class="notification-popover__title">{{ item.title }}</div>
              <div class="notification-popover__content">
                {{ item.content }}
              </div>
              <div class="notification-popover__time">{{ item.createdAt }}</div>
            </button>
            <div v-else class="notification-popover__item" :class="{ 'is-unread': !item.isRead }" :data-testid="`notification-item-${item.id}`">
              <div class="notification-popover__title">{{ item.title }}</div>
              <div class="notification-popover__content">
                {{ item.content }}
              </div>
              <div class="notification-popover__time">{{ item.createdAt }}</div>
            </div>
          </template>
        </template>
        <div v-else class="notification-popover__empty">暂无新通知</div>
      </el-scrollbar>
    </div>
  </el-popover>
</template>

<style scoped>
.notification-bell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background 0.2s;
}

.notification-bell:hover {
  background: var(--el-fill-color-light);
}

.notification-bell:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.notification-bell__badge {
  display: inline-flex;
}

.notification-popover__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-weight: 500;
}

.notification-popover__item {
  display: block;
  width: 100%;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  border-left: 0;
  border-right: 0;
  border-top: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  transition: background 0.2s;
}

.notification-popover__item--actionable {
  cursor: pointer;
}

.notification-popover__item--actionable:hover {
  background: var(--el-fill-color-light);
}

.notification-popover__item--actionable:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}

.notification-popover__item--actionable:disabled {
  cursor: wait;
}

.notification-popover__item.is-unread {
  background: var(--el-color-primary-light-9);
}

.notification-popover__title {
  font-size: 14px;
  color: var(--el-text-color-primary);
  margin-bottom: 4px;
}

.notification-popover__content {
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.notification-popover__time {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.notification-popover__empty {
  padding: 24px 0;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
