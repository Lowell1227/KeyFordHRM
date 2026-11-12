<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { talentPoolApi } from '@/api/talent-pool.api';
import {
  EDUCATION_LABELS,
  TALENT_STATUS_TAG,
  type EducationOption,
  type ShareView,
  type TalentTag,
} from '@/types/talent.types';
import { TALENT_TAG_LABELS } from '@/types/talent.types';
import { formatDate } from '@/utils/date';
import { formatTalentFileSize } from './components/talent-file-upload';

/**
 * 被分享人只读视图（需求 §5.4）。
 * 严格使用后端脱敏字段白名单：无手机号/邮箱/期望薪资/来源渠道/备注/跟进记录。
 * 登录与权限校验在后端；任何失败统一显示「链接已失效或无权查看」，不泄露候选人信息。
 */

const route = useRoute();
const loading = ref(true);
const invalid = ref(false);
const view = ref<ShareView | null>(null);
const downloadingId = ref('');

onMounted(async () => {
  const token = typeof route.params.token === 'string' ? route.params.token : '';
  if (!token) {
    invalid.value = true;
    loading.value = false;
    return;
  }
  try {
    view.value = await talentPoolApi.viewShare(token);
  } catch {
    invalid.value = true;
  } finally {
    loading.value = false;
  }
});

function field(value: string | number | null | undefined): string {
  return value == null || value === '' ? '—' : String(value);
}

function educationLabel(key: string | null): string {
  return key ? (EDUCATION_LABELS[key as EducationOption] ?? key) : '—';
}

function tagLabel(tag: string): string {
  return TALENT_TAG_LABELS[tag as TalentTag] ?? tag;
}

async function downloadFile(fileId: string, fileName: string) {
  const token = view.value?.token;
  if (!token) return;
  downloadingId.value = fileId;
  try {
    const blob = await talentPoolApi.downloadShareFile(token, fileId);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch {
    ElMessage.error('文件下载失败，请稍后重试');
  } finally {
    downloadingId.value = '';
  }
}
</script>

<template>
  <div class="talent-shared-page" v-loading="loading">
    <div v-if="invalid && !loading" class="talent-shared-page__invalid">
      <h2>链接已失效或无权查看</h2>
      <p>该分享可能已过期、被撤销，或你不在接收人名单中。请联系分享人（HR）重新分享。</p>
    </div>

    <div v-else-if="view" class="talent-shared">
      <header class="talent-shared__header">
        <div class="talent-shared__title">
          <h2>{{ view.candidate.name }}</h2>
          <el-tag :type="TALENT_STATUS_TAG[view.candidate.status].type"
            :effect="TALENT_STATUS_TAG[view.candidate.status].effect ?? 'light'" size="small">
            {{ view.candidate.statusLabel }}
          </el-tag>
        </div>
        <p class="talent-shared__meta">
          HR 于 {{ formatDate(view.createdAt) }} 分享 · 有效期至 {{ formatDate(view.expiresAt) }}
        </p>
        <el-alert v-if="view.message" type="info" :closable="false" class="talent-shared__message"
          :title="view.message" />
      </header>

      <section class="talent-shared__section">
        <h3 class="talent-shared__section-title">基本情况</h3>
        <div class="talent-shared__grid">
          <div class="talent-shared__field"><span class="talent-shared__label">性别</span><span>{{ field(view.candidate.genderLabel) }}</span></div>
          <div class="talent-shared__field"><span class="talent-shared__label">年龄</span><span>{{ view.candidate.age == null ? '—' : `${view.candidate.age} 岁` }}</span></div>
          <div class="talent-shared__field"><span class="talent-shared__label">当前公司</span><span>{{ field(view.candidate.currentCompany) }}</span></div>
          <div class="talent-shared__field"><span class="talent-shared__label">当前职位</span><span>{{ field(view.candidate.currentPosition) }}</span></div>
          <div class="talent-shared__field"><span class="talent-shared__label">工作年限</span><span>{{ view.candidate.yearsOfExperience == null ? '—' : `${view.candidate.yearsOfExperience} 年` }}</span></div>
          <div class="talent-shared__field"><span class="talent-shared__label">学历</span><span>{{ educationLabel(view.candidate.education) }}</span></div>
          <div class="talent-shared__field"><span class="talent-shared__label">院校</span><span>{{ field(view.candidate.school) }}</span></div>
          <div class="talent-shared__field"><span class="talent-shared__label">专业</span><span>{{ field(view.candidate.major) }}</span></div>
        </div>
      </section>

      <section class="talent-shared__section">
        <h3 class="talent-shared__section-title">求职意向</h3>
        <div class="talent-shared__grid">
          <div class="talent-shared__field"><span class="talent-shared__label">意向岗位</span><span>{{ field(view.candidate.appliedPosition) }}</span></div>
          <div class="talent-shared__field"><span class="talent-shared__label">期望城市</span><span>{{ field(view.candidate.expectCity) }}</span></div>
        </div>
        <div v-if="view.candidate.tags.length" class="talent-shared__tags">
          <el-tag v-for="tag in view.candidate.tags" :key="tag" size="small" effect="plain">{{ tagLabel(tag) }}</el-tag>
        </div>
      </section>

      <section v-if="view.files.length" class="talent-shared__section">
        <h3 class="talent-shared__section-title">简历文件（{{ view.files.length }}）</h3>
        <div v-for="file in view.files" :key="file.id" class="talent-shared__file">
          <span class="talent-shared__file-name">{{ file.fileName }}</span>
          <span class="talent-shared__file-size">{{ formatTalentFileSize(file.fileSize) }}</span>
          <el-button size="small" text type="primary" :loading="downloadingId === file.id"
            @click="downloadFile(file.id, file.fileName)">下载</el-button>
        </div>
      </section>

      <p class="talent-shared__footer-note">本页面为只读分享视图，不显示联系方式、薪资与跟进记录。如需联系候选人，请与 HR 沟通。</p>
    </div>
  </div>
</template>

<style scoped>
.talent-shared-page {
  min-height: 100%;
  background: var(--el-bg-color-page);
}
.talent-shared-page__invalid {
  max-width: 480px;
  margin: 80px auto;
  padding: 0 20px;
  text-align: center;
  color: var(--el-text-color-regular);
}
.talent-shared-page__invalid h2 {
  margin: 0 0 10px;
  font-size: 18px;
  color: var(--el-text-color-primary);
}
.talent-shared {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 20px 48px;
}
.talent-shared__header { margin-bottom: 8px; }
.talent-shared__title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.talent-shared__title h2 { margin: 0; font-size: 20px; }
.talent-shared__meta {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.talent-shared__message { margin-top: 12px; }
.talent-shared__section {
  margin-top: 20px;
  padding: 16px;
  border-radius: 8px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
}
.talent-shared__section-title {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--el-text-color-primary);
}
.talent-shared__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 16px;
}
.talent-shared__field {
  display: flex;
  gap: 8px;
  font-size: 13px;
  line-height: 20px;
  min-width: 0;
}
.talent-shared__label {
  flex: 0 0 auto;
  width: 60px;
  color: var(--el-text-color-secondary);
}
.talent-shared__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.talent-shared__file {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: 13px;
}
.talent-shared__file:last-child { border-bottom: none; }
.talent-shared__file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.talent-shared__file-size {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.talent-shared__footer-note {
  margin: 20px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

@media (max-width: 600px) {
  .talent-shared { padding: 16px 12px 40px; }
  .talent-shared__grid { grid-template-columns: 1fr; }
}
</style>
