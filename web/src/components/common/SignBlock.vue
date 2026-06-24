<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { signaturesApi } from '@/api/signatures.api';
import type { Signature } from '@/types/api.types';
import type { SignatureRole, SignatureBusinessType } from '@/types/enums';
import { SIGNATURE_ROLE_LABELS, SIGNATURE_METHOD_LABELS } from '@/types/enums';
import dayjs from 'dayjs';

const props = defineProps<{
  businessType: SignatureBusinessType;
  businessRecordId: string;
  /** 当前登录用户在该记录上的签字角色位；无角色位（如旁观的部门负责人/审批人）传 null，仅展示状态。 */
  role?: SignatureRole | null;
  title?: string;
}>();

const emit = defineEmits<{
  (e: 'signed'): void;
}>();

const loading = ref(false);
const signing = ref(false);
const signatures = ref<Signature[]>([]);

const allRoles: SignatureRole[] = ['assessor', 'hr', 'assessee'];

async function load() {
  if (!props.businessRecordId) return;
  loading.value = true;
  try {
    signatures.value = await signaturesApi.findAll({
      businessType: props.businessType,
      businessRecordId: props.businessRecordId,
    });
  } finally {
    loading.value = false;
  }
}

async function handleSign() {
  if (!props.role) return;
  try {
    await ElMessageBox.confirm('确认以当前身份签字？签字仅留痕，不会修改任何业务数据。', '签字确认', {
      confirmButtonText: '确认签字',
      cancelButtonText: '取消',
      type: 'info',
    });
  } catch {
    return;
  }

  signing.value = true;
  try {
    await signaturesApi.sign({
      businessType: props.businessType,
      businessRecordId: props.businessRecordId,
      role: props.role,
    });
    ElMessage.success('签字成功');
    emit('signed');
    await load();
  } finally {
    signing.value = false;
  }
}

function findSignature(role: SignatureRole): Signature | undefined {
  return signatures.value.find((s) => s.role === role);
}

function formatTime(iso: string): string {
  return dayjs(iso).format('YYYY-MM-DD HH:mm');
}

const currentRoleSigned = computed(() => (props.role ? Boolean(findSignature(props.role)) : false));

watch(
  () => [props.businessType, props.businessRecordId],
  () => load(),
  { immediate: true },
);
</script>

<template>
  <el-card class="sign-block" shadow="never" v-loading="loading">
    <template #header>
      <span class="sign-block__title">{{ title ?? '三方签字' }}</span>
    </template>

    <div class="sign-block__list">
      <div
        v-for="r in allRoles"
        :key="r"
        class="sign-block__row"
        :class="{ 'sign-block__row--current': r === role }"
      >
        <div class="sign-block__role">
          <span class="sign-block__role-label">{{ SIGNATURE_ROLE_LABELS[r] }}</span>
          <el-tag v-if="r === role" size="small" type="primary">当前身份</el-tag>
        </div>

        <div class="sign-block__status">
          <template v-if="findSignature(r)">
            <el-tag type="success" size="small">已签</el-tag>
            <span class="sign-block__info">
              {{ findSignature(r)!.signerName }} · {{ formatTime(findSignature(r)!.signedAt) }}
              <span v-if="findSignature(r)!.method !== 'online_confirm'" class="sign-block__method">
                （{{ SIGNATURE_METHOD_LABELS[findSignature(r)!.method] }}）
              </span>
            </span>
          </template>
          <template v-else>
            <el-tag type="info" size="small">待签</el-tag>
          </template>
        </div>
      </div>
    </div>

    <div v-if="role" class="sign-block__action">
      <el-button
        v-if="!currentRoleSigned"
        type="primary"
        :loading="signing"
        @click="handleSign"
      >
        我要签字
      </el-button>
      <el-button v-else type="success" disabled> 我已签字 </el-button>
    </div>
  </el-card>
</template>

<style scoped>
.sign-block__title {
  font-weight: 600;
}

.sign-block__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sign-block__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

.sign-block__row--current {
  background: var(--el-color-primary-light-9);
}

.sign-block__role {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sign-block__role-label {
  font-weight: 500;
}

.sign-block__status {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sign-block__info {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.sign-block__method {
  color: var(--el-text-color-secondary);
}

.sign-block__action {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>
