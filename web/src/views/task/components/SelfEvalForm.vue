<script setup lang="ts">
import { reactive, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import ScoreInput from '@/components/common/ScoreInput.vue';
import FileUpload from '@/components/common/FileUpload.vue';
import { uploadApi } from '@/api/upload.api';
import type { TaskDetail, IndicatorInstance, SelfEvalSummary, Attachment } from '@/types/api.types';
import type { SubmitSelfEvalBody } from '@/types/api.types';
import { isValidScore } from '@/utils/score';

export interface ActualValueItem {
  id: string;
  actualValue?: string;
  actualNote?: string;
}

interface InstanceFormItem {
  id: string;
  name: string;
  actualValue?: string;
  actualNote: string;
  selfScore: number | null;
  selfComment: string;
}

const props = defineProps<{
  task: TaskDetail;
  instances: IndicatorInstance[];
  summary?: SelfEvalSummary | null;
  readonly?: boolean;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'submit', body: SubmitSelfEvalBody, actualValues: ActualValueItem[]): void;
}>();

const form = reactive({
  instances: [] as InstanceFormItem[],
  achievements: '',
  improvements: '',
  suggestions: '',
  nextGoals: '',
  supportNeeded: '',
  attachments: [] as Attachment[],
});

const isDirty = computed(() => {
  return (
    form.instances.some(
      (i) =>
        i.actualValue != null ||
        i.actualNote ||
        i.selfScore != null ||
        i.selfComment,
    ) ||
    form.achievements ||
    form.improvements ||
    form.suggestions ||
    form.nextGoals ||
    form.supportNeeded ||
    form.attachments.length > 0
  );
});

function initForm() {
  form.instances = (props.instances ?? []).map((inst) => ({
    id: inst.id,
    name: inst.name,
    actualValue: inst.actualValue ?? undefined,
    actualNote: inst.actualNote ?? '',
    selfScore: inst.selfScore ?? null,
    selfComment: inst.selfComment ?? '',
  }));
  form.achievements = props.summary?.achievements ?? '';
  form.improvements = props.summary?.improvements ?? '';
  form.suggestions = props.summary?.suggestions ?? '';
  form.nextGoals = props.summary?.nextGoals ?? '';
  form.supportNeeded = props.summary?.supportNeeded ?? '';
  form.attachments = props.summary?.attachments ? [...props.summary.attachments] : [];
}

watch(
  () => [props.instances, props.summary],
  () => initForm(),
  { immediate: true, deep: true },
);

function validate(): boolean {
  for (const inst of form.instances) {
    if (inst.selfScore == null || !isValidScore(inst.selfScore)) {
      ElMessage.warning(`请为指标「${inst.name}」录入有效的自评分数（0-100）`);
      return false;
    }
  }
  return true;
}

function buildBody(): SubmitSelfEvalBody {
  return {
    indicators: form.instances.map((i) => ({
      id: i.id,
      selfScore: i.selfScore as number,
      selfComment: i.selfComment || undefined,
    })),
    summary: {
      achievements: form.achievements || undefined,
      improvements: form.improvements || undefined,
      suggestions: form.suggestions || undefined,
      nextGoals: form.nextGoals || undefined,
      supportNeeded: form.supportNeeded || undefined,
      attachments: form.attachments.length ? form.attachments : undefined,
    },
  };
}

function buildActualValues(): ActualValueItem[] {
  return form.instances
    .filter((i) => i.actualValue != null || i.actualNote)
    .map((i) => ({
      id: i.id,
      actualValue: i.actualValue || undefined,
      actualNote: i.actualNote || undefined,
    }));
}

function handleSubmit() {
  if (!validate()) return;
  emit('submit', buildBody(), buildActualValues());
}

async function handleUpload(files: File[]) {
  for (const file of files) {
    try {
      const attachment = await uploadApi.upload(file);
      form.attachments.push(attachment);
      ElMessage.success(`「${file.name}」上传成功`);
    } catch {
      ElMessage.error(`「${file.name}」上传失败`);
    }
  }
}

/** 从钉钉周报拉取完成情况（轻量接缝）：拉不到则静默跳过。 */
async function handleFetchDingtalkWeekly(inst: InstanceFormItem) {
  // TODO: 接入钉钉周报接口后，调用后端 /dingtalk/weekly 并回填 actualValue / actualNote。
  // 当前无接口，仅做按钮占位与错误静默。
  ElMessage.info('暂无钉钉周报数据，可继续手动填写。');
}

function getOriginalInstance(id: string): IndicatorInstance | undefined {
  return props.instances.find((i) => i.id === id);
}

function handleAttachmentsChange(attachments: Attachment[]) {
  form.attachments = attachments;
}
</script>

<template>
  <el-card shadow="never" class="self-eval-form">
    <template #header>
      <div class="card-header">
        <span>员工自评</span>
        <el-tag v-if="readonly" type="info" size="small">只读</el-tag>
      </div>
    </template>

    <h4 class="section-title">指标自评</h4>
    <div class="indicator-list">
      <div
        v-for="inst in form.instances"
        :key="inst.id"
        class="indicator-item"
        :class="{ 'indicator-item--readonly': readonly }"
      >
        <div class="indicator-item__header">
          <span class="indicator-item__name">{{ inst.name }}</span>
          <span class="indicator-item__meta">权重 {{ props.instances.find((i) => i.id === inst.id)?.weight ?? '-' }}</span>
        </div>
        <div v-if="getOriginalInstance(inst.id)?.dataSource || getOriginalInstance(inst.id)?.dataCaliber" class="indicator-item__meta-line">
          <el-tag v-if="getOriginalInstance(inst.id)?.dataSource" size="small" type="info" effect="plain">
            来源：{{ getOriginalInstance(inst.id)?.dataSource }}
          </el-tag>
          <el-tag v-if="getOriginalInstance(inst.id)?.dataCaliber" size="small" type="info" effect="plain">
            口径：{{ getOriginalInstance(inst.id)?.dataCaliber }}
          </el-tag>
        </div>

        <el-form label-position="top" class="indicator-item__form">
          <el-row :gutter="16">
            <el-col :span="8">
              <el-form-item label="实际完成值">
                <el-input
                  v-model="inst.actualValue"
                  :disabled="readonly"
                  placeholder="请输入"
                  maxlength="200"
                  show-word-limit
                  style="width: 100%"
                />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="实际完成说明">
                <el-input
                  v-model="inst.actualNote"
                  :disabled="readonly"
                  placeholder="说明实际完成情况"
                  maxlength="500"
                  show-word-limit
                />
              </el-form-item>
            </el-col>
            <el-col :span="4" class="dingtalk-col">
              <el-form-item label=" ">
                <el-button
                  v-if="!readonly"
                  type="primary"
                  link
                  size="small"
                  @click="handleFetchDingtalkWeekly(inst)"
                >
                  从钉钉周报拉取
                </el-button>
              </el-form-item>
            </el-col>
          </el-row>

          <el-row :gutter="16">
            <el-col :span="8">
              <el-form-item label="自评得分" required>
                <ScoreInput v-model="inst.selfScore" :disabled="readonly" placeholder="0-100" />
              </el-form-item>
            </el-col>
            <el-col :span="16">
              <el-form-item label="自评评语">
                <el-input
                  v-model="inst.selfComment"
                  :disabled="readonly"
                  type="textarea"
                  :rows="2"
                  placeholder="请说明打分依据"
                  maxlength="500"
                  show-word-limit
                />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </div>
    </div>

    <h4 class="section-title">自评总结</h4>
    <el-form label-position="top" class="summary-form">
      <el-form-item label="主要成果">
        <el-input
          v-model="form.achievements"
          :disabled="readonly"
          type="textarea"
          :rows="3"
          placeholder="本周期主要工作成果"
          maxlength="2000"
          show-word-limit
        />
      </el-form-item>
      <el-form-item label="待改进项">
        <el-input
          v-model="form.improvements"
          :disabled="readonly"
          type="textarea"
          :rows="3"
          placeholder="存在的不足与改进方向"
          maxlength="2000"
          show-word-limit
        />
      </el-form-item>
      <el-form-item label="建议 / 反馈">
        <el-input
          v-model="form.suggestions"
          :disabled="readonly"
          type="textarea"
          :rows="3"
          placeholder="对团队或管理者的建议"
          maxlength="2000"
          show-word-limit
        />
      </el-form-item>
      <el-form-item label="下季度目标">
        <el-input
          v-model="form.nextGoals"
          :disabled="readonly"
          type="textarea"
          :rows="3"
          placeholder="下阶段重点工作目标"
          maxlength="2000"
          show-word-limit
        />
      </el-form-item>
      <el-form-item label="需要的困难 / 资源支援">
        <el-input
          v-model="form.supportNeeded"
          :disabled="readonly"
          type="textarea"
          :rows="3"
          placeholder="工作中遇到的困难或需要的资源支持"
          maxlength="2000"
          show-word-limit
        />
      </el-form-item>
      <el-form-item label="附件">
        <FileUpload
          :model-value="form.attachments"
          :disabled="readonly"
          @upload="handleUpload"
          @update:model-value="handleAttachmentsChange"
        />
      </el-form-item>
    </el-form>

    <div v-if="!readonly" class="form-actions">
      <el-button type="primary" :loading="loading" @click="handleSubmit">提交自评</el-button>
    </div>
  </el-card>
</template>

<style scoped>
.self-eval-form {
  margin-bottom: 16px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  margin: 20px 0 12px;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.section-title:first-of-type {
  margin-top: 0;
}

.indicator-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.indicator-item {
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  background: #fff;
}

.indicator-item--readonly {
  background: var(--el-fill-color-light);
}

.indicator-item__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.indicator-item__name {
  font-weight: 600;
  font-size: 14px;
}

.indicator-item__meta {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.indicator-item__meta-line {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.indicator-item__form :deep(.el-form-item) {
  margin-bottom: 12px;
}

.dingtalk-col {
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
}

.summary-form :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter);
}
</style>
