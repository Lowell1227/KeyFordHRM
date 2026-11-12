<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { talentPoolApi } from '@/api/talent-pool.api';
import { usersApi } from '@/api/users.api';
import type { User } from '@/types/api.types';
import type { SysRole } from '@/types/enums';
import type { TalentShareRecord } from '@/types/talent.types';
import { formatDate } from '@/utils/date';

/**
 * 转发分享抽屉（需求 §5.4）：选择接收人（部门负责人/经理/HR/VP，最多 5 人）、
 * 有效期 7/30 天、可选附简历原件、留言 ≤100 字；创建后展示链接可一键复制；
 * 下方列出历史分享并支持撤销。
 */

const props = defineProps<{
  modelValue: boolean;
  candidateId: string;
  candidateName: string;
  shares: TalentShareRecord[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  changed: [];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

/** 接收人可选角色（与后端 RECIPIENT_ROLES 一致，前端先过滤一层）。 */
const RECIPIENT_ROLES: SysRole[] = ['dept_head', 'manager', 'hr', 'vp', 'system_admin'];
const MAX_RECIPIENTS = 5;

const recipientIds = ref<string[]>([]);
const recipientOptions = ref<User[]>([]);
const searching = ref(false);
const expiresInDays = ref<7 | 30>(7);
const includeResume = ref(false);
const message = ref('');
const creating = ref(false);
const createError = ref('');
const createdUrl = ref('');

watch(() => props.modelValue, (open) => {
  if (open) resetForm();
});

function resetForm() {
  recipientIds.value = [];
  recipientOptions.value = [];
  expiresInDays.value = 7;
  includeResume.value = false;
  message.value = '';
  createError.value = '';
  createdUrl.value = '';
}

async function searchRecipients(keyword: string) {
  searching.value = true;
  try {
    const res = await usersApi.findAll({ keyword, page: 1, pageSize: 20, includeResigned: false });
    recipientOptions.value = res.items.filter((user) => RECIPIENT_ROLES.includes(user.sysRole));
  } finally {
    searching.value = false;
  }
}

function recipientLabel(user: User): string {
  const parts = [user.name];
  if (user.deptName) parts.push(user.deptName);
  return parts.join(' · ');
}

async function createShare() {
  createError.value = '';
  if (recipientIds.value.length === 0) {
    createError.value = '请至少选择 1 位接收人';
    return;
  }
  creating.value = true;
  try {
    const result = await talentPoolApi.createShare(props.candidateId, {
      recipientIds: recipientIds.value,
      expiresInDays: expiresInDays.value,
      includeResume: includeResume.value,
      message: message.value.trim() || undefined,
    });
    createdUrl.value = `${window.location.origin}${result.url}`;
    ElMessage.success('已生成分享链接，站内通知已发送给接收人');
    emit('changed');
  } catch (error) {
    createError.value = error instanceof Error && error.message ? error.message : '创建分享失败，请重试';
  } finally {
    creating.value = false;
  }
}

async function copyLink() {
  if (!createdUrl.value) return;
  try {
    await navigator.clipboard.writeText(createdUrl.value);
    ElMessage.success('链接已复制，可粘贴给接收人');
  } catch {
    ElMessage.warning(`复制失败，请手动复制：${createdUrl.value}`);
  }
}

async function revoke(share: TalentShareRecord) {
  await ElMessageBox.confirm(
    '撤销后该链接立即失效，已收到的接收人刷新后将无法查看。确定撤销？',
    '撤销分享',
    { confirmButtonText: '撤销分享', cancelButtonText: '取消', type: 'warning' },
  );
  await talentPoolApi.revokeShare(share.id);
  ElMessage.success('已撤销');
  emit('changed');
}

function shareState(share: TalentShareRecord): { label: string; type: 'info' | 'danger' | 'success' } {
  if (share.revokedAt) return { label: '已撤销', type: 'danger' };
  if (new Date(share.expiresAt).getTime() < Date.now()) return { label: '已过期', type: 'info' };
  return { label: '生效中', type: 'success' };
}

async function copyShareUrl(share: TalentShareRecord) {
  try {
    await navigator.clipboard.writeText(shareUrl(share));
    ElMessage.success('链接已复制');
  } catch {
    ElMessage.warning(`复制失败，请手动复制：${shareUrl(share)}`);
  }
}

function shareUrl(share: TalentShareRecord): string {
  return `${window.location.origin}/talents/s/${share.token}`;
}
</script>

<template>
  <el-drawer v-model="visible" :title="`转发候选人：${candidateName}`" size="480px" class="talent-share-drawer">
    <div class="talent-share">
      <h4 class="talent-share__section-title">新建分享</h4>
      <el-form label-position="top" size="default" @submit.prevent>
        <el-form-item label="接收人（部门负责人 / 经理 / HR / VP，最多 5 人）" required>
          <el-select v-model="recipientIds" data-testid="talent-share-recipients" multiple filterable remote :remote-method="searchRecipients"
            :loading="searching" placeholder="输入姓名搜索" :multiple-limit="MAX_RECIPIENTS" class="talent-share__recipients">
            <el-option v-for="user in recipientOptions" :key="user.id" :label="recipientLabel(user)" :value="user.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="链接有效期" required>
          <el-radio-group v-model="expiresInDays">
            <el-radio-button :value="7">7 天</el-radio-button>
            <el-radio-button :value="30">30 天</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="附简历原件">
          <el-switch v-model="includeResume" />
          <span class="talent-share__resume-hint">接收人可下载简历文件</span>
        </el-form-item>
        <el-form-item label="留言（选填，接收人可见）">
          <el-input v-model="message" type="textarea" :rows="2" maxlength="100" show-word-limit
            placeholder="例如：重点看供应链经验，麻烦本周内反馈" />
        </el-form-item>
        <el-alert v-if="includeResume" type="warning" :closable="false" class="talent-share__warning"
          title="已开启附简历原件：接收人在链接有效期内可下载简历文件，请确认对方有查看权限。" />
        <el-alert v-if="createError" type="error" :title="createError" :closable="false" class="talent-share__warning" />
        <el-button type="primary" :loading="creating" :disabled="recipientIds.length === 0" class="talent-share__create"
          @click="createShare">生成分享链接</el-button>
      </el-form>

      <div v-if="createdUrl" class="talent-share__result">
        <div class="talent-share__result-url">{{ createdUrl }}</div>
        <el-button size="small" type="primary" plain @click="copyLink">复制链接</el-button>
      </div>

      <h4 class="talent-share__section-title">历史分享（{{ shares.length }}）</h4>
      <el-empty v-if="!shares.length" description="还没有分享记录" :image-size="80" />
      <div v-for="share in shares" :key="share.id" class="talent-share__history-item">
        <div class="talent-share__history-main">
          <div class="talent-share__history-recipients">
            {{ (share.recipientNames ?? []).join('、') || '—' }}
            <el-tag :type="shareState(share).type" size="small" effect="light">{{ shareState(share).label }}</el-tag>
          </div>
          <div class="talent-share__history-meta">
            有效期至 {{ formatDate(share.expiresAt) }} · 查看 {{ share.viewCount }} 次<template v-if="share.lastViewedAt">
              · 最近 {{ formatDate(share.lastViewedAt) }}</template>
            <template v-if="share.includeResume"> · 附简历</template>
          </div>
        </div>
        <div class="talent-share__history-actions">
          <el-button v-if="!share.revokedAt && new Date(share.expiresAt).getTime() >= Date.now()" link type="primary"
            @click="copyShareUrl(share)">复制链接</el-button>
          <el-button v-if="!share.revokedAt" link type="danger" @click="revoke(share)">撤销</el-button>
        </div>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.talent-share__section-title {
  margin: 0 0 10px;
  font-size: 14px;
  color: var(--el-text-color-primary);
}
.talent-share__recipients { width: 100%; }
.talent-share__resume-hint { margin-left: 10px; font-size: 12px; color: var(--el-text-color-secondary); }
.talent-share__warning { margin-bottom: 12px; }
.talent-share__create { width: 100%; }
.talent-share__result {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 0 4px;
  padding: 10px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
}
.talent-share__result-url {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  word-break: break-all;
  color: var(--el-text-color-regular);
}
.talent-share__history-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.talent-share__history-item:last-child { border-bottom: none; }
.talent-share__history-main { min-width: 0; }
.talent-share__history-recipients {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--el-text-color-primary);
}
.talent-share__history-meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.talent-share__history-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
}
</style>
