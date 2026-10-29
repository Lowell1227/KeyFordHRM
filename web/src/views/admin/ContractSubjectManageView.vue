<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { contractSubjectsApi, type ContractSubject } from '@/api/contract-subjects.api';
import { useAuthStore } from '@/stores/auth.store';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import QueryFilterPanel from '@/components/common/QueryFilterPanel.vue';
import ListPagination from '@/components/common/ListPagination.vue';
const auth = useAuthStore();
const canMaintain = computed(() => ['hr', 'system_admin'].includes(auth.user?.sysRole ?? ''));
const rows = ref<ContractSubject[]>([]);
const loading = ref(false); const saving = ref(false); const loadError = ref(''); const saveError = ref('');
const keyword = ref(''); const status = ref(''); const page = ref(1); const pageSize = ref(20);
const filtered = computed(() => rows.value.filter(row => row.name.includes(keyword.value.trim()) && (!status.value || String(row.isActive) === status.value)));
const visibleRows = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));
const dialog = ref(false); const selected = ref<ContractSubject>(); const name = ref('');
async function load() { loading.value = true; loadError.value = ''; try { rows.value = await contractSubjectsApi.findAll(true); } catch { loadError.value = '合同主体加载失败，请点击刷新重试。'; } finally { loading.value = false; } }
function edit(row?: ContractSubject) { selected.value = row; name.value = row?.name ?? ''; saveError.value = ''; dialog.value = true; }
async function save() {
  const value = name.value.trim();
  if (!value || value.length > 150) { saveError.value = '请填写 1–150 字主体名称'; return; }
  if (rows.value.some(row => row.id !== selected.value?.id && row.name === value)) { saveError.value = '该主体名称已存在'; return; }
  saving.value = true; saveError.value = '';
  try { if (selected.value) await contractSubjectsApi.update(selected.value.id, { name: value }); else await contractSubjectsApi.create({ name: value }); dialog.value = false; ElMessage.success('主体已保存'); await load(); }
  catch { saveError.value = '主体保存失败，请核对名称或稍后重试；输入已保留。'; }
  finally { saving.value = false; }
}
async function toggle(row: ContractSubject) {
  try { await ElMessageBox.confirm(row.isActive ? '停用后不能新选，已有任职和合同仍保留。' : '启用后可在任职和合同中选择。', row.isActive ? '停用主体' : '启用主体', { confirmButtonText: row.isActive ? '停用主体' : '启用主体', cancelButtonText: '取消' }); }
  catch { return; }
  saving.value = true;
  try { await contractSubjectsApi.update(row.id, { isActive: !row.isActive }); await load(); }
  catch { loadError.value = '主体状态更新失败，请重试。'; }
  finally { saving.value = false; }
}
onMounted(load);
</script>
<template>
  <BusinessListPage variant="record" :loading="loading">
    <template #primary-action><el-button v-if="canMaintain" type="primary" @click="edit()">新增主体</el-button><el-button :loading="loading" @click="load">刷新</el-button></template>
    <template #filters><QueryFilterPanel><el-form inline @submit.prevent="page = 1"><el-form-item label="主体名称"><el-input v-model="keyword" clearable placeholder="搜索主体名称" @input="page = 1" /></el-form-item><el-form-item label="状态"><el-select v-model="status" placeholder="全部状态" style="width: 140px" @change="page = 1"><el-option label="全部状态" value="" /><el-option label="启用" value="true" /><el-option label="停用" value="false" /></el-select></el-form-item></el-form></QueryFilterPanel></template>
    <template #feedback><el-alert v-if="loadError" :title="loadError" type="error" :closable="false" /><el-alert v-if="!canMaintain" title="可查看和选用主体；新增、改名及启停用由 HR 管理员维护。" type="info" :closable="false" /></template>
    <template #desktop-list><el-table :data="visibleRows" height="100%" class="app-table" empty-text="暂无合同主体"><el-table-column label="主体名称" prop="name" min-width="240" /><el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.isActive ? 'success' : 'info'">{{ row.isActive ? '启用' : '停用' }}</el-tag></template></el-table-column><el-table-column v-if="canMaintain" label="操作" width="160" fixed="right"><template #default="{ row }"><el-button link type="primary" :disabled="saving" @click="edit(row as ContractSubject)">修改名称</el-button><el-button link :disabled="saving" @click="toggle(row as ContractSubject)">{{ row.isActive ? '停用' : '启用' }}</el-button></template></el-table-column></el-table></template>
    <template #mobile-list><el-empty v-if="!loading && !visibleRows.length" description="暂无合同主体" /><div class="subject-cards"><MobileResultCard v-for="row in visibleRows" :key="row.id"><template #title>{{ row.name }}</template><template #status><el-tag :type="row.isActive ? 'success' : 'info'">{{ row.isActive ? '启用' : '停用' }}</el-tag></template><template v-if="canMaintain" #actions><el-button link type="primary" :disabled="saving" @click="edit(row as ContractSubject)">修改名称</el-button><el-button link :disabled="saving" @click="toggle(row as ContractSubject)">{{ row.isActive ? '停用' : '启用' }}</el-button></template></MobileResultCard></div></template>
    <template #pagination><ListPagination v-model:current-page="page" v-model:page-size="pageSize" :total="filtered.length" /></template>
    <template #detail><el-dialog v-model="dialog" :title="selected ? '修改主体名称' : '新增合同主体'" width="min(480px, calc(100vw - 24px))" :close-on-click-modal="false" :show-close="!saving" :close-on-press-escape="!saving"><el-form label-position="top" @submit.prevent="save"><el-form-item label="主体名称" :error="saveError"><el-input v-model="name" aria-label="主体名称" maxlength="150" show-word-limit :disabled="saving" /></el-form-item></el-form><template #footer><el-button :disabled="saving" @click="dialog = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存主体</el-button></template></el-dialog></template>
  </BusinessListPage>
</template>
<style scoped>.subject-cards { display: grid; gap: 10px; } :deep(.el-table .cell) { overflow-wrap: anywhere; }</style>
