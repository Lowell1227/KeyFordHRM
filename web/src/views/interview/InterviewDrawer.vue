<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue';
import { isAxiosError } from 'axios';
import { ElMessage, type FormInstance } from 'element-plus';
import { interviewsApi, type InterviewPerson, type InterviewCycle } from '@/api/interviews.api';
import { useAuthStore } from '@/stores/auth.store';
import { INTERVIEW_METHOD_LABELS } from '@/types/enums';
import { formatDateTime } from '@/utils/date';
import type { PerformanceInterview, UpdateInterviewBody } from '@/types/api.types';

const props = defineProps<{ interviewId?: string; readonly?: boolean; cycles: InterviewCycle[] }>();
const emit = defineEmits<{ saved: []; cancel: [] }>();
const auth = useAuthStore();
const loading = ref(false);
const saving = ref(false);
const loadError = ref('');
const saveError = ref('');
const peopleLoading = ref(false);
const peopleError = ref('');
const people = ref<InterviewPerson[]>([]);
const interview = ref<PerformanceInterview>();
const formRef = ref<FormInstance>();
const identity = reactive({ employeeId: '', interviewerId: auth.user?.id ?? '', cycleId: '' });
const form = reactive<UpdateInterviewBody>({});
const newRecord = computed(() => !props.interviewId);
const editable = computed(() => !props.readonly);
const fields = [
  { key: 'achievements', label: '突出业绩', placeholder: '记录突出业绩和具体事例' },
  { key: 'weaknesses', label: '不足与待提升', placeholder: '记录不足与待提升项' },
  { key: 'nextGoals', label: '后续目标', placeholder: '记录后续目标和计划' },
  { key: 'remediation', label: '改进行动', placeholder: '记录商定的改进行动' },
  { key: 'supportNeeded', label: '所需支持', placeholder: '记录需协调的困难或资源' },
  { key: 'otherMatters', label: '其他沟通事项', placeholder: '记录其他沟通事项' },
] as const;
let detailRequest = 0;
let searchRequest = 0;
const personLabel = (person: InterviewPerson) => [person.name, person.employeeNo, person.dept?.name].filter(Boolean).join(' · ');
function errorText(error: unknown, fallback: string) {
  const message = isAxiosError(error) ? error.response?.data?.message : error instanceof Error ? error.message : null;
  return typeof message === 'string' && message ? message : fallback;
}

watch(() => props.interviewId, async () => {
  if (props.interviewId) await loadDetail();
  else {
    interview.value = undefined;
    if (auth.user) people.value = [{ id: auth.user.id, name: auth.user.name, employeeNo: null }];
    await searchPeople('');
  }
}, { immediate: true });

async function searchPeople(keyword: string) {
  const request = ++searchRequest;
  peopleLoading.value = true;
  peopleError.value = '';
  try {
    const result = await interviewsApi.people(keyword);
    if (request !== searchRequest) return;
    const selected = people.value.filter(person => person.id === identity.employeeId || person.id === identity.interviewerId);
    people.value = [...new Map([...selected, ...result].map(person => [person.id, person])).values()];
  } catch { if (request === searchRequest) peopleError.value = '人员暂时无法读取，请重新搜索'; }
  finally { if (request === searchRequest) peopleLoading.value = false; }
}
async function loadDetail() {
  const request = ++detailRequest;
  loading.value = true;
  loadError.value = '';
  try {
    const result = await interviewsApi.findOne(props.interviewId!);
    if (request !== detailRequest) return;
    interview.value = result;
    Object.assign(form, {
      interviewTime: result.interviewTime ?? undefined, location: result.location ?? '', method: result.method ?? undefined,
      scoreInformed: result.scoreInformed, ...Object.fromEntries(fields.map(field => [field.key, result[field.key] ?? ''])),
    });
  } catch (error) {
    if (request !== detailRequest) return;
    loadError.value = errorText(error, '面谈记录暂时无法读取，请重试');
  } finally { if (request === detailRequest) loading.value = false; }
}
async function save() {
  if (saving.value || !(await formRef.value?.validate().catch(() => false))) return;
  saving.value = true;
  saveError.value = '';
  try {
    if (props.interviewId) await interviewsApi.update(props.interviewId, { ...form });
    else await interviewsApi.create({ ...form, employeeId: identity.employeeId, interviewTime: form.interviewTime!,
      interviewerId: identity.interviewerId || undefined, cycleId: identity.cycleId || undefined });
    ElMessage.success('面谈记录已保存');
    emit('saved');
  } catch (error) { saveError.value = errorText(error, '保存失败，请重试'); }
  finally { saving.value = false; }
}
</script>

<template>
  <div v-loading="loading" class="interview-drawer">
    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false">
      <el-button link type="primary" @click="loadDetail">重试</el-button>
    </el-alert>
    <template v-else-if="newRecord || interview">
      <div v-if="interview" class="record-info">
        <div v-for="field in [
          ['员工', [interview.employeeName, interview.employeeNo].filter(Boolean).join(' · ')],
          ['部门', interview.deptName || '—'], ['关联周期', interview.cycleName || '未关联周期'],
          ['面谈人', interview.interviewerName || '—'], ['录入人', interview.recordedByName || '—'],
          ['最近更新', interview.updatedAt ? formatDateTime(interview.updatedAt) : '—'],
        ]" :key="field[0]"><span>{{ field[0] }}</span><div>{{ field[1] }}</div></div>
      </div>
      <el-form ref="formRef" :model="{ ...identity, ...form }" label-position="top" :disabled="!editable || saving" class="interview-form">
        <template v-if="newRecord">
          <el-alert v-if="peopleError" :title="peopleError" type="error" :closable="false" />
          <el-form-item label="员工" prop="employeeId" :rules="[{ required: true, message: '请选择员工', trigger: 'change' }]">
            <el-select v-model="identity.employeeId" filterable remote :remote-method="searchPeople" :loading="peopleLoading" placeholder="搜索员工姓名或工号" aria-label="员工">
              <el-option v-for="person in people" :key="person.id" :label="personLabel(person)" :value="person.id" />
            </el-select>
          </el-form-item>
          <div class="form-grid">
            <el-form-item label="面谈人" prop="interviewerId" :rules="[{ required: true, message: '请选择面谈人', trigger: 'change' }]">
              <el-select v-model="identity.interviewerId" filterable remote :remote-method="searchPeople" :loading="peopleLoading" placeholder="搜索面谈人" aria-label="面谈人">
                <el-option v-for="person in people" :key="person.id" :label="personLabel(person)" :value="person.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="关联周期（选填）">
              <el-select v-model="identity.cycleId" clearable filterable placeholder="可不关联周期" aria-label="关联周期">
                <el-option v-for="cycle in cycles" :key="cycle.id" :label="cycle.name" :value="cycle.id" />
              </el-select>
            </el-form-item>
          </div>
        </template>
        <div class="form-grid">
          <el-form-item label="面谈时间" prop="interviewTime" :rules="[{ required: editable, message: '请选择面谈时间', trigger: 'change' }]">
            <el-date-picker v-model="form.interviewTime" type="datetime" placeholder="选择面谈时间" value-format="YYYY-MM-DDTHH:mm:ssZ" />
          </el-form-item>
          <el-form-item label="面谈地点"><el-input v-model="form.location" placeholder="填写地点" maxlength="200" show-word-limit /></el-form-item>
          <el-form-item label="面谈方式">
            <el-select v-model="form.method" clearable :value-on-clear="null" placeholder="选择面谈方式" aria-label="面谈方式">
              <el-option v-for="(label, key) in INTERVIEW_METHOD_LABELS" :key="key" :label="label" :value="key" />
            </el-select>
          </el-form-item>
          <el-form-item label="结果沟通"><el-checkbox v-model="form.scoreInformed">已告知绩效分数</el-checkbox></el-form-item>
        </div>
        <template v-for="field in fields" :key="field.key">
          <el-form-item v-if="editable" :label="field.label">
            <el-input v-model="form[field.key]" type="textarea" :rows="3" :placeholder="field.placeholder" maxlength="4000" show-word-limit />
          </el-form-item>
          <section v-else class="record-note"><h3>{{ field.label }}</h3><p>{{ form[field.key] || '—' }}</p></section>
        </template>
      </el-form>
      <el-alert v-if="saveError" :title="saveError" type="error" :closable="false" class="save-error" />
      <div class="drawer-footer">
        <el-button :disabled="saving" @click="emit('cancel')">{{ editable ? '取消' : '关闭' }}</el-button>
        <el-button v-if="editable" type="primary" :loading="saving" @click="save">保存面谈记录</el-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.interview-drawer { min-width: 0; }
.record-info, .form-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 20px; }
.record-info { padding: 16px; gap: 16px 20px; background: var(--el-fill-color-light); border-radius: 6px; margin-bottom: 20px; font-size: 14px; overflow-wrap: anywhere; }
.record-info span { display: block; margin-bottom: 6px; color: var(--el-text-color-secondary); font-size: 12px; }
:deep(.el-select), :deep(.el-date-editor.el-input) { width: 100%; }
.record-note { padding: 14px 0; border-top: 1px solid var(--el-border-color-lighter); }
.record-note h3 { margin: 0 0 8px; font-size: 14px; }
.record-note p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.75; color: var(--el-text-color-regular); }
.drawer-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 0 0; position: sticky; bottom: 0; background: var(--el-bg-color); }
.save-error { margin-bottom: 12px; }
@media (max-width: 600px) { .form-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
