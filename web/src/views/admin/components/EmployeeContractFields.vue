<script setup lang="ts">
import type { UploadRequestOptions } from 'element-plus';
import ContractSubjectSelect from '@/components/common/ContractSubjectSelect.vue';
import ContractDateInput from '@/components/common/ContractDateInput.vue';
import PersonnelReferenceSelect from '@/components/common/PersonnelReferenceSelect.vue';
import type { ContractSubject } from '@/api/contract-subjects.api';

const props = defineProps<{
  contract: Record<string, any>;
  index: number;
  errors: Record<string, string>;
  materialsOnly?: boolean;
  imageCount: number;
  attachmentCount: number;
  uploadImage: (options: UploadRequestOptions) => Promise<unknown>;
  uploadAttachment: (options: UploadRequestOptions) => Promise<unknown>;
  openMaterial: (item: { name: string; url: string; mimeType?: string }) => Promise<void>;
}>();
const typeOptions = [{ value: 'contract', label: '首签' }, { value: 'renewal', label: '续签' }, { value: 'transfer', label: '转签' }];
const legacyTypes: Record<string, string> = { attachment: '附件', confidentiality: '保密协议', unclassified: '待分类合同' };
const termOptions = ['固定期限', '无固定期限', '以完成一定工作任务为期限'];
const agreementOptions = ['已签署', '未签署', '不适用'];
const agreements = [{ key: 'confidentialityAgreement', label: '保密协议' }, { key: 'nonCompeteAgreement', label: '竞业协议' }, { key: 'portraitAgreement', label: '肖像协议' }];
const field = (name: string) => `contracts.${props.index}.${name}`;
function error(name: string) {
  return props.errors[field(name)] || (name === 'signingCompany'
    ? props.errors[field('contractSubjectId')] || props.errors[field('newCompany')] : undefined);
}
function selectSigningCompany(subject: ContractSubject | null) {
  if (props.contract.contractType === 'transfer') props.contract.newCompany = subject?.name ?? '';
}
function changeType(value: string) {
  if (value === 'transfer') props.contract.newCompany = props.contract.signingCompany || '';
}
</script>

<template>
  <el-form v-if="!materialsOnly" label-position="top" class="contract-fields">
    <el-form-item label="类型" :data-archive-field="field('contractType')" :error="error('contractType')">
      <el-select v-model="contract.contractType" @change="changeType">
        <el-option v-for="option in typeOptions" :key="option.value" :label="option.label" :value="option.value" />
        <el-option v-if="contract.contractType && !typeOptions.some(item => item.value === contract.contractType)" :label="legacyTypes[contract.contractType] || contract.contractType" :value="contract.contractType" />
      </el-select>
    </el-form-item>
    <el-form-item label="合同名称" :data-archive-field="field('name')" :error="error('name')"><PersonnelReferenceSelect v-model="contract.name" kind="contract_name" /></el-form-item>
    <el-form-item v-if="contract.contractType === 'transfer' || contract.originalCompany" label="原公司" :data-archive-field="field('originalCompany')" :error="error('originalCompany')"><ContractSubjectSelect v-model:snapshot-name="contract.originalCompany" name-only /></el-form-item>
    <el-form-item :label="contract.contractType === 'transfer' ? '新公司（签约公司）' : '签约公司'" :data-archive-field="field('signingCompany')" :error="error('signingCompany')">
      <ContractSubjectSelect v-model="contract.contractSubjectId" v-model:snapshot-name="contract.signingCompany" @select="selectSigningCompany" />
      <small v-if="contract.contractType === 'transfer'" class="field-help">只记录本次转签，不修改员工所属公司和原合同日期。</small>
    </el-form-item>
    <el-form-item v-if="contract.contractType !== 'transfer' && contract.newCompany" label="原记录新公司" :data-archive-field="field('newCompany')" :error="error('newCompany')"><ContractSubjectSelect v-model:snapshot-name="contract.newCompany" name-only /></el-form-item>
    <el-form-item label="签订日期" :data-archive-field="field('signedAt')" :error="error('signedAt')"><ContractDateInput v-model="contract.signedAt" /><small class="field-help">双方实际签字的日期</small></el-form-item>
    <el-form-item label="生效日期" :data-archive-field="field('effectiveFrom')" :error="error('effectiveFrom')"><ContractDateInput v-model="contract.effectiveFrom" /><small class="field-help">本份合同约定的开始日期</small></el-form-item>
    <el-form-item label="期限类型" :data-archive-field="field('termType')" :error="error('termType')"><el-select v-model="contract.termType" filterable allow-create default-first-option clearable placeholder="选择期限类型"><el-option v-for="item in termOptions" :key="item" :label="item" :value="item" /><el-option v-if="contract.termType && !termOptions.includes(contract.termType)" :label="contract.termType" :value="contract.termType" /></el-select></el-form-item>
    <el-form-item label="到期日期" :data-archive-field="field('expiresAt')" :error="error('expiresAt')"><ContractDateInput v-model="contract.expiresAt" /><small v-if="contract.termType === '无固定期限'" class="field-help">无固定期限一般不填到期日；已有日期不会自动清空。</small></el-form-item>
    <el-form-item v-for="agreement in agreements" :key="agreement.key" :label="agreement.label" :data-archive-field="field(agreement.key)" :error="error(agreement.key)"><el-select v-model="contract[agreement.key]" filterable allow-create default-first-option clearable placeholder="请选择"><el-option v-for="item in agreementOptions" :key="item" :label="item" :value="item" /><el-option v-if="contract[agreement.key] && !agreementOptions.includes(contract[agreement.key])" :label="contract[agreement.key]" :value="contract[agreement.key]" /></el-select></el-form-item>
  </el-form>
  <div class="contract-materials" :data-archive-field="field('materials')">
    <p v-if="materialsOnly" class="field-help">补充这份合同的扫描件或附件，合同信息保持原样。</p>
    <div class="contract-materials__group">
      <div><strong>合同图片</strong><span>最多 5 张，JPG/PNG/WEBP，单张不超过 2MB</span></div>
      <el-upload :disabled="imageCount >= 5" :show-file-list="false" accept="image/jpeg,image/png,image/webp" :http-request="uploadImage"><el-button :disabled="imageCount >= 5">上传图片</el-button></el-upload>
      <div v-for="(item, itemIndex) in contract.images" :key="`${item.url}-${itemIndex}`" class="material-item"><el-button link type="primary" @click="openMaterial(item)">{{ item.name }}</el-button><small>{{ Math.ceil(item.size / 1024) }}KB</small><el-button link type="danger" @click="contract.images.splice(itemIndex, 1)">移除</el-button></div>
      <p v-if="error('images')" class="field-error" role="alert">{{ error('images') }}</p>
    </div>
    <div class="contract-materials__group">
      <div><strong>合同附件</strong><span>最多 10 个，PDF/Word/Excel，单个不超过 10MB</span></div>
      <el-upload :disabled="attachmentCount >= 10" :show-file-list="false" accept=".pdf,.doc,.docx,.xls,.xlsx" :http-request="uploadAttachment"><el-button :disabled="attachmentCount >= 10">上传附件</el-button></el-upload>
      <div v-for="(item, itemIndex) in contract.attachments" :key="`${item.url}-${itemIndex}`" class="material-item"><el-button link type="primary" @click="openMaterial(item)">{{ item.name }}</el-button><small>{{ Math.ceil(item.size / 1024) }}KB</small><el-button link type="danger" @click="contract.attachments.splice(itemIndex, 1)">移除</el-button></div>
      <p v-if="error('attachments')" class="field-error" role="alert">{{ error('attachments') }}</p>
    </div>
  </div>
</template>

<style scoped>
.contract-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
.contract-fields :deep(.el-form-item__content) { display: block; }
.contract-fields :deep(.el-select), .contract-fields :deep(.el-date-editor) { width: 100%; }
.field-help { display: block; color: #667085; font-size: 12px; line-height: 1.5; margin: 4px 0; }
.field-error { color: var(--el-color-danger); font-size: 12px; }
.contract-materials { display: grid; gap: 14px; }
.contract-materials__group { display: grid; gap: 8px; }
.contract-materials__group > div:first-child { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.contract-materials__group span, .material-item small { color: #667085; font-size: 12px; }
.material-item { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.material-item :deep(.el-button:first-child) { white-space: normal; overflow-wrap: anywhere; text-align: left; height: auto; max-width: 100%; }
@media (max-width: 640px) { .contract-fields { grid-template-columns: minmax(0, 1fr); } }
</style>
