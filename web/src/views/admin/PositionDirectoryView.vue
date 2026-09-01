<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { positionsApi, type PositionRecord } from '@/api/positions.api';

const items = ref<PositionRecord[]>([]);
const loading = ref(false);
const keyword = ref('');
const includeInactive = ref(false);
const dialog = reactive({ visible: false, editingId: '', code: '', name: '', jobFamily: '', saving: false });

async function load() {
  loading.value = true;
  try { items.value = await positionsApi.findAll({ keyword: keyword.value || undefined, includeInactive: includeInactive.value }); }
  finally { loading.value = false; }
}
function openCreate() { Object.assign(dialog, { visible: true, editingId: '', code: '', name: '', jobFamily: '' }); }
function openEdit(row: PositionRecord) { Object.assign(dialog, { visible: true, editingId: row.id, code: row.code, name: row.name, jobFamily: row.jobFamily ?? '' }); }
async function submit() {
  if (!dialog.code.trim() || !dialog.name.trim()) { ElMessage.warning('请填写岗位编码和岗位名称'); return; }
  dialog.saving = true;
  try {
    const body = { code: dialog.code.trim(), name: dialog.name.trim(), jobFamily: dialog.jobFamily.trim() || null };
    if (dialog.editingId) await positionsApi.update(dialog.editingId, body); else await positionsApi.create(body);
    ElMessage.success('已提交岗位变更，HR 管理员审核后生效'); dialog.visible = false;
  } finally { dialog.saving = false; }
}
async function deactivate(row: PositionRecord) {
  await ElMessageBox.confirm(`停用岗位“${row.name}”？在职员工仍使用时可提交，但审核前需先处理替代岗位。`, '停用岗位', { type: 'warning', confirmButtonText: '提交停用' });
  await positionsApi.deactivate(row.id);
  ElMessage.success('已提交停用审核');
}
onMounted(load);
</script>

<template>
  <div class="position-directory page-stack">
    <section class="position-card">
      <header class="position-head"><h2>岗位目录</h2><div><el-input v-model="keyword" placeholder="搜索编码、岗位或岗位族" clearable @keyup.enter="load" /><el-checkbox v-model="includeInactive" @change="load">含已停用</el-checkbox><el-button @click="load">查询</el-button><el-button type="primary" @click="openCreate">新增岗位</el-button></div></header>
      <el-table v-loading="loading" :data="items" class="app-table">
        <el-table-column prop="code" label="岗位编码" width="150" /><el-table-column prop="name" label="岗位名称" min-width="180" /><el-table-column prop="jobFamily" label="岗位族" min-width="180"><template #default="{ row }">{{ row.jobFamily || '未分类' }}</template></el-table-column>
        <el-table-column prop="activeEmployeeCount" label="在职人数" width="110" /><el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.isActive ? 'success' : 'info'">{{ row.isActive ? '启用' : '已停用' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="160"><template #default="{ row }"><el-button link type="primary" @click="openEdit(row as PositionRecord)">编辑</el-button><el-button v-if="row.isActive" link type="danger" @click="deactivate(row as PositionRecord)">停用</el-button></template></el-table-column>
      </el-table>
    </section>
    <el-dialog v-model="dialog.visible" :title="dialog.editingId ? '编辑岗位' : '新增岗位'" width="520px">
      <el-form label-position="top"><el-form-item label="岗位编码"><el-input v-model="dialog.code" /></el-form-item><el-form-item label="岗位名称"><el-input v-model="dialog.name" /></el-form-item><el-form-item label="岗位族"><el-input v-model="dialog.jobFamily" placeholder="选填，例如销售、供应链、职能" /></el-form-item></el-form>
      <template #footer><el-button @click="dialog.visible = false">取消</el-button><el-button type="primary" :loading="dialog.saving" @click="submit">提交审核</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.position-directory { max-width: 1600px; margin: 0 auto; }
.position-card { padding: 22px; border: 1px solid #e5eaf2; border-radius: 16px; background: #fff; }
.position-head { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
.position-head h2 { margin: 0; }.position-head > div { display: flex; align-items: center; gap: 10px; }.position-head .el-input { width: 280px; }
@media (max-width: 760px) { .position-head, .position-head > div { align-items: stretch; flex-direction: column; }.position-head .el-input { width: 100%; } }
</style>
