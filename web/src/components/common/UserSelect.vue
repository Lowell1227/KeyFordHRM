<script setup lang="ts">
/**
 * 通用「选人」下拉：服务端远程搜索（按姓名/工号），不一次性拉全量。
 * 支持单选/多选；编辑回显时按 id 拉取已选项名称。
 */
import { ref, watch, onMounted } from 'vue';
import { usersApi } from '@/api/users.api';
import type { User } from '@/types/api.types';
import type { UserStatus } from '@/types/enums';

const props = withDefaults(
  defineProps<{
    modelValue: string | string[] | null | undefined;
    multiple?: boolean;
    placeholder?: string;
    status?: UserStatus;
    disabledIds?: string[];
    clearable?: boolean;
  }>(),
  { multiple: false, placeholder: '搜索姓名 / 工号', clearable: true },
);

const emit = defineEmits<{ 'update:modelValue': [v: string | string[] | undefined] }>();

const options = ref<User[]>([]);
const loading = ref(false);
const inner = ref<string | string[] | null | undefined>(props.modelValue);

watch(
  () => props.modelValue,
  (v) => { inner.value = v; ensureLabels(v); },
);
watch(inner, (v) => emit('update:modelValue', (v ?? undefined) as string | string[] | undefined));

function mergeOptions(list: User[]) {
  const map = new Map(options.value.map((u) => [u.id, u]));
  list.forEach((u) => map.set(u.id, u));
  options.value = Array.from(map.values());
}

async function search(keyword: string) {
  loading.value = true;
  try {
    const res = await usersApi.findAll({ page: 1, pageSize: 50, keyword: keyword || undefined, status: props.status });
    mergeOptions(res.items);
  } catch {
    /* 错误由 http 拦截器处理 */
  } finally {
    loading.value = false;
  }
}

/** 回显：已选 id 不在 options 里时，按 id 拉取补名称。 */
async function ensureLabels(v: string | string[] | null | undefined) {
  const ids = (Array.isArray(v) ? v : v ? [v] : []).filter((id) => !options.value.some((u) => u.id === id));
  for (const id of ids) {
    try {
      const u = await usersApi.findOne(id);
      mergeOptions([u]);
    } catch {
      /* 忽略单个回显失败 */
    }
  }
}

onMounted(() => {
  search('');
  ensureLabels(props.modelValue);
});
</script>

<template>
  <el-select
    v-model="inner"
    :multiple="multiple"
    filterable
    remote
    reserve-keyword
    :remote-method="search"
    :loading="loading"
    :placeholder="placeholder"
    :clearable="clearable"
    style="width: 100%"
  >
    <el-option
      v-for="u in options"
      :key="u.id"
      :label="`${u.name}${u.employeeNo ? ' (' + u.employeeNo + ')' : ''}`"
      :value="u.id"
      :disabled="disabledIds?.includes(u.id)"
    />
  </el-select>
</template>
