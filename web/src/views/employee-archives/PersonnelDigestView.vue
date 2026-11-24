<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import http from '@/api/http';

interface Item {
  kind: string;
  id: string;
  employee: string;
  due: string | null;
  next: string;
  link: string;
}
interface Digest {
  day: string;
  kinds: Record<string, string>;
  items: Item[];
}
const digest = ref<Digest>();
const loading = ref(true);
const error = ref(false);
const overdue = computed(() => digest.value?.items.filter(item => item.due && item.due < digest.value!.day) ?? []);
const groups = computed(() => Object.entries(digest.value?.kinds ?? {}).flatMap(([key, label]) => {
  const items = digest.value?.items.filter(item => item.kind === key && !overdue.value.includes(item)) ?? [];
  return items.length ? [{ key, label, items }] : [];
}));

async function load() {
  error.value = false;
  loading.value = true;
  try {
    digest.value = await http.get('/employee-archives/personnel-digest', { skipErrorMessage: true }) as unknown as Digest;
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <main class="digest-page" :aria-busy="loading">
    <header>
      <h1>人事待办</h1>
      <p v-if="digest && !error">{{ digest.day }} · 待办 {{ digest.items.length }} 项</p>
    </header>
    <p v-if="loading" role="status">正在读取待办…</p>
    <p v-else-if="error" role="alert">暂时无法读取待办。<el-button link type="primary" @click="load">重试</el-button></p>
    <p v-else-if="digest && !digest.items.length">今日暂无待办</p>
    <template v-else-if="digest">
      <details v-if="overdue.length" open>
        <summary>逾期 <strong>{{ overdue.length }} 项</strong></summary>
        <ul>
          <li v-for="item in overdue" :key="item.kind + item.id">
            <RouterLink :to="item.link">{{ item.employee }}</RouterLink>
            <span>{{ digest.kinds[item.kind] }} · {{ item.due }}</span>
            <span>{{ item.next }}</span>
          </li>
        </ul>
      </details>
      <details v-for="group in groups" :key="group.key">
        <summary>{{ group.label }} <strong>{{ group.items.length }} 项</strong></summary>
        <ul>
          <li v-for="item in group.items" :key="item.kind + item.id">
            <RouterLink :to="item.link">{{ item.employee }}</RouterLink>
            <span v-if="item.due">{{ item.due }}</span>
            <span>{{ item.next }}</span>
          </li>
        </ul>
      </details>
    </template>
  </main>
</template>

<style scoped>
.digest-page { max-width: 960px; margin: 0 auto; padding: 20px; overflow-wrap: anywhere; }
h1 { font-size: 22px; margin: 0; }
header p { color: var(--el-text-color-secondary); }
details { border: 1px solid var(--el-border-color); border-radius: 6px; margin-top: 10px; background: var(--el-bg-color); }
summary { cursor: pointer; padding: 12px 14px; }
summary strong { font-size: 13px; margin-inline-start: 8px; }
ul { margin: 0; padding: 0 14px; list-style: none; }
li { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline; padding: 10px 0; border-top: 1px solid var(--el-border-color-lighter); }
li span { color: var(--el-text-color-secondary); }
li a { color: var(--el-color-primary); font-weight: 600; }
@media (max-width: 540px) { .digest-page { padding: 12px; } li { display: grid; gap: 4px; } }
</style>
