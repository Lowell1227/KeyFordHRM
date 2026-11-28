<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import { systemConfigurationApi, type SystemConfigurationView } from '@/api/system-configuration.api';
import { recruitmentIntakesApi } from '@/api/recruitment-intakes.api';
import type { MailboxChoice } from '@/types/recruitment-intake.types';

const router = useRouter();
const rows = ref<SystemConfigurationView[]>([]);
const status = ref<MailboxChoice[]>([]);
const loading = ref(false), creating = ref(false), error = ref(''), statusError = ref('');
let version = 0;
const field = (row: SystemConfigurationView, key: string) => row.fields.find(item => item.key === key)?.value;
const mailboxName = (row: SystemConfigurationView) => String(field(row, 'RECRUITMENT_MAIL_NAME') || field(row, 'RECRUITMENT_MAIL_ACCOUNT') || (row.id === 'recruitment-mail' ? '原招聘邮箱' : '待填写名称'));
const isEnabled = (row: SystemConfigurationView) => status.value.find(item => item.id === row.id)?.enabled ?? false;
function lastRead(row: SystemConfigurationView) {
  const time = status.value.find(item => item.id === row.id)?.lastSyncedAt;
  return time ? new Date(time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : statusError.value ? '状态待核实' : '尚未读取';
}
function destination(row: SystemConfigurationView) {
  return { name: 'SystemConfiguration', params: { setting: row.id }, ...(row.id === 'recruitment-mail' ? { query: { mailbox: 'recruitment-mail' } } : {}) };
}
async function load() {
  const token = ++version; loading.value = true; error.value = ''; statusError.value = '';
  const [configurationResult, statusResult] = await Promise.allSettled([systemConfigurationApi.mailboxes(), recruitmentIntakesApi.mailboxes()]);
  if (token !== version) return;
  if (configurationResult.status === 'fulfilled') rows.value = configurationResult.value;
  else { rows.value = []; error.value = '邮箱列表读取失败，请重试。'; }
  if (statusResult.status === 'fulfilled') status.value = statusResult.value;
  else { status.value = []; statusError.value = '上次读取状态暂不可用，请刷新核对。'; }
  loading.value = false;
}
async function createMailbox() {
  if (creating.value || loading.value) return;
  creating.value = true; error.value = '';
  try {
    const row = await systemConfigurationApi.createMailbox();
    rows.value.push(row);
    await router.push(destination(row));
  } catch { error.value = '邮箱新增或页面打开未完成，请刷新列表核对，已新增的草稿可继续维护。'; }
  finally { creating.value = false; }
}
onMounted(load);
onBeforeUnmount(() => { version++; });
</script>

<template>
  <BusinessListPage variant="record" :loading="loading" class="mailboxes-page" data-testid="recruitment-mailbox-list">
    <template #subtitle>分别维护用于接收简历的招聘邮箱。每个邮箱独立保存、核验和应用；应用不会自动读取邮件。</template>
    <template #primary-action>
      <el-button type="primary" :loading="creating" :disabled="loading || creating" data-testid="mailbox-create" @click="createMailbox">新增招聘邮箱</el-button>
      <el-button :disabled="loading || creating" @click="load">刷新邮箱列表</el-button>
      <RouterLink to="/system">返回配置总览</RouterLink>
    </template>
    <template #feedback>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-alert v-if="statusError" :title="statusError" type="warning" :closable="false" />
    </template>
    <template #desktop-list>
      <el-table :data="rows" height="100%" class="app-table" :empty-text="error ? '邮箱读取失败' : '尚未添加招聘邮箱'">
        <el-table-column label="邮箱名称 / 账号" min-width="220"><template #default="{ row }"><strong>{{ mailboxName(row as SystemConfigurationView) }}</strong><div>{{ field(row as SystemConfigurationView, 'RECRUITMENT_MAIL_ACCOUNT') || '账号待填写' }}</div></template></el-table-column>
        <el-table-column label="获准文件夹" min-width="150"><template #default="{ row }">{{ field(row as SystemConfigurationView, 'RECRUITMENT_MAIL_FOLDER') || '目录待填写' }}</template></el-table-column>
        <el-table-column label="保存 / 应用" min-width="150"><template #default="{ row }">已保存 {{ row.revision }} · 已应用 {{ row.appliedRevision || '无' }}<div>{{ row.verification === 'passed' ? '当前版本核验通过' : row.verification === 'failed' ? '当前版本核验失败' : '当前版本待核验' }}</div></template></el-table-column>
        <el-table-column label="当前读取开关" width="125"><template #default="{ row }">{{ isEnabled(row as SystemConfigurationView) ? '已启用' : '未启用' }}</template></el-table-column>
        <el-table-column label="上次读取" min-width="165"><template #default="{ row }">{{ lastRead(row as SystemConfigurationView) }}</template></el-table-column>
        <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }"><RouterLink :to="destination(row as SystemConfigurationView)" :aria-label="'维护' + mailboxName(row as SystemConfigurationView)">维护邮箱</RouterLink></template></el-table-column>
      </el-table>
    </template>
    <template #mobile-list>
      <div class="mailboxes-mobile">
        <el-empty v-if="!loading && !rows.length" :description="error ? '邮箱读取失败' : '尚未添加招聘邮箱'" />
        <MobileResultCard v-for="row in rows" :key="row.id">
          <template #title>{{ mailboxName(row) }}</template><template #status>{{ isEnabled(row) ? '已启用' : '未启用' }}</template>
          <dl><dt>账号</dt><dd>{{ field(row, 'RECRUITMENT_MAIL_ACCOUNT') || '待填写' }}</dd><dt>文件夹</dt><dd>{{ field(row, 'RECRUITMENT_MAIL_FOLDER') || '待填写' }}</dd><dt>保存 / 应用</dt><dd>{{ row.revision }} / {{ row.appliedRevision || '无' }}</dd><dt>上次读取</dt><dd>{{ lastRead(row) }}</dd></dl>
          <template #actions><RouterLink :to="destination(row)" :aria-label="'维护' + mailboxName(row)">维护邮箱</RouterLink></template>
        </MobileResultCard>
      </div>
    </template>
  </BusinessListPage>
</template>

<style scoped>
.mailboxes-page { min-width: 0; }
a { color: var(--el-color-primary); text-underline-offset: 3px; overflow-wrap: anywhere; }
.mailboxes-mobile { display: grid; gap: 10px; }
dd { margin-left: 0; overflow-wrap: anywhere; }
</style>
