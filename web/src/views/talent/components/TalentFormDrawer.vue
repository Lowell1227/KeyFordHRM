<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { talentPoolApi } from '@/api/talent-pool.api';
import {
  TALENT_STATUSES,
  TALENT_STATUS_LABELS,
  TALENT_SOURCE_CHANNELS,
  TALENT_SOURCE_LABELS,
  TALENT_TAGS,
  TALENT_TAG_LABELS,
  EDUCATION_OPTIONS,
  EDUCATION_LABELS,
  TALENT_GENDERS,
  TALENT_GENDER_LABELS,
  TALENT_PHONE_EXISTS,
  type TalentCandidateDetail,
  type TalentGender,
  type TalentResumeFile,
  type TalentSourceChannel,
  type TalentStatus,
  type TalentTag,
  type EducationOption,
} from '@/types/talent.types';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import { isImageFile } from '@/utils/image-compress';
import {
  TALENT_MAX_FILES,
  TALENT_MAX_FILE_BYTES,
  TALENT_FILE_EXTENSIONS,
  formatTalentFileSize,
  talentFileExtension,
  uploadAndBindTalentFile,
} from './talent-file-upload';
import TalentFileList from './TalentFileList.vue';
import { useTalentPermissions } from '../useTalentPermissions';

const { canEdit } = useTalentPermissions();

/**
 * 新增 / 编辑候选人抽屉（需求 §5.2）。
 * 手机号查重：blur 即查，命中给出「打开已有记录」并阻止提交；
 * 新建时简历文件先排队，候选人创建成功后再逐个绑定。
 */

const props = defineProps<{
  modelValue: boolean;
  /** 编辑模式传入候选人 ID；不传为新增。 */
  candidateId?: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [candidateId: string];
  'open-existing': [candidateId: string];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});
const isEdit = computed(() => Boolean(props.candidateId));

interface PhoneConflict {
  existingId: string;
  existingName: string;
  statusLabel: string;
}

const formRef = ref<FormInstance>();
const loading = ref(false);
const saving = ref(false);
const conflict = ref<PhoneConflict | null>(null);
const pendingFiles = ref<File[]>([]);
const editFiles = ref<TalentResumeFile[]>([]);
const pendingUploading = ref(false);

const form = reactive({
  name: '',
  phone: '',
  email: '',
  gender: 'unknown' as TalentGender,
  birthYear: undefined as number | undefined,
  currentCompany: '',
  currentPosition: '',
  yearsOfExperience: undefined as number | undefined,
  appliedPosition: '',
  expectCity: '',
  expectSalaryMin: undefined as number | undefined,
  expectSalaryMax: undefined as number | undefined,
  salaryNegotiable: false,
  education: '' as EducationOption | '',
  school: '',
  major: '',
  sourceChannel: '' as TalentSourceChannel | '',
  tags: [] as TalentTag[],
  note: '',
  status: 'new' as TalentStatus,
});

const rules: FormRules = {
  name: [{ required: true, message: '请填写姓名', trigger: 'blur' }],
  phone: [
    { required: true, message: '请填写手机号', trigger: 'blur' },
    { pattern: /^1\d{10}$/, message: '手机号格式不正确', trigger: 'blur' },
  ],
  sourceChannel: [{ required: true, message: '请选择来源', trigger: 'change' }],
};

const editableStatuses = TALENT_STATUSES.filter((status) => status !== 'hired');

watch(() => props.modelValue, (open) => {
  if (open) void onOpen();
});

watch(() => form.salaryNegotiable, (negotiable) => {
  if (negotiable) {
    form.expectSalaryMin = undefined;
    form.expectSalaryMax = undefined;
  }
});

async function onOpen() {
  conflict.value = null;
  pendingFiles.value = [];
  editFiles.value = [];
  formRef.value?.clearValidate();
  if (props.candidateId) {
    loading.value = true;
    try {
      const detail = await talentPoolApi.detail(props.candidateId);
      fillForm(detail);
      editFiles.value = detail.files;
    } finally {
      loading.value = false;
    }
  } else {
    resetForm();
  }
}

function resetForm() {
  Object.assign(form, {
    name: '', phone: '', email: '', gender: 'unknown' as TalentGender,
    birthYear: undefined, currentCompany: '', currentPosition: '', yearsOfExperience: undefined,
    appliedPosition: '', expectCity: '',
    expectSalaryMin: undefined, expectSalaryMax: undefined, salaryNegotiable: false,
    education: '', school: '', major: '', sourceChannel: '', tags: [], note: '', status: 'new',
  });
}

function fillForm(detail: TalentCandidateDetail) {
  Object.assign(form, {
    name: detail.name,
    phone: detail.phone,
    email: detail.email ?? '',
    gender: detail.gender,
    birthYear: detail.birthYear ?? undefined,
    currentCompany: detail.currentCompany ?? '',
    currentPosition: detail.currentPosition ?? '',
    yearsOfExperience: detail.yearsOfExperience ?? undefined,
    appliedPosition: detail.appliedPosition ?? '',
    expectCity: detail.expectCity ?? '',
    expectSalaryMin: detail.expectSalaryMin ?? undefined,
    expectSalaryMax: detail.expectSalaryMax ?? undefined,
    salaryNegotiable: detail.expectSalaryMin == null && detail.expectSalaryMax == null,
    education: detail.education ?? '',
    school: detail.school ?? '',
    major: detail.major ?? '',
    sourceChannel: detail.sourceChannel,
    tags: [...detail.tags],
    note: detail.note ?? '',
    status: detail.status,
  });
  conflict.value = null;
}

/** 编辑态上传/删除附件后刷新本地列表。 */
async function refreshEditFiles() {
  if (!props.candidateId) return;
  const detail = await talentPoolApi.detail(props.candidateId);
  editFiles.value = detail.files;
}

/** 手机号失焦查重（需求 §5.2：命中显示姓名+状态，可打开已有记录）。 */
async function checkPhoneDuplicate() {
  conflict.value = null;
  if (!/^1\d{10}$/.test(form.phone)) return;
  try {
    const result = await talentPoolApi.checkPhone(form.phone);
    if (result.exists && result.candidate && result.candidate.id !== props.candidateId) {
      conflict.value = {
        existingId: result.candidate.id,
        existingName: result.candidate.name,
        statusLabel: result.candidate.statusLabel,
      };
    }
  } catch {
    // 查询失败不阻断填写，提交时服务端仍会校验
  }
}

function openExisting() {
  if (!conflict.value) return;
  emit('open-existing', conflict.value.existingId);
  visible.value = false;
}

function onPendingPick(event: Event) {
  const input = event.target as HTMLInputElement;
  const picked = input.files ? Array.from(input.files) : [];
  input.value = '';
  const room = TALENT_MAX_FILES - pendingFiles.value.length;
  if (picked.length > room) {
    ElMessage.warning(`简历文件最多 ${TALENT_MAX_FILES} 个`);
    return;
  }
  pendingFiles.value.push(...picked.filter((file) => {
    // 与 uploadAndBindTalentFile 同一套校验前置：类型不符直接拒；
    // 非图片超过 10MB 直接拒（图片创建后先压缩再判大小，大照片仍可入库）。
    if (!TALENT_FILE_EXTENSIONS.includes(talentFileExtension(file.name))) {
      ElMessage.error(`不支持的文件类型：${file.name}（仅支持 PDF/DOC/DOCX/JPG/PNG）`);
      return false;
    }
    if (!isImageFile(file) && file.size > TALENT_MAX_FILE_BYTES) {
      ElMessage.error(`${file.name} 超过 10MB，请压缩后重试`);
      return false;
    }
    if (pendingFiles.value.some((item) => item.name === file.name && item.size === file.size)) {
      ElMessage.warning(`「${file.name}」已在待上传列表中`);
      return false;
    }
    return true;
  }));
}

function removePending(file: File) {
  pendingFiles.value = pendingFiles.value.filter((item) => item !== file);
}

function pendingFileKind(file: File): string {
  return isImageFile(file) ? '图片' : '文档';
}

/** 提交时把 409 的手机号冲突转成内联提示。 */
function captureConflict(error: unknown) {
  const data = (error as { response?: { data?: { data?: { reason?: string; existingId?: string; existingName?: string } } } })
    ?.response?.data?.data;
  if (data?.reason === TALENT_PHONE_EXISTS && data.existingId) {
    conflict.value = { existingId: data.existingId, existingName: data.existingName ?? '', statusLabel: '' };
  }
}

async function submit() {
  if (!canEdit.value) return;
  if (conflict.value) return;
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    const body = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      gender: form.gender,
      birthYear: form.birthYear ?? null,
      currentCompany: form.currentCompany.trim() || null,
      currentPosition: form.currentPosition.trim() || null,
      yearsOfExperience: form.yearsOfExperience ?? null,
      appliedPosition: form.appliedPosition.trim() || null,
      expectCity: form.expectCity.trim() || null,
      expectSalaryMin: form.salaryNegotiable ? null : (form.expectSalaryMin ?? null),
      expectSalaryMax: form.salaryNegotiable ? null : (form.expectSalaryMax ?? null),
      education: form.education || null,
      school: form.school.trim() || null,
      major: form.major.trim() || null,
      sourceChannel: form.sourceChannel as TalentSourceChannel,
      tags: form.tags,
      note: form.note.trim() || null,
      ...(isEdit.value && form.status !== 'hired' ? { status: form.status } : {}),
    };
    let candidateId = props.candidateId ?? '';
    if (isEdit.value && candidateId) {
      await talentPoolApi.update(candidateId, body);
    } else {
      const created = await talentPoolApi.create(body);
      candidateId = created.id;
    }
    if (pendingFiles.value.length > 0) {
      pendingUploading.value = true;
      for (const file of pendingFiles.value) {
        await uploadAndBindTalentFile(candidateId, file);
      }
      pendingFiles.value = [];
    }
    ElMessage.success(isEdit.value ? '已保存修改' : '已加入人才库');
    emit('saved', candidateId);
    visible.value = false;
  } catch (error) {
    captureConflict(error);
  } finally {
    saving.value = false;
    pendingUploading.value = false;
  }
}
</script>

<template>
  <BusinessDetailDrawer v-model="visible" :title="isEdit ? '编辑人才' : '新增人才'"
    :loading="loading" :saving="saving || pendingUploading" variant="standard" class="talent-form-drawer">
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" class="talent-form"
      @submit.prevent="submit">
      <h4 class="talent-form__group-title">{{ isEdit ? '简历文件' : '简历文件（选填，创建成功后自动上传）' }}</h4>
      <template v-if="isEdit && candidateId">
        <TalentFileList :candidate-id="candidateId" :files="editFiles" editable @changed="refreshEditFiles" />
      </template>
      <template v-else>
        <div v-for="file in pendingFiles" :key="file.name + file.size" class="talent-form__pending">
          <el-icon><component :is="isImageFile(file) ? 'Picture' : 'Document'" /></el-icon>
          <span class="talent-form__pending-name">{{ file.name }}</span>
          <span class="talent-form__pending-meta">{{ pendingFileKind(file) }} · {{ formatTalentFileSize(file.size) }}</span>
          <el-button link type="danger" @click="removePending(file)">移除</el-button>
        </div>
        <div class="talent-form__upload-row">
          <input id="talent-form-file-input" type="file" class="talent-form__hidden-input" multiple
            accept=".pdf,.doc,.docx,image/*" @change="onPendingPick" />
          <input id="talent-form-camera-input" type="file" class="talent-form__hidden-input" accept="image/*"
            capture="environment" @change="onPendingPick" />
          <label for="talent-form-file-input" class="el-button el-button--default talent-form__pick">
            <el-icon><Plus /></el-icon><span>添加文件</span>
          </label>
          <label for="talent-form-camera-input" class="el-button el-button--primary talent-form__pick">
            <el-icon><Camera /></el-icon><span>拍照上传</span>
          </label>
          <span class="talent-form__hint">PDF/DOC/DOCX/JPG/PNG，单个 ≤10MB，最多 {{ TALENT_MAX_FILES }} 个</span>
        </div>
      </template>

      <h4 class="talent-form__group-title">基本信息</h4>
      <el-form-item label="姓名" prop="name">
        <el-input v-model="form.name" placeholder="候选人姓名" maxlength="30" />
      </el-form-item>
      <el-form-item label="手机" prop="phone">
        <el-input v-model="form.phone" placeholder="11 位手机号" maxlength="11" @blur="checkPhoneDuplicate" />
        <div v-if="conflict" class="talent-form__conflict">
          <span class="talent-form__conflict-text">
            该手机号已在库：{{ conflict.existingName }}<template v-if="conflict.statusLabel">（{{ conflict.statusLabel }}）</template>
          </span>
          <el-button link type="primary" @click="openExisting">打开已有记录</el-button>
        </div>
      </el-form-item>
      <el-form-item label="邮箱">
        <el-input v-model="form.email" placeholder="选填" maxlength="100" />
      </el-form-item>
      <el-form-item label="性别">
        <el-radio-group v-model="form.gender">
          <el-radio-button v-for="g in TALENT_GENDERS" :key="g" :value="g">{{ TALENT_GENDER_LABELS[g] }}</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="出生年份">
        <el-input-number v-model="form.birthYear" :min="1940" :max="new Date().getFullYear()" :controls="false"
          placeholder="选填" class="talent-form__year" />
      </el-form-item>
      <el-form-item label="当前公司">
        <el-input v-model="form.currentCompany" placeholder="选填" maxlength="50" />
      </el-form-item>
      <el-form-item label="当前职位">
        <el-input v-model="form.currentPosition" placeholder="选填" maxlength="50" />
      </el-form-item>
      <el-form-item label="工作年限">
        <el-input-number v-model="form.yearsOfExperience" :min="0" :max="60" :controls="false" placeholder="年"
          class="talent-form__year" />
      </el-form-item>

      <h4 class="talent-form__group-title">求职意向</h4>
      <el-form-item label="意向岗位">
        <el-input v-model="form.appliedPosition" placeholder="选填" maxlength="50" />
      </el-form-item>
      <el-form-item label="期望城市">
        <el-input v-model="form.expectCity" placeholder="选填" maxlength="30" />
      </el-form-item>
      <el-form-item label="期望薪资（K）">
        <div class="talent-form__salary">
          <el-input-number v-model="form.expectSalaryMin" :min="0" :max="999" :controls="false" placeholder="最低"
            :disabled="form.salaryNegotiable" @change="form.salaryNegotiable = false" />
          <span class="talent-form__salary-sep">–</span>
          <el-input-number v-model="form.expectSalaryMax" :min="0" :max="999" :controls="false" placeholder="最高"
            :disabled="form.salaryNegotiable" @change="form.salaryNegotiable = false" />
          <el-checkbox v-model="form.salaryNegotiable">面议</el-checkbox>
        </div>
      </el-form-item>
      <el-form-item label="学历">
        <el-select v-model="form.education" clearable placeholder="选填" class="talent-form__full">
          <el-option v-for="e in EDUCATION_OPTIONS" :key="e" :label="EDUCATION_LABELS[e]" :value="e" />
        </el-select>
      </el-form-item>
      <el-form-item label="院校">
        <el-input v-model="form.school" placeholder="选填" maxlength="50" />
      </el-form-item>
      <el-form-item label="专业">
        <el-input v-model="form.major" placeholder="选填" maxlength="50" />
      </el-form-item>
      <el-form-item label="来源" prop="sourceChannel">
        <el-select v-model="form.sourceChannel" data-testid="talent-form-source" placeholder="请选择来源" class="talent-form__full">
          <el-option v-for="s in TALENT_SOURCE_CHANNELS" :key="s" :label="TALENT_SOURCE_LABELS[s]" :value="s" />
        </el-select>
      </el-form-item>
      <el-form-item label="标签（最多 5 个）">
        <el-select v-model="form.tags" multiple :multiple-limit="5" collapse-tags clearable placeholder="选填"
          class="talent-form__full">
          <el-option v-for="t in TALENT_TAGS" :key="t" :label="TALENT_TAG_LABELS[t]" :value="t" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="isEdit && form.status !== 'hired'" label="状态">
        <el-select v-model="form.status" data-testid="talent-form-status" class="talent-form__full">
          <el-option v-for="s in editableStatuses" :key="s" :label="TALENT_STATUS_LABELS[s]" :value="s" />
        </el-select>
      </el-form-item>
      <el-form-item v-else-if="isEdit" label="状态"><span>已入职</span></el-form-item>

      <h4 class="talent-form__group-title">备注</h4>
      <el-form-item label="备注">
        <el-input v-model="form.note" type="textarea" :rows="3" maxlength="500" show-word-limit
          placeholder="选填，如沟通要点、淘汰原因建议写在这里" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving || pendingUploading" :disabled="Boolean(conflict)" @click="submit">
        {{ isEdit ? '保存修改' : '加入人才库' }}
      </el-button>
    </template>
  </BusinessDetailDrawer>
</template>

<style scoped>
.talent-form__group-title {
  margin: 18px 0 4px;
  font-size: 14px;
  color: var(--el-text-color-primary);
}
.talent-form__group-title:first-child { margin-top: 0; }
.talent-form__full { width: 100%; }
.talent-form__year { width: 120px; }
.talent-form__salary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.talent-form__salary :deep(.el-input-number) { width: 90px; }
.talent-form__salary-sep { color: var(--el-text-color-secondary); }
.talent-form__conflict {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 18px;
}
.talent-form__hint {
  width: 100%;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 18px;
}
.talent-form__pending {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
  margin-bottom: 6px;
  font-size: 13px;
}
.talent-form__pending-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.talent-form__pending-meta {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.talent-form__hidden-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
}
.talent-form__upload-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.talent-form__pick {
  cursor: pointer;
  margin-left: 0;
}
</style>
