<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EmployeeDataReview } from '@/api/employee-archives.api';
import { applicationProgress, applicationType } from '@/utils/employee-lifecycle';
import { formatDate, formatDateTime } from '@/utils/date';

const props = defineProps<{ requests: EmployeeDataReview[] }>();
const filter = ref('all');
const types = computed(() => [...new Set(props.requests.map(applicationType))]);
const items = computed(() => props.requests.filter((item) => filter.value === 'all' || applicationType(item) === filter.value)
  .slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
const fields: Record<string, string> = { name: '姓名', phone: '手机号', company: '所属公司', deptId: '部门', position: '岗位', jobGrade: '职级', jobFamily: '职系', workLocation: '工作地点', employeeStatus: '任职状态', employmentType: '用工类型', entryDate: '入职日期', effectiveFrom: '生效日期', effectiveDate: '生效日期', effectiveTo: '结束日期', leaveDate: '最后工作日', reason: '原因', managerId: '直属上级', probationMonths: '试用期（月）', plannedRegularDate: '预计转正日期', actualRegularDate: '实际转正日期', gender: '性别', birthDate: '出生日期', ethnicity: '民族', education: '学历', professionalTitle: '职称', school: '毕业院校', graduationDate: '毕业日期', major: '专业', maritalStatus: '婚姻状况', childrenStatus: '子女状况', childrenCount: '子女数量', politicalStatus: '政治面貌', nativePlace: '籍贯', householdType: '户籍类型', idAddress: '身份证地址', currentAddress: '住址', emergencyContactName: '紧急联系人', emergencyContactRelation: '与联系人关系', emergencyContactPhone: '紧急联系电话', socialSecurityStatus: '社保状态', socialSecurityStartDate: '社保起始日期', housingFundStatus: '公积金状态', housingFundStartDate: '公积金起始日期', bankName: '开户行', bankBranch: '开户支行', idNumberConfigured: '身份证', bankAccountConfigured: '银行卡' };
function changes(request: EmployeeDataReview) {
  return ['employee', 'profile', 'performance'].flatMap((section) => {
    const before = request.baseValue?.[section] ?? {};
    const after = request.proposedValue?.[section] ?? {};
    return Object.keys(fields).filter((key) => key in after && JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
      .map((key) => ({ key: `${section}.${key}`, label: section === 'performance' && key === 'managerId' ? '绩效直属上级' : fields[key], before: display(key, before[key], before), after: display(key, after[key], after) }));
  });
}
function display(key: string, value: unknown, source: Record<string, any>) {
  if (value == null || value === '') return '未填写';
  if (key.endsWith('Configured')) return value ? '已保存' : '未填写';
  if (key === 'deptId') return source.departmentName || source.deptName || '已设置（历史名称未记录）';
  if (key === 'managerId') return source.managerName || '已设置（历史姓名未记录）';
  if (key.endsWith('Id')) return '已设置';
  if (key === 'phone' || key === 'emergencyContactPhone') return '已保存';
  if (key === 'employeeStatus') return ({ active: '在职', probation: '试用期', pending_entry: '待入职', resigned: '已离职' } as Record<string, string>)[String(value)] ?? String(value);
  if (key === 'company') return ({ fuede: '孚德', fuede_sports: '孚德体育文化', beijing_fuede: '北京孚德', fansibao: '凡思堡' } as Record<string, string>)[String(value)] ?? String(value);
  if (key === 'employmentType') return ({ full_time: '全职', part_time: '兼职', rehire: '返聘', external: '外部' } as Record<string, string>)[String(value)] ?? String(value);
  return String(value);
}
function contractChanges(request: EmployeeDataReview) {
  const before = request.baseValue?.contracts;
  const after = request.proposedValue?.contracts;
  if (!Array.isArray(after)) return [];
  const originals: Record<string, any>[] = Array.isArray(before) ? before : [];
  const labels: Record<string, string> = { name: '名称', contractType: '类型', signingCompany: '签约公司', signedAt: '签订日期', effectiveFrom: '生效日期', expiresAt: '到期日期', termType: '期限', originalCompany: '原公司', newCompany: '新公司', confidentialityAgreement: '保密协议', nonCompeteAgreement: '竞业协议', portraitAgreement: '肖像协议' };
  const result: Array<{ key: string; label: string; before: string; after: string }> = [];
  after.forEach((contract: Record<string, any>, index: number) => {
    const old = contract.id ? originals.find((item) => item.id === contract.id) : undefined;
    const title = String(contract.name || `合同 ${index + 1}`);
    if (!old) { result.push({ key: `contract-${index}`, label: '新增合同', before: '无', after: title }); return; }
    Object.entries(labels).forEach(([key, label]) => {
      if (JSON.stringify(old[key] ?? null) !== JSON.stringify(contract[key] ?? null)) result.push({ key: `contract-${index}-${key}`, label: `${title} · ${label}`, before: String(old[key] || '未填写'), after: String(contract[key] || '未填写') });
    });
    for (const key of ['images', 'attachments']) {
      if (JSON.stringify(old[key] ?? []) !== JSON.stringify(contract[key] ?? [])) result.push({ key: `contract-${index}-${key}`, label: `${title} · ${key === 'images' ? '图片' : '附件'}`, before: `${old[key]?.length ?? 0} 份`, after: `${contract[key]?.length ?? 0} 份` });
    }
  });
  originals.filter((old) => !after.some((item: Record<string, any>) => item.id === old.id)).forEach((old, index) => result.push({ key: `removed-contract-${index}`, label: '移除合同', before: String(old.name || '未命名合同'), after: '已移除' }));
  return result;
}
function eventLabel(action: string) {
  if (/reject/.test(action)) return '退回';
  if (/cancel|withdraw/.test(action)) return '取消 / 撤回';
  if (/approve|review/.test(action)) return '审核';
  if (/effective|activate/.test(action)) return '生效';
  if (/restore|unarchive/.test(action)) return '取消归档';
  if (/submit/.test(action)) return '提交';
  if (/^archive_/.test(action)) return '归档';
  if (/revise/.test(action)) return '修改并重新提交';
  if (/draft/.test(action)) return '保存草稿';
  return '记录更新';
}
</script>

<template>
  <section class="change-history">
    <el-select v-model="filter" aria-label="变更类型" class="history-filter"><el-option label="全部变更" value="all" /><el-option v-for="type in types" :key="type" :label="type" :value="type" /></el-select>
    <el-empty v-if="!items.length" description="暂无变更记录" :image-size="64" />
    <el-collapse v-else>
      <el-collapse-item v-for="request in items" :key="request.id" :name="request.id">
        <template #title><div class="history-title"><strong>{{ applicationType(request) }}</strong><span>{{ formatDate(request.proposedValue?.employee?.effectiveDate || request.proposedValue?.employee?.effectiveFrom || request.proposedValue?.employee?.leaveDate || request.createdAt) }}</span><el-tag size="small" effect="plain">{{ applicationProgress(request) }}</el-tag></div></template>
        <p>{{ request.createdBy?.name || '历史导入' }} · {{ formatDateTime(request.createdAt) }}</p>
        <el-alert v-if="request.rejectedReason" :title="`退回原因：${request.rejectedReason}`" type="warning" :closable="false" />
        <div v-for="change in changes(request)" :key="change.key" class="history-diff"><strong>{{ change.label }}</strong><span>{{ change.before }} → {{ change.after }}</span></div>
        <div v-for="change in contractChanges(request)" :key="change.key" class="history-diff"><strong>{{ change.label }}</strong><span>{{ change.before }} → {{ change.after }}</span></div>
        <el-timeline class="history-events">
          <el-timeline-item v-if="!request.events?.length" :timestamp="formatDateTime(request.createdAt)">提交 · {{ request.createdBy?.name || '历史导入' }}</el-timeline-item>
          <el-timeline-item v-if="!request.events?.length && request.profileReviewedAt" :timestamp="formatDateTime(request.profileReviewedAt)">基础档案{{ request.profileReviewStatus === 'approved' ? '通过' : '退回' }} · {{ request.profileReviewedBy?.name || 'HR 管理员' }}</el-timeline-item>
          <el-timeline-item v-if="!request.events?.length && request.performanceReviewedAt" :timestamp="formatDateTime(request.performanceReviewedAt)">绩效关系{{ request.performanceReviewStatus === 'approved' ? '通过' : '退回' }} · {{ request.performanceReviewedBy?.name || 'HR 管理员' }}</el-timeline-item>
          <el-timeline-item v-for="event in request.events ?? []" :key="event.id" :timestamp="formatDateTime(event.createdAt)">{{ eventLabel(event.action) }} · {{ event.user?.name || '系统' }}</el-timeline-item>
        </el-timeline>
      </el-collapse-item>
    </el-collapse>
  </section>
</template>

<style scoped>
.history-filter { max-width: 220px; margin-bottom: 16px; }.history-title { display:flex; flex-wrap:wrap; gap:12px; align-items:center; line-height:1.6; padding:10px 0; }.history-title span,p { color:#667085; }.history-diff { display:grid; grid-template-columns:120px minmax(0,1fr); gap:12px; border-bottom:1px solid #eef1f6; padding:8px 0; overflow-wrap:anywhere; }.history-events { margin-top:18px; }.change-history :deep(.el-collapse-item__header) { height:auto; min-height:48px; } @media(max-width:640px) { .history-diff { grid-template-columns:90px minmax(0,1fr); } }
</style>
