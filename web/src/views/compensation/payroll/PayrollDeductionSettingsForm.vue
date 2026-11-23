<script setup lang="ts">
import { Plus, Delete } from '@element-plus/icons-vue';
import type { PayrollDeductionSettings } from '@/types/payroll.types';
import { taxAmountFields } from './payroll-deduction-form';
const model = defineModel<PayrollDeductionSettings>({required: true});
withDefaults(defineProps<{disabled?: boolean; errors?: Record<string,string>}>(), {errors: () => ({})});
const contributions = [{key:'socialInsurance',label:'个人社保'},{key:'housingFund',label:'个人公积金'}] as const;
</script>
<template>
  <el-form label-position="top" :disabled="disabled" class="deduction-settings">
    <el-form-item label="扣缴舍入" :error="errors.rounding"><el-select v-model="model.rounding"><el-option label="分项四舍五入到分" value="component_half_up" /></el-select></el-form-item>
    <section v-for="section in contributions" :key="section.key">
      <h3>{{ section.label }}</h3>
      <div class="fields-grid">
        <el-form-item :label="`${section.label}适用性`" :error="errors[`${section.key}.status`]"><el-select v-model="model[section.key].status"><el-option label="适用" value="applicable"/><el-option label="不适用（须有依据）" value="not_applicable"/></el-select></el-form-item>
        <el-form-item :label="`${section.label}缴费归属日`" :error="errors[`${section.key}.contributionDate`]"><el-input v-model="model[section.key].contributionDate" placeholder="YYYY-MM-DD"/></el-form-item>
        <el-form-item :label="`${section.label}规则版本`" :error="errors[`${section.key}.ruleVersion`]"><el-input v-model="model[section.key].ruleVersion" maxlength="200"/></el-form-item>
        <el-form-item :label="`${section.label}确认依据`" :error="errors[`${section.key}.evidenceRef`]"><el-input v-model="model[section.key].evidenceRef" maxlength="200"/></el-form-item>
        <el-form-item :label="`${section.label}规则开始日`" :error="errors[`${section.key}.effectiveFrom`]"><el-input v-model="model[section.key].effectiveFrom" placeholder="YYYY-MM-DD"/></el-form-item>
        <el-form-item :label="`${section.label}规则结束日`" :error="errors[`${section.key}.effectiveTo`]"><el-input v-model="model[section.key].effectiveTo" clearable placeholder="长期可留空" @change="model[section.key].effectiveTo ||= null"/></el-form-item>
      </div>
      <el-form-item :error="errors[`${section.key}.items`]"><el-button v-if="!disabled" :icon="Plus" @click="model[section.key].items.push({code:'',base:'',rate:''})">添加缴费项</el-button></el-form-item>
      <div v-for="(item,index) in model[section.key].items" :key="index" class="item-grid">
        <el-form-item label="项目代码" :error="errors[`${section.key}.items.${index}.code`]"><el-input v-model="item.code"/></el-form-item>
        <el-form-item label="个人基数" :error="errors[`${section.key}.items.${index}.base`]"><el-input v-model="item.base" inputmode="decimal"/></el-form-item>
        <el-form-item label="个人比例（小数）" :error="errors[`${section.key}.items.${index}.rate`]"><el-input v-model="item.rate" inputmode="decimal"/></el-form-item>
        <el-button v-if="!disabled" :icon="Delete" circle aria-label="删除缴费项" title="删除缴费项" @click="model[section.key].items.splice(index,1)"/>
      </div>
    </section>
    <section><h3>个税规则</h3><div class="fields-grid">
      <el-form-item label="计税方式" :error="errors['tax.method']"><el-select v-model="model.tax.method"><el-option label="居民工资累计预扣" value="resident_cumulative_wage"/></el-select></el-form-item>
      <el-form-item label="个税规则版本" :error="errors['tax.ruleVersion']"><el-input v-model="model.tax.ruleVersion" maxlength="200"/></el-form-item>
      <el-form-item label="个税规则依据" :error="errors['tax.evidenceRef']"><el-input v-model="model.tax.evidenceRef" maxlength="200"/></el-form-item>
      <el-form-item label="个税规则开始日" :error="errors['tax.effectiveFrom']"><el-input v-model="model.tax.effectiveFrom" placeholder="YYYY-MM-DD"/></el-form-item>
      <el-form-item label="个税规则结束日" :error="errors['tax.effectiveTo']"><el-input v-model="model.tax.effectiveTo" clearable placeholder="长期可留空" @change="model.tax.effectiveTo ||= null"/></el-form-item>
    </div>
      <el-form-item :error="errors['tax.brackets']"><el-button v-if="!disabled" :icon="Plus" @click="model.tax.brackets.push({upTo:'',rate:'',quickDeduction:''})">添加分档</el-button></el-form-item>
      <div v-for="(bracket,index) in model.tax.brackets" :key="index" class="item-grid">
        <el-form-item label="累计应税额上限" :error="errors[`tax.brackets.${index}.upTo`]"><el-input v-if="bracket.upTo !== null" v-model="bracket.upTo" inputmode="decimal"/><el-checkbox :model-value="bracket.upTo === null" @update:model-value="bracket.upTo = $event ? null : ''">无上限</el-checkbox></el-form-item>
        <el-form-item label="税率（小数）" :error="errors[`tax.brackets.${index}.rate`]"><el-input v-model="bracket.rate" inputmode="decimal"/></el-form-item>
        <el-form-item label="速算扣除数" :error="errors[`tax.brackets.${index}.quickDeduction`]"><el-input v-model="bracket.quickDeduction" inputmode="decimal"/></el-form-item>
        <el-button v-if="!disabled" :icon="Delete" circle aria-label="删除分档" title="删除分档" @click="model.tax.brackets.splice(index,1)"/>
      </div>
    </section>
    <section><h3>发薪年度累计期初</h3><div class="fields-grid">
      <el-form-item label="累计来源版本" :error="errors['tax.opening.sourceVersion']"><el-input v-model="model.tax.opening.sourceVersion" maxlength="200"/></el-form-item>
      <el-form-item label="累计期初依据" :error="errors['tax.opening.evidenceRef']"><el-input v-model="model.tax.opening.evidenceRef" maxlength="200"/></el-form-item>
      <el-form-item label="累计收入" :error="errors['tax.opening.income']"><el-input v-model="model.tax.opening.income" inputmode="decimal"/></el-form-item>
      <el-form-item label="累计已扣个税" :error="errors['tax.opening.taxPaid']"><el-input v-model="model.tax.opening.taxPaid" inputmode="decimal"/></el-form-item>
      <el-form-item v-for="field in taxAmountFields" :key="field.key" :label="`累计${field.label}`" :error="errors[`tax.opening.${field.key}`]"><el-input v-model="model.tax.opening[field.key]" inputmode="decimal"/></el-form-item>
    </div><el-form-item :error="errors['tax.opening.confirmed']"><el-checkbox v-model="model.tax.opening.confirmed">已核对累计期初及其依据</el-checkbox></el-form-item></section>
    <section><h3>本次扣除事实</h3><div class="fields-grid"><el-form-item v-for="field in taxAmountFields" :key="field.key" :label="`本次${field.label}`" :error="errors[`tax.current.${field.key}`]"><el-input v-model="model.tax.current[field.key]" inputmode="decimal"/></el-form-item></div></section>
  </el-form>
</template>
<style scoped>
section { border-top: 1px solid var(--el-border-color-lighter); margin-top: 16px; padding-top: 8px; }
h3 {font-size:16px;margin:10px 0 16px;}
.fields-grid {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px;}
.item-grid {display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) 32px;align-items:start;gap:10px;}
.item-grid > .el-button {margin-top:30px;}
:deep(.el-form-item__error) {position:static;overflow-wrap:anywhere;line-height:1.5;}
@media(max-width:600px) {.fields-grid {grid-template-columns:minmax(0,1fr);}.item-grid {grid-template-columns:minmax(0,1fr);border-top:1px dashed var(--el-border-color-light);padding-top:12px;}.item-grid>.el-button {margin:0 0 14px;}}
</style>
