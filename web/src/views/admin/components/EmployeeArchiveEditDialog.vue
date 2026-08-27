<script setup lang="ts">
import { reactive, watch } from 'vue';
import { Delete, Plus } from '@element-plus/icons-vue';
import type { Department } from '@/types/api.types';
import type { EmployeeArchive } from '@/api/employee-archives.api';
import UserSelect from '@/components/common/UserSelect.vue';

const props = defineProps<{
  modelValue: boolean;
  archive: EmployeeArchive | null;
  departments: Department[];
  saving: boolean;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  submit: [value: { employee: Record<string, unknown>; profile: Record<string, unknown>; contracts: Record<string, unknown>[]; performance: Record<string, unknown> }];
}>();

const form = reactive({
  employee: {} as Record<string, any>,
  profile: {} as Record<string, any>,
  contracts: [] as Record<string, any>[],
  performance: {} as Record<string, any>,
});

function dateValue(value?: string | null) {
  return value ? value.slice(0, 10) : null;
}

function reset() {
  const archive = props.archive;
  if (!archive) return;
  const employment = archive.currentEmployment ?? archive.employmentHistory[0];
  Object.assign(form.employee, {
    name: archive.name,
    employeeNo: archive.employeeNo,
    phone: archive.employeeProfile?.phone ?? null,
    company: employment?.company ?? archive.dept?.company ?? 'fuede',
    deptId: archive.dept?.id ?? null,
    position: archive.position,
    jobGrade: employment?.jobGrade ?? null,
    jobFamily: employment?.jobFamily ?? null,
    managerId: archive.rosterManager?.id ?? null,
    workLocation: employment?.workLocation ?? null,
    employmentType: employment?.employmentType ?? 'full_time',
    employeeStatus: archive.status,
    entryDate: dateValue(archive.entryDate),
    plannedRegularDate: dateValue(employment?.plannedRegularDate),
    actualRegularDate: dateValue(employment?.actualRegularDate),
    leaveDate: dateValue(employment?.leaveDate),
    probationMonths: employment?.probationMonths ?? null,
  });
  Object.assign(form.performance, {
    managerId: archive.performanceManager?.id ?? null,
  });
  const profile = archive.employeeProfile ?? ({} as EmployeeArchive['employeeProfile']);
  Object.assign(form.profile, {
    phone: profile?.phone ?? null,
    gender: profile?.gender ?? null,
    birthDate: dateValue(profile?.birthDate),
    ethnicity: profile?.ethnicity ?? null,
    education: profile?.education ?? null,
    professionalTitle: profile?.professionalTitle ?? null,
    school: profile?.school ?? null,
    graduationDate: dateValue(profile?.graduationDate),
    major: profile?.major ?? null,
    maritalStatus: profile?.maritalStatus ?? null,
    childrenStatus: profile?.childrenStatus ?? null,
    childrenCount: profile?.childrenCount ?? null,
    politicalStatus: profile?.politicalStatus ?? null,
    nativePlace: profile?.nativePlace ?? null,
    householdType: profile?.householdType ?? null,
    idAddress: profile?.idAddress ?? null,
    idNumber: '',
    currentAddress: profile?.currentAddress ?? null,
    emergencyContactName: profile?.emergencyContactName ?? null,
    emergencyContactRelation: profile?.emergencyContactRelation ?? null,
    emergencyContactPhone: profile?.emergencyContactPhone ?? null,
    socialSecurityStatus: profile?.socialSecurityStatus ?? null,
    socialSecurityStartDate: dateValue(profile?.socialSecurityStartDate),
    housingFundStatus: profile?.housingFundStatus ?? null,
    housingFundStartDate: dateValue(profile?.housingFundStartDate),
    bankName: profile?.bankName ?? null,
    bankBranch: profile?.bankBranch ?? null,
    bankAccount: '',
  });
  form.contracts = archive.employeeContracts.map((item) => ({
    contractType: item.contractType,
    sequence: item.sequence,
    name: item.name,
    signingCompany: item.signingCompany,
    signedAt: dateValue(item.signedAt),
    effectiveFrom: dateValue(item.effectiveFrom),
    expiresAt: dateValue(item.expiresAt),
    termType: item.termType,
    originalCompany: item.originalCompany,
    newCompany: item.newCompany,
    confidentialityAgreement: item.confidentialityAgreement,
    nonCompeteAgreement: item.nonCompeteAgreement,
    portraitAgreement: item.portraitAgreement,
  }));
}

watch(() => props.modelValue, (visible) => { if (visible) reset(); });

function addContract() {
  form.contracts.push({
    contractType: 'contract', sequence: form.contracts.length, name: '', signingCompany: '',
    signedAt: null, effectiveFrom: null, expiresAt: null, termType: '', originalCompany: '', newCompany: '',
    confidentialityAgreement: '', nonCompeteAgreement: '', portraitAgreement: '',
  });
}

function submit() {
  form.employee.phone = form.profile.phone || null;
  emit('submit', {
    employee: { ...form.employee },
    profile: { ...form.profile },
    contracts: form.contracts.map((item, index) => ({ ...item, sequence: index })),
    performance: { ...form.performance },
  });
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="编辑员工档案"
    width="min(1080px, 94vw)"
    top="4vh"
    destroy-on-close
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-alert title="提交后进入待审核变更，审核通过前不会修改正式档案。" type="info" show-icon :closable="false" />
    <el-tabs class="archive-editor-tabs">
      <el-tab-pane label="基本与任职">
        <el-form label-position="top" class="archive-editor-grid">
          <el-form-item label="姓名"><el-input v-model="form.employee.name" /></el-form-item>
          <el-form-item label="工号"><el-input v-model="form.employee.employeeNo" /></el-form-item>
          <el-form-item label="所属公司">
            <el-select v-model="form.employee.company"><el-option label="孚德" value="fuede" /><el-option label="孚德体育文化" value="fuede_sports" /><el-option label="北京孚德" value="beijing_fuede" /><el-option label="凡思堡" value="fansibao" /></el-select>
          </el-form-item>
          <el-form-item label="所属部门">
            <el-tree-select v-model="form.employee.deptId" :data="departments" node-key="id" :props="{ label: 'name', children: 'children' }" check-strictly filterable />
          </el-form-item>
          <el-form-item label="岗位"><el-input v-model="form.employee.position" /></el-form-item>
          <el-form-item label="职级"><el-input v-model="form.employee.jobGrade" /></el-form-item>
          <el-form-item label="职系"><el-input v-model="form.employee.jobFamily" /></el-form-item>
          <el-form-item label="花名册直属主管"><UserSelect v-model="form.employee.managerId" :disabled-ids="archive ? [archive.id] : []" /></el-form-item>
          <el-form-item label="绩效直属上级"><UserSelect v-model="form.performance.managerId" :disabled-ids="archive ? [archive.id] : []" /></el-form-item>
          <el-form-item label="工作地点"><el-input v-model="form.employee.workLocation" /></el-form-item>
          <el-form-item label="用工类型"><el-select v-model="form.employee.employmentType"><el-option label="全职" value="full_time" /><el-option label="兼职" value="part_time" /><el-option label="返聘" value="rehire" /><el-option label="外部" value="external" /></el-select></el-form-item>
          <el-form-item label="当前状态"><el-select v-model="form.employee.employeeStatus"><el-option label="在职" value="active" /><el-option label="试用期" value="probation" /><el-option label="已离职" value="resigned" /></el-select></el-form-item>
          <el-form-item label="入职日期"><el-date-picker v-model="form.employee.entryDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item label="试用期（月）"><el-input-number v-model="form.employee.probationMonths" :min="0" :max="12" /></el-form-item>
          <el-form-item label="预计转正日期"><el-date-picker v-model="form.employee.plannedRegularDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item label="实际转正日期"><el-date-picker v-model="form.employee.actualRegularDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item label="离职日期"><el-date-picker v-model="form.employee.leaveDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        </el-form>
      </el-tab-pane>
      <el-tab-pane label="个人与教育">
        <el-form label-position="top" class="archive-editor-grid">
          <el-form-item label="手机号"><el-input v-model="form.profile.phone" /></el-form-item>
          <el-form-item label="性别"><el-select v-model="form.profile.gender" clearable><el-option label="男" value="男" /><el-option label="女" value="女" /></el-select></el-form-item>
          <el-form-item label="出生日期"><el-date-picker v-model="form.profile.birthDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item label="民族"><el-input v-model="form.profile.ethnicity" /></el-form-item>
          <el-form-item label="学历"><el-input v-model="form.profile.education" /></el-form-item>
          <el-form-item label="职称"><el-input v-model="form.profile.professionalTitle" /></el-form-item>
          <el-form-item label="毕业院校"><el-input v-model="form.profile.school" /></el-form-item>
          <el-form-item label="毕业日期"><el-date-picker v-model="form.profile.graduationDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item label="专业"><el-input v-model="form.profile.major" /></el-form-item>
          <el-form-item label="婚姻状况"><el-input v-model="form.profile.maritalStatus" /></el-form-item>
          <el-form-item label="子女状况"><el-input v-model="form.profile.childrenStatus" /></el-form-item>
          <el-form-item label="子女数量"><el-input-number v-model="form.profile.childrenCount" :min="0" /></el-form-item>
          <el-form-item label="政治面貌"><el-input v-model="form.profile.politicalStatus" /></el-form-item>
          <el-form-item label="籍贯"><el-input v-model="form.profile.nativePlace" /></el-form-item>
          <el-form-item label="户籍类型"><el-input v-model="form.profile.householdType" /></el-form-item>
        </el-form>
      </el-tab-pane>
      <el-tab-pane label="联系与保障">
        <el-form label-position="top" class="archive-editor-grid">
          <el-form-item label="身份证地址" class="span-2"><el-input v-model="form.profile.idAddress" /></el-form-item>
          <el-form-item :label="archive?.employeeProfile?.idNumberConfigured ? '身份证号（已保存，留空不变）' : '身份证号'"><el-input v-model="form.profile.idNumber" type="password" show-password /></el-form-item>
          <el-form-item label="现住址" class="span-2"><el-input v-model="form.profile.currentAddress" /></el-form-item>
          <el-form-item label="紧急联系人"><el-input v-model="form.profile.emergencyContactName" /></el-form-item>
          <el-form-item label="与联系人关系"><el-input v-model="form.profile.emergencyContactRelation" /></el-form-item>
          <el-form-item label="紧急联系电话"><el-input v-model="form.profile.emergencyContactPhone" /></el-form-item>
          <el-form-item label="社保状态"><el-input v-model="form.profile.socialSecurityStatus" /></el-form-item>
          <el-form-item label="社保起始日期"><el-date-picker v-model="form.profile.socialSecurityStartDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item label="公积金状态"><el-input v-model="form.profile.housingFundStatus" /></el-form-item>
          <el-form-item label="公积金起始日期"><el-date-picker v-model="form.profile.housingFundStartDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item label="开户行"><el-input v-model="form.profile.bankName" /></el-form-item>
          <el-form-item label="开户支行"><el-input v-model="form.profile.bankBranch" /></el-form-item>
          <el-form-item :label="archive?.employeeProfile?.bankAccountConfigured ? '银行卡号（已保存，留空不变）' : '银行卡号'"><el-input v-model="form.profile.bankAccount" type="password" show-password /></el-form-item>
        </el-form>
      </el-tab-pane>
      <el-tab-pane label="合同记录">
        <div class="contract-toolbar"><span>可新增、修改或移除合同；审核通过后统一生效。</span><el-button :icon="Plus" @click="addContract">新增合同</el-button></div>
        <div v-for="(contract, index) in form.contracts" :key="index" class="contract-card">
          <div class="contract-card__head"><strong>合同 {{ index + 1 }}</strong><el-button link type="danger" :icon="Delete" @click="form.contracts.splice(index, 1)">移除</el-button></div>
          <el-form label-position="top" class="archive-editor-grid">
            <el-form-item label="类型"><el-select v-model="contract.contractType"><el-option label="劳动合同" value="contract" /><el-option label="续签" value="renewal" /><el-option label="转签" value="transfer" /></el-select></el-form-item>
            <el-form-item label="合同名称"><el-input v-model="contract.name" /></el-form-item>
            <el-form-item label="签约公司"><el-input v-model="contract.signingCompany" /></el-form-item>
            <el-form-item label="签订日期"><el-date-picker v-model="contract.signedAt" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item label="生效日期"><el-date-picker v-model="contract.effectiveFrom" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item label="到期日期"><el-date-picker v-model="contract.expiresAt" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item label="期限"><el-input v-model="contract.termType" /></el-form-item>
            <el-form-item label="原公司"><el-input v-model="contract.originalCompany" /></el-form-item>
            <el-form-item label="新公司"><el-input v-model="contract.newCompany" /></el-form-item>
            <el-form-item label="保密协议"><el-input v-model="contract.confidentialityAgreement" /></el-form-item>
            <el-form-item label="竞业协议"><el-input v-model="contract.nonCompeteAgreement" /></el-form-item>
            <el-form-item label="肖像协议"><el-input v-model="contract.portraitAgreement" /></el-form-item>
          </el-form>
        </div>
        <el-empty v-if="!form.contracts.length" description="暂无合同，可点击新增合同" :image-size="72" />
      </el-tab-pane>
    </el-tabs>
    <template #footer><el-button @click="emit('update:modelValue', false)">取消</el-button><el-button type="primary" :loading="saving" @click="submit">提交审核</el-button></template>
  </el-dialog>
</template>

<style scoped>
.archive-editor-tabs { margin-top: 18px; }
.archive-editor-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 18px; }
.archive-editor-grid :deep(.el-select), .archive-editor-grid :deep(.el-date-editor), .archive-editor-grid :deep(.el-input-number) { width: 100%; }
.span-2 { grid-column: span 2; }
.contract-toolbar, .contract-card__head { display: flex; align-items: center; justify-content: space-between; }
.contract-toolbar { margin-bottom: 14px; color: #667085; }
.contract-card { margin-bottom: 14px; padding: 16px; border: 1px solid #e5eaf2; border-radius: 12px; }
.contract-card__head { margin-bottom: 8px; }
@media (max-width: 760px) { .archive-editor-grid { grid-template-columns: 1fr; } .span-2 { grid-column: auto; } }
</style>
