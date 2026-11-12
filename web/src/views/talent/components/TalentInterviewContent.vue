<script setup lang="ts">
import { computed } from 'vue';
import { ElMessage } from 'element-plus';
import { CopyDocument } from '@element-plus/icons-vue';
import { INTERVIEW_STATUS_LABELS, type TalentInterviewView } from '@/types/talent.types';
import { formatInterviewTime } from '../interview-time';

const props = defineProps<{ invitation: TalentInterviewView }>();
const safeLink = computed(() => {
  try {
    const value = props.invitation.meetingUrl;
    if (!value || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'meeting.tencent.com' && !url.username && !url.password
      && (!url.port || url.port === '443') ? url.href : null;
  } catch { return null; }
});
async function copy() {
  try {
    await navigator.clipboard.writeText([props.invitation.invitationText, safeLink.value].filter(Boolean).join('\n'));
    ElMessage.success('邀请内容已复制');
  } catch { ElMessage.error('复制失败，请手动选中邀请内容复制'); }
}
</script>

<template>
  <div class="interview-content">
    <el-alert v-if="invitation.sourceDeleted" title="来源候选人已删除" type="warning" :closable="false" />
    <div class="interview-content__heading">
      <strong>{{ invitation.candidateNameSnapshot }}</strong>
      <el-tag size="small" :type="invitation.status === 'cancelled' ? 'info' : invitation.status === 'completed' ? 'success' : 'primary'">{{ INTERVIEW_STATUS_LABELS[invitation.status] }}</el-tag>
    </div>
    <dl>
      <dt>面试时间<small>北京时间</small></dt><dd>{{ formatInterviewTime(invitation.startsAt) }} 至 {{ formatInterviewTime(invitation.endsAt) }}</dd>
      <dt>内部参与人</dt><dd>{{ invitation.participantNames.join('、') }}</dd>
    </dl>
    <div class="interview-content__heading"><h4>会议邀请</h4><el-tooltip content="复制邀请内容"><el-button :icon="CopyDocument" aria-label="复制邀请内容" size="small" @click="copy" /></el-tooltip></div>
    <p class="interview-invitation-text">{{ invitation.invitationText }}</p>
    <a v-if="safeLink" :href="safeLink" target="_blank" rel="noopener noreferrer">打开腾讯会议</a>
    <template v-if="invitation.note"><h4>安排备注</h4><p class="interview-invitation-text">{{ invitation.note }}</p></template>
  </div>
</template>

<style scoped>
.interview-content { min-width: 0; overflow-wrap: anywhere; font-size: 14px; line-height: 1.7; color: var(--el-text-color-primary); }
.interview-content__heading { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin: 12px 0; }
.interview-content__heading h4 { font-size: 14px; margin: 0; }
dl { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; font-size: 14px; }
dt { color: var(--el-text-color-secondary); } dt small { display: block; font-size: 12px; } dd { margin: 0; }
.interview-invitation-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.6; margin: 10px 0; }
a { color: var(--el-color-primary); }
</style>
