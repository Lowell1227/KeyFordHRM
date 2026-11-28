<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth.store';
import { getConfigurationStatus, type ConfigurationStatus } from '@/api/system-configuration.api';
import ConfigurationLink from '@/components/common/ConfigurationLink.vue';
import { configurationTargets, isConfigurationTarget, type ConfigurationTarget } from '@/router/configuration-targets';

const groups = [
  { name: 'AI 服务', ids: ['ai-resume', 'ai-progress-kimi', 'ai-progress-deepseek', 'ai-progress-qwen'] },
  { name: '钉钉集成', ids: ['dingtalk-login', 'dingtalk-notifications', 'dingtalk-calendar', 'recruitment-demand', 'payroll-attendance'] },
  { name: '招聘和薪酬', ids: ['recruitment-mail', 'payroll-access'] },
] satisfies { name: string; ids: ConfigurationTarget[] }[];
const fieldLabels = { present: '已填写', missing: '未填写', unknown: '待核实', managed: '系统内置' };
const verificationLabels = { unknown: '无验证记录', untested: '未验证', passed: '验证通过', failed: '验证失败' };
const auth = useAuthStore();
const route = useRoute();
const isAdmin = computed(() => auth.user?.sysRole === 'system_admin');
const selected = computed(() => isConfigurationTarget(route.query.configuration) ? route.query.configuration : null);
const filter = ref<'pending' | 'all'>('all');
const rows = ref<ConfigurationStatus[]>([]);
const loading = ref(false);
const failed = ref(false);
const isIncomplete = (row: ConfigurationStatus) => row.fields.some(field => field.state === 'missing');
const needsAttention = (row: ConfigurationStatus) => isIncomplete(row) || row.fields.some(field => field.state === 'unknown')
  || row.verification === 'unknown' || row.verification === 'failed' || row.verification === 'untested';
const incomplete = computed(() => rows.value.filter(isIncomplete).length);
const pending = computed(() => rows.value.filter(needsAttention).length);
const display = computed(() => loading.value || failed.value ? [] : groups.map(group => ({
  name: group.name,
  rows: group.ids.flatMap(id => {
    const row = rows.value.find(item => item.id === id);
    if (!row || (filter.value === 'pending' && id !== selected.value && !needsAttention(row))) return [];
    return [{ ...row, id, name: configurationTargets[id].name }];
  }),
})).filter(group => group.rows.length));
const timestamp = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });

function focusSetting() {
  if (!selected.value) return;
  void nextTick(() => document.getElementById('config-' + selected.value)?.scrollIntoView({ block: 'nearest' }));
}

async function load() {
  if (!isAdmin.value || loading.value) return;
  loading.value = true;
  failed.value = false;
  try {
    rows.value = await getConfigurationStatus();
  } catch {
    rows.value = [];
    failed.value = true;
  } finally {
    loading.value = false;
  }
  focusSetting();
}

onMounted(load);
watch(selected, focusSetting);
</script>

<template>
  <section class="configuration-overview" aria-label="配置总览">
    <header class="configuration-heading">
      <div>
        <h2>配置总览</h2>
        <p v-if="isAdmin && !loading && !failed" role="status">缺少必填项 {{ incomplete }} 项 · 待处理 {{ pending }} 项</p>
        <p v-else-if="!isAdmin">集成凭据和验证状态由系统管理员查看。</p>
      </div>
      <button v-if="isAdmin" type="button" class="configuration-refresh" :disabled="loading" @click="load">刷新状态</button>
    </header>
    <template v-if="isAdmin">
      <div class="configuration-filter" aria-label="配置项目范围">
        <button type="button" :aria-pressed="filter === 'all'" @click="filter = 'all'">全部</button>
        <button type="button" :aria-pressed="filter === 'pending'" @click="filter = 'pending'">待处理</button>
      </div>
      <p v-if="loading" class="configuration-message" role="status">正在读取配置状态</p>
      <p v-else-if="failed" class="configuration-message" role="alert">暂时无法读取配置状态，请刷新重试。</p>
      <p v-else-if="!display.length" class="configuration-message" role="status">没有缺项或待验证的配置。</p>
      <section v-for="group in display" :key="group.name" class="configuration-group" :aria-label="group.name">
        <h3>{{ group.name }}</h3>
        <div class="configuration-columns" aria-hidden="true">
          <span>配置项目</span><span>已填写与保存</span><span>连接验证 / 配置核验</span><span>业务启用与就绪</span><span>操作</span>
        </div>
        <article v-for="row in group.rows" :id="'config-' + row.id" :key="row.id" class="configuration-row" :class="{ 'is-selected': row.id === selected }">
          <strong>{{ row.name }}</strong>
          <ul class="configuration-fields" aria-label="已填写情况">
            <li v-for="field in row.fields" :key="field.label" :class="'field-' + field.state">{{ field.label }}：{{ fieldLabels[field.state] }}</li>
            <li v-if="!row.fields.length">按发薪主体授权</li>
            <li v-if="row.revision !== undefined">已保存：{{ row.revision ? '版本 ' + row.revision : '未保存系统内配置' }}</li>
            <li v-if="row.appliedRevision !== undefined">已应用：{{ row.appliedRevision ? '版本 ' + row.appliedRevision : '未应用系统内配置' }}</li>
          </ul>
          <div class="configuration-verification" :class="'verification-' + row.verification" :title="row.verificationMessage || undefined">
            <small v-if="row.testKind === 'configuration'">配置核验：</small>
            {{ verificationLabels[row.verification] }}
            <time v-if="row.verifiedAt" :datetime="row.verifiedAt">{{ timestamp.format(new Date(row.verifiedAt)) }}</time>
          </div>
          <div><span>{{ row.enabled === null ? '未提供业务开关' : row.enabled ? '开关已启用' : '开关未启用' }}</span>
            <small v-if="row.ready !== undefined" class="configuration-ready">{{ row.ready ? '配置已就绪' : '配置未就绪' }}</small>
          </div>
          <ConfigurationLink :setting="row.id" />
        </article>
      </section>
    </template>
  </section>
</template>

<style scoped>
.configuration-overview { margin: 16px 0; border: 1px solid var(--el-border-color-light); border-radius: 8px; overflow: hidden; background: var(--el-bg-color); }
.configuration-heading { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 16px; }
.configuration-heading h2 { margin: 0; font-size: 17px; }
.configuration-heading p { margin: 6px 0 0; color: var(--el-text-color-secondary); font-size: 13px; }
.configuration-refresh, .configuration-filter button { min-height: 32px; border: 1px solid var(--el-border-color); background: var(--el-bg-color); border-radius: 5px; padding: 3px 10px; color: var(--el-text-color-primary); cursor: pointer; }
.configuration-refresh:disabled { cursor: default; opacity: .6; }
.configuration-filter { display: flex; gap: 6px; padding: 0 16px 12px; }
.configuration-filter button[aria-pressed="true"] { color: var(--el-color-primary-dark-2); border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.configuration-message { margin: 0; padding: 16px; }
.configuration-group { padding: 0 16px 12px; }
.configuration-group h3 { margin: 8px 0; font-size: 14px; }
.configuration-columns, .configuration-row { display: grid; grid-template-columns: minmax(115px, 1fr) minmax(170px, 2fr) minmax(86px, .9fr) minmax(84px, .8fr) minmax(85px, .75fr); align-items: start; gap: 8px; padding: 10px 8px; }
.configuration-columns { color: var(--el-text-color-secondary); font-size: 12px; background: var(--el-fill-color-light); }
.configuration-row { border-bottom: 1px solid var(--el-border-color-lighter); font-size: 13px; overflow-wrap: anywhere; scroll-margin-block: 18px; }
.configuration-row.is-selected { background: var(--el-color-primary-light-9); }
.configuration-fields { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 0; padding: 0; list-style: none; color: var(--el-text-color-regular); }
.field-missing, .verification-failed { color: var(--el-color-danger-dark-2); }
.field-unknown { color: var(--el-text-color-secondary); }
.verification-passed { color: var(--el-color-success-dark-2); }
time { display: block; font-size: 11px; color: var(--el-text-color-secondary); }
.configuration-ready { display: block; margin-top: 4px; color: var(--el-text-color-secondary); }
@media (max-width: 870px) {
  .configuration-columns { display: none; }
  .configuration-row { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 12px 6px; }
  .configuration-row strong, .configuration-fields { grid-column: 1 / -1; }
}
</style>
