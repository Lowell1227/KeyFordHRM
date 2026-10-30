import { createRouter, createWebHistory } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth.store';
import { previewStorageKey } from '@/api/archive-assistant.api';
import { routes } from './routes';
import { canAccessRoute } from './navigation';

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  // Capture before authentication redirects: the signed preview must never enter a request URI.
  if (to.name === 'ArchiveAssistantPreview' && to.hash) {
    const reference = String(to.params.sourceReference ?? '');
    const token = new URLSearchParams(to.hash.slice(1)).get('preview');
    try {
      if (/^[a-f0-9]{64}$/.test(reference) && token && token.length <= 2048)
        sessionStorage.setItem(previewStorageKey(reference), token);
    } catch { /* Storage unavailable: the preview fails closed and can be obtained again. */ }
    history.replaceState(history.state, '', to.path);
    return { path: to.path, hash: '', replace: true };
  }
  const auth = useAuthStore();
  if (to.meta.public) return true;

  if (auth.tokenExpired) {
    auth.logout();
    return { name: 'Login', query: { redirect: to.fullPath } };
  }

  if (auth.isLoggedIn && !auth.user) {
    const ok = await auth.ensureLoaded();
    if (!ok) return { name: 'Login', query: { redirect: to.fullPath } };
  }

  if (!auth.isLoggedIn) return { name: 'Login', query: { redirect: to.fullPath } };

  if (auth.passwordChangeRequired && to.name !== 'ChangePassword') {
    return { name: 'ChangePassword' };
  }
  if (!auth.passwordChangeRequired && to.name === 'ChangePassword') {
    return { name: 'Dashboard' };
  }

  if (
    to.name === 'MyTasks'
    && auth.isManager
    && Object.keys(to.query).length === 0
  ) {
    return {
      name: 'MyTasks',
      query: {
        scope: 'team',
        stage: 'goal-review',
        stageState: 'pending',
      },
      hash: to.hash,
      replace: true,
    };
  }

  if (auth.user && !canAccessRoute(to, auth.user)) {
    ElMessage.warning('无权访问该页面');
    return { name: 'Dashboard' };
  }
  return true;
});

export default router;
