<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { contractSubjectsApi, type ContractSubject } from '@/api/contract-subjects.api';
import { useAuthStore } from '@/stores/auth.store';
const props = defineProps<{ modelValue?: string | null; snapshotName?: string | null; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string | null]; 'update:snapshotName': [value: string | null] }>();
const rows = ref<ContractSubject[]>([]);
const loading = ref(false);
const error = ref('');
const auth = useAuthStore();
const canMaintain = computed(() => ['hr', 'system_admin'].includes(auth.user?.sysRole ?? ''));
const current = computed(() => rows.value.find(row => row.id === props.modelValue));
const options = computed(() => rows.value.filter(row => row.isActive || row.id === props.modelValue));
async function load() {
  loading.value = true; error.value = '';
  try { rows.value = await contractSubjectsApi.findAll(true); }
  catch { error.value = '主体加载失败，当前填写内容已保留，请刷新重试。'; }
  finally { loading.value = false; }
}
function select(value: string) {
  const row = rows.value.find(row => row.id === value);
  if (value && (!row?.isActive || value === props.modelValue)) return;
  emit('update:modelValue', value || null);
  emit('update:snapshotName', row?.name ?? null);
}
onMounted(load);
</script>
<template>
  <div class="contract-subject-select">
    <el-select :model-value="modelValue || undefined" :disabled="disabled" :loading="loading" filterable clearable placeholder="选择启用的合同主体" @update:model-value="select">
      <el-option v-if="modelValue && !current" :value="modelValue" :label="snapshotName || '原关联主体'" disabled />
      <el-option v-for="row in options" :key="row.id" :value="row.id" :label="row.id === modelValue && snapshotName ? snapshotName : row.name" :disabled="!row.isActive">
        <span>{{ row.name }}{{ row.isActive ? '' : '（已停用）' }}</span>
      </el-option>
    </el-select>
    <span v-if="snapshotName" class="subject-note">{{ snapshotName }} · {{ modelValue ? (current && !current.isActive ? '已关联，主体已停用' : '已关联') : '原记录，尚未关联' }}</span>
    <span v-if="!loading && !error && !rows.some(row => row.isActive)" class="subject-note">暂无启用主体，请联系 HR 管理员维护。</span>
    <span v-if="error" class="subject-error" role="alert">{{ error }}</span>
    <div class="subject-actions"><el-button v-if="snapshotName && !modelValue" link :disabled="disabled" @click="select('')">清空主体</el-button><el-button link type="primary" :disabled="disabled || loading" @click="load">刷新主体</el-button><a v-if="canMaintain && !disabled" href="/contract-subjects" target="_blank" rel="noopener noreferrer">维护主体（新窗口）</a></div>
  </div>
</template>
<style scoped>
.contract-subject-select { width: 100%; min-width: 0; display: grid; gap: 4px; }
.subject-note { color: #667085; font-size: 12px; overflow-wrap: anywhere; line-height: 1.5; }
.subject-error { color: var(--el-color-danger); font-size: 12px; line-height: 1.5; }
.subject-actions { display: flex; gap: 12px; flex-wrap: wrap; line-height: 1.5; }
.subject-actions a { color: var(--el-color-primary); font-size: 12px; text-decoration: none; }
</style>
