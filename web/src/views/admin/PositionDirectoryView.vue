<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { positionsApi, type PositionRecord } from '@/api/positions.api';
import ChartCard from '@/components/common/ChartCard.vue';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import QueryFilterPanel from '@/components/common/QueryFilterPanel.vue';

const items = ref<PositionRecord[]>([]);
const loading = ref(false);
const keyword = ref('');
const includeInactive = ref(false);
const page = ref(1);
const pageSize = ref(10);
const dialog = reactive({ visible: false, editingId: '', code: '', name: '', jobFamily: '', saving: false });
let initialPositionSnapshot = '';

const pagedItems = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return items.value.slice(start, start + pageSize.value);
});

watch(pageSize, () => { page.value = 1; });

function positionSnapshot(value: { code: string; name: string; jobFamily: string | null }) {
  return JSON.stringify({ code: value.code.trim(), name: value.name.trim(), jobFamily: value.jobFamily?.trim() || null });
}

async function load() {
  loading.value = true;
  try {
    items.value = await positionsApi.findAll({ keyword: keyword.value || undefined, includeInactive: includeInactive.value });
    page.value = Math.min(page.value, Math.max(1, Math.ceil(items.value.length / pageSize.value)));
  }
  finally { loading.value = false; }
}
function search() { page.value = 1; void load(); }
function openCreate() { initialPositionSnapshot = ''; Object.assign(dialog, { visible: true, editingId: '', code: '', name: '', jobFamily: '' }); }
function openEdit(row: PositionRecord) {
  Object.assign(dialog, { visible: true, editingId: row.id, code: row.code, name: row.name, jobFamily: row.jobFamily ?? '' });
  initialPositionSnapshot = positionSnapshot({ code: row.code, name: row.name, jobFamily: row.jobFamily });
}
async function submit() {
  if (!dialog.code.trim() || !dialog.name.trim()) { ElMessage.warning('请填写岗位编码和岗位名称'); return; }
  const body = { code: dialog.code.trim(), name: dialog.name.trim(), jobFamily: dialog.jobFamily.trim() || null };
  if (dialog.editingId && positionSnapshot(body) === initialPositionSnapshot) {
    ElMessage.info('未检测到变更，无需提交审核');
    return;
  }
  dialog.saving = true;
  try {
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
  <div class="position-directory page-stack app-list-page">
    <ChartCard class="list-page-header-card">
      <template #title>岗位目录</template>
      <template #extra><el-button type="primary" @click="openCreate">新增岗位</el-button></template>
      <QueryFilterPanel>
        <div class="position-filter"><el-input v-model="keyword" placeholder="搜索编码、岗位或岗位族" clearable @keyup.enter="search" /><el-checkbox v-model="includeInactive" @change="search">含已停用</el-checkbox><el-button type="primary" @click="search">查询</el-button></div>
      </QueryFilterPanel>
    </ChartCard>
    <ChartCard :padded="false" class="list-result-card">
      <div class="desktop-result-table">
      <el-table v-loading="loading" :data="pagedItems" height="100%" class="app-table">
        <el-table-column prop="code" label="岗位编码" width="150" /><el-table-column prop="name" label="岗位名称" min-width="180" /><el-table-column prop="jobFamily" label="岗位族" min-width="180"><template #default="{ row }">{{ row.jobFamily || '未分类' }}</template></el-table-column>
        <el-table-column prop="activeEmployeeCount" label="在职人数" width="110" /><el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.isActive ? 'success' : 'info'">{{ row.isActive ? '启用' : '已停用' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="160"><template #default="{ row }"><el-button link type="primary" @click="openEdit(row as PositionRecord)">编辑</el-button><el-button v-if="row.isActive" link type="danger" @click="deactivate(row as PositionRecord)">停用</el-button></template></el-table-column>
      </el-table>
      </div>
      <div v-loading="loading" class="mobile-result-list">
        <MobileResultCard v-for="item in pagedItems" :key="item.id">
          <template #title>{{ item.name }}</template>
          <template #status><el-tag :type="item.isActive ? 'success' : 'info'" size="small">{{ item.isActive ? '启用' : '已停用' }}</el-tag></template>
          <div class="mobile-result-field"><span class="mobile-result-field__label">岗位编码</span><span class="mobile-result-field__value">{{ item.code }}</span></div>
          <div class="mobile-result-field"><span class="mobile-result-field__label">岗位族</span><span class="mobile-result-field__value">{{ item.jobFamily || '未分类' }}</span></div>
          <div class="mobile-result-field"><span class="mobile-result-field__label">在职人数</span><span class="mobile-result-field__value">{{ item.activeEmployeeCount }}</span></div>
          <template #actions><el-button link type="primary" @click="openEdit(item)">编辑</el-button><el-button v-if="item.isActive" link type="danger" @click="deactivate(item)">停用</el-button></template>
        </MobileResultCard>
      </div>
      <ListPagination v-model:current-page="page" v-model:page-size="pageSize" :total="items.length" />
    </ChartCard>
    <el-dialog v-model="dialog.visible" :title="dialog.editingId ? '编辑岗位' : '新增岗位'" width="520px">
      <el-form label-position="top"><el-form-item label="岗位编码"><el-input v-model="dialog.code" /></el-form-item><el-form-item label="岗位名称"><el-input v-model="dialog.name" /></el-form-item><el-form-item label="岗位族"><el-input v-model="dialog.jobFamily" placeholder="选填，例如销售、供应链、职能" /></el-form-item></el-form>
      <template #footer><el-button @click="dialog.visible = false">取消</el-button><el-button type="primary" :loading="dialog.saving" @click="submit">提交审核</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.position-directory { max-width: 1600px; margin: 0 auto; }
.position-filter { display: flex; align-items: center; gap: 10px; }
.position-filter .el-input { width: 280px; }
@media (max-width: 760px) { .position-filter { align-items: stretch; flex-direction: column; }.position-filter .el-input { width: 100%; } }
</style>
