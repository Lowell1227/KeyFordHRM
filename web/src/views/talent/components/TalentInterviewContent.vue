<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { CopyDocument } from '@element-plus/icons-vue';
import { INTERVIEW_STATUS_LABELS, type TalentInterviewView } from '@/types/talent.types';
import { formatInterviewTime } from '../interview-time';
import { interviewApplicationLabel } from '../interview-application';
import { safeTencentMeetingLink } from '../interview-meeting-link';
import { interviewInvitationCopies } from '../interview-invitation';
import TalentInterviewFeedback from './TalentInterviewFeedback.vue';

const emit = defineEmits<{ changed: [] }>();
const feedback = ref<InstanceType<typeof TalentInterviewFeedback>>();
defineExpose({ prepareToLeave: async () => await feedback.value?.prepareToLeave() ?? true });
const props = defineProps<{ invitation: TalentInterviewView }>();
const audience = ref<'candidate' | 'interviewer'>('candidate');
const safeLink = computed(() => safeTencentMeetingLink(props.invitation.meetingUrl ?? ''));
const invitationCopies = computed(() => interviewInvitationCopies(props.invitation, window.location.origin));
const selectedInvitation = computed(() => invitationCopies.value[audience.value]);
async function copy() {
  try {
    await navigator.clipboard.writeText(selectedInvitation.value);
    ElMessage.success(audience.value === 'candidate' ? '候选人邀请已复制，请人工发送给候选人' : '面试官邀请已复制，请人工发送给面试官');
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
      <template v-if="invitation.application !== undefined"><dt>关联应聘</dt><dd>{{ interviewApplicationLabel(invitation.application) }}</dd></template>
      <dt>面试时间<small>北京时间</small></dt><dd>{{ formatInterviewTime(invitation.startsAt) }} 至 {{ formatInterviewTime(invitation.endsAt) }}</dd>
      <dt>内部参与人</dt><dd>{{ invitation.participantNames.join('、') }}</dd>
    </dl>
    <div class="interview-content__heading"><h4>面试邀请</h4>
      <el-radio-group v-model="audience" size="small" aria-label="邀请对象"><el-radio-button value="candidate">候选人版</el-radio-button><el-radio-button value="interviewer">面试官版</el-radio-button></el-radio-group>
      <el-tooltip :content="audience === 'candidate' ? '复制候选人邀请' : '复制面试官邀请'"><el-button :icon="CopyDocument" :aria-label="audience === 'candidate' ? '复制候选人邀请' : '复制面试官邀请'" size="small" @click="copy" /></el-tooltip>
    </div>
    <p class="interview-invitation-text">{{ selectedInvitation }}</p><p class="interview-content__manual">{{ audience === 'candidate' ? '候选人需经办人工联系，HRM保存安排不代表已送达候选人。' : '复制后需人工发送，面试官仍须登录HRM并有本场面试权限才能填写本人反馈。' }}</p>
    <a v-if="safeLink" :href="safeLink" target="_blank" rel="noopener noreferrer">打开腾讯会议</a>
    <template v-if="invitation.note"><h4>安排备注（内部参与人可见）</h4><p class="interview-invitation-text">{{ invitation.note }}</p></template>
    <TalentInterviewFeedback ref="feedback" :key="invitation.id" :interview-id="invitation.id" :interview-version="invitation.version" @changed="emit('changed')" />
  </div>
</template>

<style scoped>
.interview-content { min-width: 0; overflow-wrap: anywhere; font-size: 14px; line-height: 1.7; color: var(--el-text-color-primary); }
.interview-content__heading { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin: 12px 0; }
.interview-content__heading h4 { font-size: 14px; margin: 0; }
dl { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; font-size: 14px; }
dt { color: var(--el-text-color-secondary); } dt small { display: block; font-size: 12px; } dd { margin: 0; }
.interview-invitation-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.6; margin: 10px 0; }
.interview-content__manual { font-size: 12px; color: var(--el-text-color-secondary); }
a { color: var(--el-color-primary); }
</style>
