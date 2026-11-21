<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth.store';
import { buildNavigation } from '@/router/navigation';
import { routes } from '@/router/routes';

const auth = useAuthStore(), route = useRoute(), router = useRouter();
onMounted(() => {
  const target = auth.user && buildNavigation(routes, auth.user).find(module => module.key === 'recruitment')?.defaultPath;
  void router.replace({ path: target || '/dashboard', query: route.query, hash: route.hash });
});
</script>

<template><p role="status">正在打开招聘...</p></template>
