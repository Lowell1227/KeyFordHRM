<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { Bell } from '@element-plus/icons-vue';
import { useNotificationStore } from '@/stores/notification.store';
import { useAuthStore } from '@/stores/auth.store';

const store = useNotificationStore();
const auth = useAuthStore();

const POLL_INTERVAL = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;

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
  startPolling();
  document.addEventListener('visibilitychange', onVisibilityChange);
});

onUnmounted(() => {
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
</script>

<template>
  <el-popover
    placement="bottom-end"
    :width="320"
    trigger="click"
    @show="onOpenPopover"
  >
    <template #reference>
      <el-badge :value="badgeValue" :max="99" class="notification-bell">
        <el-icon :size="20"><Bell /></el-icon>
      </el-badge>
    </template>

    <div class="notification-popover">
      <div class="notification-popover__header">
        <span>通知</span>
        <el-button v-if="store.hasUnread" link type="primary" size="small" @click="markAllRead">
          全部已读
        </el-button>
      </div>

      <el-scrollbar max-height="320px">
        <div v-if="store.loading" class="notification-popover__empty">加载中...</div>
        <template v-else-if="store.recent.length">
          <div
            v-for="item in store.recent"
            :key="item.id"
            class="notification-popover__item"
            :class="{ 'is-unread': item.status !== 'sent' }"
          >
            <div class="notification-popover__title">{{ item.title }}</div>
            <div class="notification-popover__content">{{ item.content }}</div>
            <div class="notification-popover__time">{{ item.createdAt }}</div>
          </div>
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
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.2s;
}

.notification-bell:hover {
  background: var(--el-fill-color-light);
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
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: pointer;
  transition: background 0.2s;
}

.notification-popover__item:hover {
  background: var(--el-fill-color-light);
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
