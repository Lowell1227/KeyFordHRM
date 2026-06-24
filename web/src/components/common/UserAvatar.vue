<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    name?: string;
    src?: string;
    size?: number;
    bg?: string;
  }>(),
  {
    size: 32,
    bg: '#1677ff',
  },
);

const displayName = computed(() => props.name?.slice(0, 2) ?? '?');
const fontSize = computed(() => `${Math.max(12, props.size * 0.4)}px`);
</script>

<template>
  <el-avatar
    class="user-avatar"
    :size="size"
    :src="src"
    :style="{ backgroundColor: src ? undefined : bg, fontSize }"
  >
    {{ displayName }}
  </el-avatar>
</template>

<style scoped>
.user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex-shrink: 0;
}
</style>
