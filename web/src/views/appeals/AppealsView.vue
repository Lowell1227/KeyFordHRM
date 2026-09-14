<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { isAxiosError } from 'axios';
import { ElMessage, type FormInstance } from 'element-plus';
import { appealsApi, type AppealCycle } from '@/api/appeals.api';
import { departmentsApi } from '@/api/departments.api';
import { usePagination } from '@/composables/usePagination';
import { formatDate } from '@/utils/date';
import ChartCard from '@/components/common/ChartCard.vue';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import PerformanceRecordFilters from '@/components/common/PerformanceRecordFilters.vue';
import type { AppealPerson, AppealRecord, AppealRecordBody, Department } from '@/types/api.types';

const list = ref<AppealRecord[]>([]);
const loading = ref(false);
const loadError = ref('');
const cycles = ref<AppealCycle[]>([]);
const departments = ref<Department[]>([]);
const filters = reactive({ cycleId: '', deptId: '', keyword: '' });
const { page, pageSize, total, pageSizeOptions, reset, withParams } = usePagination({ defaultPageSize: 10 });
const dialogVisible = ref(false);
const editingId = ref<string>();
const dialogLoading = ref(false);
const saving = ref(false);
const saveError = ref('');
const peopleLoading = ref(false);
const peopleError = ref('');
const people = ref<AppealPerson[]>([]);
const formRef = ref<FormInstance>();
const form = reactive<AppealRecordBody>({ employeeId: '', cycleId: '', receivedAt: '', content: '', handlingNote: '', conclusion: '' });
let listRequest = 0;
let peopleRequest = 0;

onMounted(async () => {
  const results = await Promise.allSettled([
    appealsApi.cycles(),
    departmentsApi.findAll({ isActive: true, pageSize: 1000 }),
  ]);
  if (results[0].status === 'fulfilled') cycles.value = results[0].value;
  if (results[1].status === 'fulfilled') departments.value = results[1].value;
  await loadList();
});

async function loadList() {
  const id = ++listRequest;
  loading.value = true;
  loadError.value = '';
  try {
    const result = await appealsApi.findAll(withParams({ cycleId: filters.cycleId || undefined,
      deptId: filters.deptId || undefined, keyword: filters.keyword.trim() || undefined }));
    if (id !== listRequest) return;
    list.value = result.items;
    total.value = result.total;
  } catch {
    if (id !== listRequest) return;
    list.value = [];
    total.value = 0;
    loadError.value = '申诉记录暂时无法读取，请重试';
  } finally { if (id === listRequest) loading.value = false; }
}
function onSearch() { reset(); void loadList(); }
function onReset() { Object.assign(filters, { cycleId: '', deptId: '', keyword: '' }); onSearch(); }
function clearValidation(field: string) { formRef.value?.clearValidate(field); }
function personLabel(person: AppealPerson) { return [person.name, person.employeeNo, person.dept?.name].filter(Boolean).join(' · '); }
function errorText(error: unknown, fallback: string) {
  const message = isAxiosError(error) ? error.response?.data?.message : error instanceof Error ? error.message : null;
  return typeof message === 'string' && message ? message : fallback;
}
async function searchPeople(keyword: string) {
  const id = ++peopleRequest;
  peopleLoading.value = true;
  peopleError.value = '';
  try {
    const result = await appealsApi.people(keyword);
    if (id !== peopleRequest) return;
    const selected = people.value.filter(person => person.id === form.employeeId);
    people.value = [...new Map([...selected, ...result].map(person => [person.id, person])).values()];
  } catch { if (id === peopleRequest) peopleError.value = '人员暂时无法读取，请重新搜索'; }
  finally { if (id === peopleRequest) peopleLoading.value = false; }
}
async function openDialog(item?: AppealRecord) {
  editingId.value = item?.id;
  saveError.value = '';
  Object.assign(form, { employeeId: '', cycleId: '', receivedAt: new Date().toLocaleDateString('sv-SE'),
    content: '', handlingNote: '', conclusion: '' });
  people.value = item ? [{ id: item.employeeId, name: item.employeeName, employeeNo: item.employeeNo,
    dept: item.deptName ? { name: item.deptName } : null }] : [];
  dialogVisible.value = true;
  void searchPeople('');
  if (!item) return;
  dialogLoading.value = true;
  try {
    const detail = await appealsApi.findOne(item.id);
    if (editingId.value !== item.id || !dialogVisible.value) return;
    Object.assign(form, { employeeId: detail.employeeId, cycleId: detail.cycleId ?? '',
      receivedAt: formatDate(detail.receivedAt), content: detail.content,
      handlingNote: detail.handlingNote ?? '', conclusion: detail.conclusion ?? '' });
  } catch (error) { saveError.value = errorText(error, '申诉记录暂时无法读取，请重试'); }
  finally { dialogLoading.value = false; }
}
async function save() {
  if (saving.value || dialogLoading.value || !(await formRef.value?.validate().catch(() => false))) return;
  saving.value = true;
  saveError.value = '';
  try {
    const body = { ...form, cycleId: form.cycleId || null };
    if (editingId.value) await appealsApi.update(editingId.value, body);
    else await appealsApi.create(body);
    ElMessage.success('申诉记录已保存');
    dialogVisible.value = false;
    await loadList();
  } catch (error) { saveError.value = errorText(error, '保存失败，请重试'); }
  finally { saving.value = false; }
}
</script>

<template>
  <div class="page-stack app-list-page">
    <ChartCard class="list-page-header-card">
      <template #title>申诉记录</template>
      <template #extra><el-button type="primary" @click="openDialog()">新增申诉记录</el-button></template>
      <PerformanceRecordFilters v-model:cycle-id="filters.cycleId" v-model:dept-id="filters.deptId"
        v-model:keyword="filters.keyword" :cycles="cycles" :departments="departments" :loading="loading"
        allow-all-cycles class="page-filter-panel" @search="onSearch" @reset="onReset" />
    </ChartCard>
    <ChartCard :padded="false" class="list-card list-result-card">
      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false">
        <el-button link type="primary" @click="loadList">重试</el-button>
      </el-alert>
      <div class="desktop-result-table">
        <el-table v-loading="loading" class="app-table" :data="list" height="100%" empty-text="暂无申诉记录">
          <el-table-column label="员工" min-width="130">
            <template #default="{ row }"><div class="employee-cell"><span>{{ row.employeeName }}</span><span class="employee-no">{{ row.employeeNo || '—' }}</span></div></template>
          </el-table-column>
          <el-table-column prop="deptName" label="部门" min-width="120" />
          <el-table-column label="收到日期" width="120"><template #default="{ row }">{{ formatDate(row.receivedAt) }}</template></el-table-column>
          <el-table-column prop="content" label="申诉内容" min-width="190" show-overflow-tooltip />
          <el-table-column label="关联周期" min-width="170" show-overflow-tooltip><template #default="{ row }">{{ row.cycleName || '未关联周期' }}</template></el-table-column>
          <el-table-column label="处理结论" min-width="170" show-overflow-tooltip><template #default="{ row }">{{ row.conclusion || '待补充' }}</template></el-table-column>
          <el-table-column prop="recordedByName" label="记录人" width="110" />
          <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDialog(row as AppealRecord)">编辑</el-button></template></el-table-column>
        </el-table>
      </div>
      <div v-loading="loading" class="mobile-result-list">
        <el-empty v-if="!loading && !list.length && !loadError" description="暂无申诉记录" />
        <MobileResultCard v-for="item in list" :key="item.id">
          <template #title>{{ item.employeeName }}<template v-if="item.employeeNo"> · {{ item.employeeNo }}</template></template>
          <div v-for="field in [['部门', item.deptName || '—'], ['收到日期', formatDate(item.receivedAt)],
            ['申诉内容', item.content], ['关联周期', item.cycleName || '未关联周期'],
            ['处理结论', item.conclusion || '待补充'], ['记录人', item.recordedByName || '—']]"
            :key="field[0]" class="mobile-result-field">
            <span class="mobile-result-field__label">{{ field[0] }}</span><span class="mobile-result-field__value">{{ field[1] }}</span>
          </div>
          <template #actions><el-button link type="primary" @click="openDialog(item)">编辑</el-button></template>
        </MobileResultCard>
      </div>
      <ListPagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="pageSizeOptions" :total="total" @change="loadList" />
    </ChartCard>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑申诉记录' : '新增申诉记录'" width="min(620px, 96vw)" destroy-on-close>
      <div v-loading="dialogLoading">
        <el-alert v-if="saveError" :title="saveError" type="error" :closable="false" class="dialog-alert" />
        <el-alert v-if="peopleError" :title="peopleError" type="error" :closable="false" class="dialog-alert" />
        <el-form ref="formRef" :model="form" label-position="top" :disabled="dialogLoading || saving" class="appeal-form">
          <el-form-item label="员工" prop="employeeId" :rules="[{ required: true, message: '请选择员工', trigger: 'change' }]">
            <el-select v-model="form.employeeId" filterable remote :remote-method="searchPeople" :loading="peopleLoading"
              placeholder="搜索员工姓名或工号" aria-label="员工" @change="clearValidation('employeeId')">
              <el-option v-for="person in people" :key="person.id" :label="personLabel(person)" :value="person.id" />
            </el-select>
          </el-form-item>
          <div class="appeal-form__grid">
            <el-form-item label="收到日期" prop="receivedAt" :rules="[{ required: true, message: '请选择收到日期', trigger: 'change' }]">
              <el-date-picker v-model="form.receivedAt" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" @change="clearValidation('receivedAt')" />
            </el-form-item>
            <el-form-item label="关联绩效周期（选填）">
              <el-select v-model="form.cycleId" clearable filterable placeholder="可不关联周期" aria-label="关联绩效周期">
                <el-option v-for="cycle in cycles" :key="cycle.id" :label="cycle.name" :value="cycle.id" />
              </el-select>
            </el-form-item>
          </div>
          <el-form-item label="申诉内容" prop="content" :rules="[{ required: true, whitespace: true, message: '请填写申诉内容', trigger: 'blur' }]">
            <el-input v-model="form.content" type="textarea" :rows="3" maxlength="10000" show-word-limit placeholder="记录员工提出的申诉内容" @input="clearValidation('content')" />
          </el-form-item>
          <el-form-item label="处理情况（可后续补充）"><el-input v-model="form.handlingNote" type="textarea" :rows="3" maxlength="10000" placeholder="记录沟通、核实和处理经过" /></el-form-item>
          <el-form-item label="处理结论（可后续补充）"><el-input v-model="form.conclusion" type="textarea" :rows="3" maxlength="10000" placeholder="记录最终处理结论" /></el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button :disabled="saving" @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="dialogLoading" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.employee-cell { display: flex; flex-direction: column; gap: 4px; }
.employee-no { font-size: 12px; color: var(--el-text-color-secondary); }
.appeal-form__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.dialog-alert { margin-bottom: 12px; }
@media (max-width: 600px) { .appeal-form__grid { grid-template-columns: 1fr; gap: 0; } }
</style>
