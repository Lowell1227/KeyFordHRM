<script setup lang="ts">
import { ref, watch } from 'vue';
import { Plus, Delete } from '@element-plus/icons-vue';
import type { PayrollDeductionSettings } from '@/types/payroll.types';
import { emptyDeductionLedger, taxAmountFields } from './payroll-deduction-form';
const model = defineModel<PayrollDeductionSettings>({ required: true });
const props = withDefaults(defineProps<{ disabled?: boolean; errors?: Record<string, string>; section?: 'contributions' | 'tax' }>(), { errors: () => ({}) });
const contributions = [{ key: 'socialInsurance', label: '个人社保' }, { key: 'housingFund', label: '个人公积金' }] as const;
const expanded = ref(['socialInsurance', 'housingFund', 'tax.opening']);
function group(path: string) {
  if (path.startsWith('socialInsurance')) return 'socialInsurance';
  if (path.startsWith('housingFund')) return 'housingFund';
  if (path.startsWith('ledger')) return 'ledger';
  if (path.startsWith('tax.opening')) return 'tax.opening';
  if (path.startsWith('tax.current')) return 'tax.current';
  return 'tax.rules';
}
watch(() => props.errors, errors => {
  for (const path of Object.keys(errors)) if (!expanded.value.includes(group(path))) expanded.value.push(group(path));
}, { deep: true, immediate: true });
function title(label: string, name: string) {
  const count = Object.keys(props.errors).filter(path => group(path) === name).length;
  return count ? `${label} · ${count}项待核对` : label;
}
</script>
<template>
  <el-form label-position="top" :disabled="disabled" class="deduction-settings">
    <el-collapse v-model="expanded">
      <template v-if="!section || section === 'contributions'">
        <el-collapse-item v-for="item in contributions" :key="item.key" :name="item.key" :title="title(item.label, item.key)">
          <div class="fields-grid">
            <el-form-item :label="`${item.label}适用性`" :error="errors[`${item.key}.status`]"><el-select v-model="model[item.key].status"><el-option label="适用" value="applicable" /><el-option label="不适用（须有依据）" value="not_applicable" /></el-select></el-form-item>
            <el-form-item :label="`${item.label}缴费归属日`" :error="errors[`${item.key}.contributionDate`]"><el-date-picker v-model="model[item.key].contributionDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          </div>
          <el-form-item :error="errors[`${item.key}.items`]"><el-button v-if="!disabled" :icon="Plus" @click="model[item.key].items.push({ code: '', base: '', rate: '' })">添加缴费项</el-button></el-form-item>
          <div v-for="(row, index) in model[item.key].items" :key="index" class="item-grid">
            <el-form-item label="缴费项目" :error="errors[`${item.key}.items.${index}.code`]"><el-input v-model="row.code" /></el-form-item>
            <el-form-item label="个人基数" :error="errors[`${item.key}.items.${index}.base`]"><el-input v-model="row.base" inputmode="decimal" /></el-form-item>
            <el-form-item label="个人比例（小数）" :error="errors[`${item.key}.items.${index}.rate`]"><el-input v-model="row.rate" inputmode="decimal" /></el-form-item>
            <el-button v-if="!disabled" :icon="Delete" circle aria-label="删除缴费项" title="删除缴费项" @click="model[item.key].items.splice(index, 1)" />
          </div>
          <div class="fields-grid">
            <el-form-item :label="`${item.label}规则版本`" :error="errors[`${item.key}.ruleVersion`]"><el-input v-model="model[item.key].ruleVersion" maxlength="200" /></el-form-item>
            <el-form-item :label="`${item.label}确认依据`" :error="errors[`${item.key}.evidenceRef`]"><el-input v-model="model[item.key].evidenceRef" maxlength="200" /></el-form-item>
            <el-form-item :label="`${item.label}规则开始日`" :error="errors[`${item.key}.effectiveFrom`]"><el-date-picker v-model="model[item.key].effectiveFrom" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item :label="`${item.label}规则结束日`" :error="errors[`${item.key}.effectiveTo`]"><el-date-picker v-model="model[item.key].effectiveTo" type="date" value-format="YYYY-MM-DD" clearable placeholder="长期可留空" @change="model[item.key].effectiveTo ||= null" /></el-form-item>
          </div>
        </el-collapse-item>
      </template>
      <template v-if="!section || section === 'tax'">
        <el-collapse-item name="tax.opening" :title="title(model.ledger ? '基准日前累计期初' : '发薪年度累计期初', 'tax.opening')">
          <div class="fields-grid">
            <el-form-item label="累计来源版本" :error="errors['tax.opening.sourceVersion']"><el-input v-model="model.tax.opening.sourceVersion" maxlength="200" /></el-form-item>
            <el-form-item label="累计期初依据" :error="errors['tax.opening.evidenceRef']"><el-input v-model="model.tax.opening.evidenceRef" maxlength="200" /></el-form-item>
            <el-form-item label="累计收入" :error="errors['tax.opening.income']"><el-input v-model="model.tax.opening.income" inputmode="decimal" /></el-form-item>
            <el-form-item label="累计已扣个税" :error="errors['tax.opening.taxPaid']"><el-input v-model="model.tax.opening.taxPaid" inputmode="decimal" /></el-form-item>
            <el-form-item v-for="field in taxAmountFields" :key="field.key" :label="`累计${field.label}`" :error="errors[`tax.opening.${field.key}`]"><el-input v-model="model.tax.opening[field.key]" inputmode="decimal" /></el-form-item>
          </div>
          <el-form-item :error="errors['tax.opening.confirmed']"><el-checkbox v-model="model.tax.opening.confirmed">已核对本员工累计期初及其依据</el-checkbox></el-form-item>
        </el-collapse-item>
        <el-collapse-item name="ledger" :title="title('累计台账接管', 'ledger')">
          <el-form-item label="累计台账"><el-checkbox :model-value="!!model.ledger" @update:model-value="model.ledger = $event ? emptyDeductionLedger() : undefined">接入实发累计台账</el-checkbox></el-form-item>
          <template v-if="model.ledger">
            <p class="ledger-note">基准日前累计须有历史依据；基准月既有扣除不重复计入本月。晚于基准月的缴费月，接管前外部已扣须核实后明确填0。</p>
            <div class="fields-grid">
              <el-form-item label="台账基准日" :error="errors['ledger.startDate']"><el-date-picker v-model="model.ledger.startDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
              <el-form-item label="接管前外部已扣个人社保" :error="errors['ledger.priorSocialInsurance']"><el-input v-model="model.ledger.priorSocialInsurance" inputmode="decimal" /></el-form-item>
              <el-form-item label="接管前外部已扣个人公积金" :error="errors['ledger.priorHousingFund']"><el-input v-model="model.ledger.priorHousingFund" inputmode="decimal" /></el-form-item>
              <el-form-item v-for="field in taxAmountFields" :key="field.key" :label="`基准月既有${field.label}`" :error="errors[`ledger.priorInPayMonth.${field.key}`]"><el-input v-model="model.ledger.priorInPayMonth[field.key]" inputmode="decimal" /></el-form-item>
            </div>
          </template>
        </el-collapse-item>
        <el-collapse-item name="tax.current" :title="title(model.ledger ? '本月累计扣除额度' : '本次扣除事实', 'tax.current')">
          <div class="fields-grid"><el-form-item v-for="field in taxAmountFields" :key="field.key" :label="`${model.ledger ? '本月累计' : '本次'}${field.label}`" :error="errors[`tax.current.${field.key}`]"><el-input v-model="model.tax.current[field.key]" inputmode="decimal" /></el-form-item></div>
        </el-collapse-item>
        <el-collapse-item name="tax.rules" :title="title('个税规则与分档', 'tax.rules')">
          <div class="fields-grid">
            <el-form-item label="扣缴舍入" :error="errors.rounding"><el-select v-model="model.rounding"><el-option label="分项四舍五入到分" value="component_half_up" /></el-select></el-form-item>
            <el-form-item label="计税方式" :error="errors['tax.method']"><el-select v-model="model.tax.method"><el-option label="居民工资累计预扣" value="resident_cumulative_wage" /></el-select></el-form-item>
            <el-form-item label="个税规则版本" :error="errors['tax.ruleVersion']"><el-input v-model="model.tax.ruleVersion" maxlength="200" /></el-form-item>
            <el-form-item label="个税规则依据" :error="errors['tax.evidenceRef']"><el-input v-model="model.tax.evidenceRef" maxlength="200" /></el-form-item>
            <el-form-item label="个税规则开始日" :error="errors['tax.effectiveFrom']"><el-date-picker v-model="model.tax.effectiveFrom" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item label="个税规则结束日" :error="errors['tax.effectiveTo']"><el-date-picker v-model="model.tax.effectiveTo" type="date" value-format="YYYY-MM-DD" clearable placeholder="长期可留空" @change="model.tax.effectiveTo ||= null" /></el-form-item>
          </div>
          <el-form-item :error="errors['tax.brackets']"><el-button v-if="!disabled" :icon="Plus" @click="model.tax.brackets.push({ upTo: '', rate: '', quickDeduction: '' })">添加分档</el-button></el-form-item>
          <div v-for="(bracket, index) in model.tax.brackets" :key="index" class="item-grid">
            <el-form-item label="累计应税额上限" :error="errors[`tax.brackets.${index}.upTo`]"><el-input v-if="bracket.upTo !== null" v-model="bracket.upTo" inputmode="decimal" /><el-checkbox :model-value="bracket.upTo === null" @update:model-value="bracket.upTo = $event ? null : ''">无上限</el-checkbox></el-form-item>
            <el-form-item label="税率（小数）" :error="errors[`tax.brackets.${index}.rate`]"><el-input v-model="bracket.rate" inputmode="decimal" /></el-form-item>
            <el-form-item label="速算扣除数" :error="errors[`tax.brackets.${index}.quickDeduction`]"><el-input v-model="bracket.quickDeduction" inputmode="decimal" /></el-form-item>
            <el-button v-if="!disabled" :icon="Delete" circle aria-label="删除分档" title="删除分档" @click="model.tax.brackets.splice(index, 1)" />
          </div>
        </el-collapse-item>
      </template>
    </el-collapse>
  </el-form>
</template>
<style scoped>
.deduction-settings { min-width: 0; }
.ledger-note { font-size: 13px; color: var(--el-text-color-secondary); line-height: 1.6; overflow-wrap: anywhere; }
.fields-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
.item-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) 32px; align-items: start; gap: 10px; }
.item-grid > .el-button { margin-top: 30px; }
:deep(.el-form-item__error) { position: static; overflow-wrap: anywhere; line-height: 1.5; }
:deep(.el-select), :deep(.el-date-editor) { width: 100%; }
:deep(.el-collapse-item__header) { height: auto; min-height: 48px; line-height: 1.5; padding: 8px 0; overflow-wrap: anywhere; }
@media (max-width: 600px) { .fields-grid { grid-template-columns: minmax(0, 1fr); } .item-grid { grid-template-columns: minmax(0, 1fr); border-top: 1px dashed var(--el-border-color-light); padding-top: 12px; } .item-grid > .el-button { margin: 0 0 14px; } }
</style>
