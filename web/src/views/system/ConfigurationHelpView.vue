<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth.store';
import { configurationTargets, isConfigurationTarget } from '@/router/configuration-targets';

const route = useRoute();
const auth = useAuthStore();
const id = computed(() => isConfigurationTarget(route.params.setting) ? route.params.setting : null);
const item = computed(() => id.value ? configurationTargets[id.value] : null);
</script>

<template>
  <section class="configuration-help">
    <template v-if="item">
      <h2>{{ item.name }}</h2>
      <p>由{{ item.owner }}处理</p>
      <p>{{ item.guidance }}</p>
      <RouterLink v-if="auth.user?.sysRole === 'system_admin'" :to="{ path: '/system', query: { configuration: id } }">
        查看配置总览
      </RouterLink>
    </template>
    <p v-else role="status">配置项目不存在，请返回原业务。</p>
  </section>
</template>

<style scoped>
.configuration-help { max-width: 720px; margin: 24px; padding: 20px; background: var(--el-bg-color); border: 1px solid var(--el-border-color-light); border-radius: 8px; }
.configuration-help h2 { margin: 0 0 12px; font-size: 18px; }
.configuration-help p { margin: 0 0 12px; line-height: 1.6; }
</style>
