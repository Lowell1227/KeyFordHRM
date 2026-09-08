<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { cyclesApi, type CycleParticipantCandidate } from '@/api/cycles.api';

const props = defineProps<{ modelValue: string[]; placeholder?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();
const options = ref<CycleParticipantCandidate[]>([]);
const loading = ref(false);
let searchRequestId = 0;

function mergeOptions(users: CycleParticipantCandidate[]) {
  options.value = [...new Map([...options.value, ...users].map((user) => [user.id, user])).values()];
}

async function search(keyword: string) {
  const requestId = ++searchRequestId;
  loading.value = true;
  try {
    const result = await cyclesApi.findParticipantCandidates({ keyword: keyword.trim() || undefined, pageSize: 50 });
    if (requestId !== searchRequestId) return;
    options.value = options.value.filter((user) => props.modelValue.includes(user.id));
    mergeOptions(result.items);
  } catch {
    // Request errors are shown by the shared interceptor.
  } finally {
    if (requestId === searchRequestId) loading.value = false;
  }
}

async function ensureLabels() {
  const missing = props.modelValue.filter((id) => !options.value.some((user) => user.id === id));
  // Resolve only selected identities in bounded batches through the same permission boundary.
  for (let offset = 0; offset < missing.length; offset += 100) {
    try {
      const result = await cyclesApi.findParticipantCandidates({ ids: missing.slice(offset, offset + 100), pageSize: 100 });
      mergeOptions(result.items);
    } catch {
      // Keep saved IDs even if a selected employee is no longer an eligible candidate.
    }
  }
}

function label(user: CycleParticipantCandidate) {
  const identity = user.employeeNo ? `${user.name} (${user.employeeNo})` : user.name;
  return [identity, user.deptName, user.position].filter(Boolean).join(' · ');
}

watch(() => props.modelValue, ensureLabels, { deep: true });
onMounted(() => { void search(''); void ensureLabels(); });
</script>

<template>
  <el-select
    :model-value="modelValue"
    multiple
    filterable
    remote
    reserve-keyword
    clearable
    :remote-method="search"
    :loading="loading"
    :placeholder="placeholder"
    style="width: 100%"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-option v-for="user in options" :key="user.id" :value="user.id" :label="label(user)" />
  </el-select>
</template>
