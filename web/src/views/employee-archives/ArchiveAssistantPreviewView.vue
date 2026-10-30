<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { archiveAssistantApi, previewStorageKey, type ArchiveAssistantPreview, type ArchiveAssistantSaved } from '@/api/archive-assistant.api';
const route = useRoute();
const preview = ref<ArchiveAssistantPreview | null>(null);
const saved = ref<ArchiveAssistantSaved | null>(null);
const loading = ref(false), saving = ref(false), error = ref(''), blocked = ref(false);
let generation = 0;
let loadedToken = '';
const reference = () => String(route.params.sourceReference ?? '');
const current = (id: string, version: number) => id === reference() && generation === version;
const savedUrl = computed(() => saved.value ? `/users?assistantRequestId=${encodeURIComponent(saved.value.requestId)}` : '');
function report(reason: unknown, writing: boolean) {
  const status = (reason as { response?: { status?: number } })?.response?.status;
  blocked.value = true;
  error.value = status === 403 ? '当前账号或试用权限不可用，请核对本人账号及钉钉绑定。'
    : status === 400 ? '预览已失效，请在钉钉重新发送“档案测试”。'
    : status === 409 ? '资料已变化，请重新核对预览或进入原记录查看。'
    : writing ? '保存结果暂无法确认，请重新读取核对，勿重复保存。'
    : '预览暂时无法读取，请重新读取或在钉钉重新获取。';
}
async function load() {
  const id = reference(), version = ++generation;
  preview.value = null; saved.value = null; error.value = ''; loadedToken = '';
  blocked.value = false; loading.value = true; saving.value = false;
  try {
    const token = /^[a-f0-9]{64}$/.test(id) ? sessionStorage.getItem(previewStorageKey(id)) : null;
    if (!token) { blocked.value = true; error.value = '预览已失效，请在钉钉重新发送“档案测试”。'; return; }
    const result = await archiveAssistantApi.preview(token);
    if (!current(id, version)) return;
    preview.value = result; saved.value = result.saved; loadedToken = token;
  } catch (reason) { if (current(id, version)) report(reason, false); }
  finally { if (current(id, version)) loading.value = false; }
}
async function save() {
  if (!preview.value || saved.value || loading.value || saving.value || blocked.value || !loadedToken) return;
  if (Date.parse(preview.value.expiresAt) <= Date.now()) { report({ response: { status: 400 } }, true); return; }
  const id = reference(), version = generation, token = loadedToken;
  saving.value = true; error.value = '';
  try {
    const result = await archiveAssistantApi.save(token);
    if (current(id, version)) saved.value = result;
  } catch (reason) { if (current(id, version)) report(reason, true); }
  finally { if (current(id, version)) saving.value = false; }
}
watch(() => route.params.sourceReference, load, { immediate: true });
onBeforeUnmount(() => { generation++; });
</script>
<template>
  <section class="archive-preview" aria-label="档案助手预览" v-loading="loading">
    <h1>档案资料预览 <el-tag type="warning">虚构测试资料</el-tag></h1>
    <p class="source">来源：HR 提供的测试资料，未经 OA 核实。未绑定真实员工，不生成账号或工号。</p>
    <div v-if="error" class="feedback" role="alert">
      <p>{{ error }}</p><el-button :disabled="loading || saving" @click="load">重新读取</el-button>
    </div>
    <template v-if="preview">
      <dl><dt>姓名</dt><dd>{{ preview.employeeName }}</dd><dt>工作地点</dt><dd>{{ preview.workLocation }}</dd></dl>
      <p v-if="!saved">{{ preview.notice }}</p>
      <div v-if="saved" role="status" class="saved">
        <p>{{ saved.replayed ? '该资料已接收，本次未重复保存，请查看原记录当前状态' : '已保存待核草稿，正式档案未改变' }}</p>
        <p>{{ saved.replayed ? '完整状态请查看原记录' : '记录状态：待核草稿' }} · 版本 {{ saved.requestVersion }}</p>
        <RouterLink :to="savedUrl">{{ saved.replayed ? '打开原记录' : '打开草稿' }}</RouterLink>
      </div>
      <template v-else>
        <p class="source">测试资料仅可保存待核草稿，不能提交或审批。需要维护时进入现有人员档案。</p>
        <el-button type="primary" :loading="saving" :disabled="loading || saving || blocked" @click="save">保存待核草稿</el-button>
      </template>
    </template>
  </section>
</template>
<style scoped>
.archive-preview { max-width: 720px; margin: 0 auto; overflow-wrap: anywhere; }
h1 { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; font-size: 20px; margin: 0 0 16px; }
p { line-height: 1.7; }
.source { color: var(--el-text-color-secondary); font-size: 14px; }
dl { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 16px; padding: 20px 0; border-block: 1px solid var(--el-border-color-light); }
dt { color: var(--el-text-color-secondary); } dd { margin: 0; }
.feedback, .saved { padding: 12px; margin: 16px 0; background: var(--el-fill-color-light); border-radius: 4px; }
a { color: var(--el-color-primary); }
@media(max-width: 600px) { .archive-preview > .el-button { width: 100%; min-height: 42px; } }
</style>
