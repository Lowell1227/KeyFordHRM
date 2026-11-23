<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import { useAuthStore } from '@/stores/auth.store';
import { payrollApi, payrollError } from '@/api/payroll.api';
import type { PayrollParameterRelease } from '@/types/payroll.types';
import PayrollScope from './PayrollScope.vue';
import { usePayrollScope } from './usePayrollScope';
import PayrollDeductionSettingsForm from './PayrollDeductionSettingsForm.vue';
import { attendanceTypeLabels } from './payroll-attendance-mappings';

const auth = useAuthStore();
const route = useRoute(), router = useRouter();
const { subjects, subjectId, month, error, loading, refreshAccess } = usePayrollScope(['payroll_edit', 'payroll_parameter_review']);
const entries = ref<PayrollParameterRelease[]>([]), selected = ref<PayrollParameterRelease>();
const mode = ref('pending'), note = ref(''), fieldError = ref(''), actionError = ref(''), busy = ref(false);
const labels = { pending: '待主管审核', approved: '已发布', returned: '已退回', withdrawn: '已撤回' };
const rows = computed(() => entries.value.filter(row => mode.value === 'all' || row.status === 'pending'));
const mayDecide = computed(() => selected.value?.status === 'pending' && selected.value.reviewerId === auth.user?.id);
const mayWithdraw = computed(() => selected.value?.status === 'pending' && selected.value.submittedById === auth.user?.id);
const title = (value: unknown) => { const row = value as PayrollParameterRelease; return `${row.kind === 'standard' ? row.standard?.employee.name ?? '工资标准' : row.kind === 'deduction' ? `${row.deduction?.employee.name ?? '员工'} 扣缴资料` : '工资规则'} · V${row.parameterVersion}`; };
let sequence = 0;
async function load() {
  const request = ++sequence; entries.value = [];
  if (!subjectId.value) return;
  loading.value = true; error.value = '';
  try { const result = await payrollApi.parameterReleases(subjectId.value); if (request === sequence) { entries.value = result; resolveSelection(); } }
  catch (cause) { if (request === sequence) error.value = await payrollError(cause); }
  finally { if (request === sequence) loading.value = false; }
}
async function refresh() { const before = subjectId.value; await refreshAccess(); if (before === subjectId.value) await load(); }
watch(subjectId, () => { if (!selected.value) void load(); }); onMounted(refresh);
function resolveSelection() { selected.value = entries.value.find(row => row.id === route.query.releaseId); }
watch(() => route.query.releaseId, () => { resolveSelection(); note.value = ''; fieldError.value = ''; actionError.value = ''; });
function view(value: unknown) { void router.push({ query: { ...route.query, subjectId: subjectId.value, releaseId: (value as PayrollParameterRelease).id } }); }
async function mayClose() {
  if (busy.value) return false;
  if (!note.value.trim()) return true;
  try { await ElMessageBox.confirm('放弃尚未提交的办理意见？', '离开审核', { confirmButtonText: '放弃修改', cancelButtonText: '继续办理' }); return true; }
  catch { return false; }
}
async function close(value: boolean) { if (!value && await mayClose()) { note.value = ''; const { releaseId: _, ...query } = route.query; await router.push({ query }); } }
onBeforeRouteLeave(mayClose);
onBeforeRouteUpdate(async (to, from) => to.query.releaseId === from.query.releaseId || await mayClose());
function beforeClose() { void close(false); }
async function decide(action: 'approve' | 'return' | 'withdraw') {
  const row = selected.value; if (!row || busy.value) return;
  fieldError.value = ''; actionError.value = '';
  if (action !== 'approve' && !note.value.trim()) { fieldError.value = '请填写办理原因'; return; }
  busy.value = true;
  try {
    selected.value = action === 'withdraw' ? await payrollApi.withdrawParameter(row.id, row.attempt, note.value.trim())
      : await payrollApi.decideParameter(row.id, row.attempt, action, note.value.trim());
    note.value = ''; await load();
  } catch (cause) { actionError.value = await payrollError(cause); }
  finally { busy.value = false; }
}
const workdays = (days: Array<{ units: string }>) => days.reduce((total, day) => total + Math.round(Number(day.units) * 10000), 0) / 10000;
function manualEmployeeLabel(id: string) {
  const person = selected.value?.manualEmployees?.find(employee => employee.id === id);
  return person ? `${person.name}${person.employeeNo ? ` · ${person.employeeNo}` : ''}` : `记录不可用（${id.slice(-8)}）`;
}
function scopeEmployeeLabel(id: string) {
  const person = selected.value?.scopeEmployees?.find(employee => employee.id === id);
  return person ? `${person.name}${person.employeeNo ? ` · ${person.employeeNo}` : ''}` : `记录不可用（${id.slice(-8)}）`;
}
const time = (value?: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '';
</script>
<template>
  <BusinessListPage variant="workflow" :loading="loading">
    <template #filters>
      <PayrollScope v-model:subject="subjectId" v-model:month="month" :subjects="subjects" hide-month :disabled="busy || !!selected" @refresh="refresh">
        <el-segmented v-model="mode" :options="[{label:'待处理',value:'pending'},{label:'近期记录',value:'all'}]" />
      </PayrollScope>
    </template>
    <template #feedback><el-alert v-if="error" :title="error" type="error" :closable="false" /></template>
    <template #desktop-list>
      <el-table :data="rows" height="100%" empty-text="暂无参数审核记录">
        <el-table-column label="参数版本" min-width="180"><template #default="{row}">{{ title(row) }}</template></el-table-column>
        <el-table-column label="生效日期" width="120"><template #default="{row}">{{ row.snapshot.effectiveFrom }}</template></el-table-column>
        <el-table-column label="提交人" min-width="110"><template #default="{row}">{{ row.submittedBy.name }}</template></el-table-column>
        <el-table-column label="直属主管" min-width="110"><template #default="{row}">{{ row.reviewer.name }}</template></el-table-column>
        <el-table-column label="状态" min-width="120"><template #default="{row}">{{ labels[row.status as keyof typeof labels] }}</template></el-table-column>
        <el-table-column label="操作" width="100" fixed="right"><template #default="{row}"><el-button link type="primary" @click="view(row)">{{ row.status === 'pending' && row.reviewerId === auth.user?.id ? '审核' : '查看' }}</el-button></template></el-table-column>
      </el-table>
    </template>
    <template #mobile-list>
      <MobileResultCard v-for="row in rows" :key="row.id"><template #title>{{ title(row) }}</template><template #status>{{ labels[row.status] }}</template>
        <div>{{ row.snapshot.effectiveFrom }} 起生效</div><div>提交：{{ row.submittedBy.name }}</div><div>主管：{{ row.reviewer.name }}</div>
        <template #actions><el-button link type="primary" @click="view(row)">{{ row.status === 'pending' && row.reviewerId === auth.user?.id ? '审核' : '查看' }}</el-button></template>
      </MobileResultCard>
      <el-empty v-if="!rows.length" description="暂无参数审核记录" />
    </template>
    <template #detail>
      <BusinessDetailDrawer :model-value="!!selected" title="参数审核" variant="standard" :saving="busy" :before-close="beforeClose" @update:model-value="close">
        <template v-if="selected">
          <h3>{{ title(selected) }}</h3>
          <dl class="parameter-grid"><div><dt>状态</dt><dd>{{ labels[selected.status] }}</dd></div><div><dt>生效日期</dt><dd>{{ selected.snapshot.effectiveFrom }}</dd></div><div><dt>结束日期</dt><dd>{{ selected.snapshot.effectiveTo ?? '长期' }}</dd></div><div><dt>替代版本</dt><dd>{{ selected.previousParameterId ? '替代前一已发布版本' : '首次发布' }}</dd></div></dl>
          <dl v-if="selected.kind === 'standard'" class="parameter-grid">
            <div><dt>固定月薪</dt><dd>{{ selected.snapshot.fixedMonthly ?? '待配置' }}</dd></div><div><dt>个人绩效基数</dt><dd>{{ selected.snapshot.performanceBase ?? '未配置（人工金额不使用）' }}</dd></div>
            <div><dt>绩效结构</dt><dd>{{ selected.snapshot.performanceMode === 'additional' ? '固定月薪之外另计' : '不适用' }}</dd></div><div><dt>确认依据</dt><dd>{{ selected.snapshot.evidence }}</dd></div>
          </dl>
          <template v-if="selected.snapshot.config">
            <section v-if="selected.snapshot.config.employeeScope" class="parameter-section">
              <h4>发薪人员 · {{ selected.snapshot.config.employeeScope.employeeIds.length }}人</h4>
              <p>{{ selected.snapshot.config.employeeScope.evidenceRef }}</p>
              <p>{{ selected.snapshot.config.employeeScope.employeeIds.map(scopeEmployeeLabel).join('、') }}</p>
            </section>
            <section v-if="Object.keys(selected.snapshot.config.attendanceMappings ?? {}).length" class="parameter-section">
              <h4>钉钉假勤分类</h4><dl class="manual-amounts"><div v-for="(mapping, key) in selected.snapshot.config.attendanceMappings" :key="key"><dt>{{ key }}</dt><dd>{{ attendanceTypeLabels[mapping.type] }}{{ mapping.overtimeKind ? ` · ${{ weekday: '工作日', restday: '休息日', holiday: '节假日' }[mapping.overtimeKind]}` : '' }}</dd></div></dl>
            </section>
            <section v-for="(calendar, key) in selected.snapshot.config.workCalendars" :key="key" class="parameter-section">
              <h4>{{ key }} 工作日日历 · {{ workdays(calendar.days) }}天</h4><p>{{ calendar.sourceVersion }} · {{ calendar.evidenceRef }}</p>
              <p>应出勤：{{ calendar.days.filter(day => Number(day.units) > 0).map(day => `${day.workDate.slice(-2)}日${day.units !== '1' ? `(${day.units})` : ''}`).join('、') }}</p>
            </section>
            <section v-for="(mapping, key) in selected.snapshot.config.performance" :key="key" class="parameter-section">
              <template v-if="mapping.sourceKind === 'manual'">
                <h4>{{ key }} 绩效工资</h4><p>确认依据：{{ mapping.evidenceRef }}</p>
                <dl class="manual-amounts" data-testid="payroll-manual-review">
                  <div v-for="(amount, employeeId) in mapping.manualAmounts" :key="employeeId"><dt>{{ manualEmployeeLabel(employeeId) }}</dt><dd>{{ amount }} 元</dd></div>
                </dl>
                <p v-if="!Object.keys(mapping.manualAmounts ?? {}).length">金额待确认</p>
              </template>
              <template v-else>
                <h4>{{ key }} 绩效系数</h4><p>{{ mapping.coefficientVersion }} · {{ mapping.evidenceRef }}</p>
                <dl class="parameter-grid"><div v-for="(value, grade) in mapping.coefficients" :key="grade"><dt>{{ grade }}等</dt><dd>{{ value }}</dd></div></dl>
              </template>
            </section>
            <el-collapse><el-collapse-item title="完整参数" name="parameters"><pre>{{ JSON.stringify(selected.snapshot.config, null, 2) }}</pre></el-collapse-item></el-collapse>
          </template>
          <template v-if="selected.snapshot.settings"><h4>发薪日：{{selected.snapshot.payDate}}</h4><PayrollDeductionSettingsForm :model-value="selected.snapshot.settings" disabled/></template>
          <h4>办理记录</h4>
          <el-timeline><el-timeline-item :timestamp="time(selected.submittedAt)">{{ selected.submittedBy.name }} · 提交主管审核</el-timeline-item><el-timeline-item v-if="selected.decidedAt" :timestamp="time(selected.decidedAt)">{{ selected.status === 'withdrawn' ? selected.submittedBy.name : selected.reviewer.name }} · {{ labels[selected.status] }}<p v-if="selected.note">{{ selected.note }}</p></el-timeline-item></el-timeline>
          <el-form v-if="mayDecide || mayWithdraw" label-position="top" class="action-panel">
            <el-form-item label="办理意见" :error="fieldError"><el-input v-model="note" type="textarea" :rows="3" maxlength="500" :disabled="busy" /></el-form-item>
            <el-alert v-if="actionError" :title="actionError" type="error" :closable="false" />
          </el-form>
        </template>
        <template #footer>
          <el-button :disabled="busy" @click="close(false)">关闭</el-button>
          <el-button v-if="mayWithdraw" :loading="busy" @click="decide('withdraw')">撤回申请</el-button>
          <el-button v-if="mayDecide" :disabled="busy" @click="decide('return')">退回修改</el-button>
          <el-button v-if="mayDecide" type="primary" :loading="busy" @click="decide('approve')">审核并发布</el-button>
        </template>
      </BusinessDetailDrawer>
    </template>
  </BusinessListPage>
</template>
<style scoped>
h3 { font-size: 18px; margin: 0 0 18px; }
h4 { font-size: 15px; margin: 18px 0 10px; }
.parameter-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 14px; margin: 0 0 20px; }
.parameter-grid dt { color: var(--el-text-color-secondary); font-size: 13px; }
.parameter-grid dd { margin: 5px 0 0; overflow-wrap: anywhere; font-size: 14px; }
.parameter-section { border-top: 1px solid var(--el-border-color-lighter); padding-bottom: 12px; }
.parameter-section p, .el-timeline p { font-size: 14px; overflow-wrap: anywhere; line-height: 1.7; }
.manual-amounts { margin: 0 0 14px; font-size: 14px; }
.manual-amounts > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.manual-amounts dt { overflow-wrap: anywhere; }
.manual-amounts dd { margin: 0; font-variant-numeric: tabular-nums; }
.action-panel { border-top: 1px solid var(--el-border-color-lighter); padding-top: 16px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
@media(max-width:480px) { .parameter-grid { gap: 14px 12px; } }
</style>
