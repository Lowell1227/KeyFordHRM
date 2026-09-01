<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import UserSelect from '@/components/common/UserSelect.vue';
import type { CompanyCode } from '@/types/enums';
import type { Department, UpdateDepartmentStructureBody } from '@/types/api.types';

const props = defineProps<{
  modelValue: boolean;
  department: Department | null;
  departments: Department[];
  saving: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  save: [value: UpdateDepartmentStructureBody];
}>();

const ROOT_PARENT = '__root__';

const form = reactive({
  name: '',
  company: 'fuede' as CompanyCode,
  parentId: ROOT_PARENT,
  leaderId: null as string | null,
  approverId: null as string | null,
});
let initial = '';

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

function snapshot() {
  return JSON.stringify(form);
}

function reset() {
  if (!props.department) return;
  Object.assign(form, {
    name: props.department.name,
    company: props.department.company,
    parentId: props.department.parentId ?? ROOT_PARENT,
    leaderId: props.department.leaderId ?? null,
    approverId: props.department.approverId ?? null,
  });
  initial = snapshot();
}

watch(() => [props.modelValue, props.department?.id] as const, ([open]) => {
  if (open) reset();
}, { immediate: true });

const parentOptions = computed(() => {
  const result: Department[] = [];
  const excluded = new Set<string>();
  const find = (items: Department[]): Department | null => {
    for (const item of items) {
      if (item.id === props.department?.id) return item;
      const nested = find(item.children ?? []);
      if (nested) return nested;
    }
    return null;
  };
  const addDescendants = (item: Department) => {
    excluded.add(item.id);
    (item.children ?? []).forEach(addDescendants);
  };
  const current = find(props.departments);
  if (current) addDescendants(current);
  const flatten = (items: Department[]) => items.forEach((item) => {
    if (!excluded.has(item.id) && item.company === form.company) result.push(item);
    flatten(item.children ?? []);
  });
  flatten(props.departments);
  return result;
});

async function beforeClose(done: () => void) {
  if (snapshot() === initial) {
    done();
    return;
  }
  try {
    await ElMessageBox.confirm('当前部门信息尚未保存，确认放弃修改？', '放弃修改', {
      confirmButtonText: '放弃修改', cancelButtonText: '继续编辑', type: 'warning',
    });
    done();
  } catch {
    // 继续编辑
  }
}

function submit() {
  if (!form.name.trim()) {
    ElMessage.warning('请输入部门名称');
    return;
  }
  if (snapshot() === initial) {
    ElMessage.info('部门信息没有变化，无需提交审核');
    return;
  }
  emit('save', {
    name: form.name.trim(),
    company: form.company,
    parentId: form.parentId === ROOT_PARENT ? null : form.parentId,
    leaderId: form.leaderId,
    approverId: form.approverId,
  });
}
</script>

<template>
  <el-drawer
    v-model="visible"
    title="编辑部门"
    size="min(680px, 100vw)"
    :before-close="beforeClose"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <div v-if="department" class="department-editor">
      <el-alert title="保存后提交 HR 管理员审核，审核通过前正式组织架构保持不变。" type="info" show-icon :closable="false" />
      <section>
        <div class="section-title"><h3>基础信息</h3><span>部门名称与组织层级</span></div>
        <el-form label-position="top">
          <el-form-item label="部门名称"><el-input v-model="form.name" maxlength="100" show-word-limit /></el-form-item>
          <el-form-item label="上级部门">
            <el-select v-model="form.parentId" filterable placeholder="公司根节点">
              <el-option label="公司根节点" :value="ROOT_PARENT" />
              <el-option v-for="item in parentOptions" :key="item.id" :label="item.fullPath || item.name" :value="item.id" />
            </el-select>
          </el-form-item>
        </el-form>
      </section>
      <section>
        <div class="section-title"><h3>组织职责</h3><span>与人员档案一致的选择方式</span></div>
        <el-form label-position="top">
          <el-form-item label="部门负责人"><UserSelect v-model="form.leaderId" clearable /></el-form-item>
          <el-form-item label="最终业务审批人"><UserSelect v-model="form.approverId" clearable /></el-form-item>
        </el-form>
      </section>
      <section class="impact-card">
        <div class="section-title"><h3>影响范围</h3><span>提交前核对</span></div>
        <p>当前直属人员：<strong>{{ department.directMemberCount ?? 0 }}</strong> 人</p>
        <p>当前直属子部门：<strong>{{ department.children?.length ?? 0 }}</strong> 个</p>
        <p>名称、上级或职责变化会作为同一条部门变更审核。</p>
      </section>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存并提交审核</el-button>
    </template>
  </el-drawer>
</template>

<style scoped>
.department-editor { display: grid; gap: 18px; }
.department-editor section { padding: 18px; border: 1px solid #e5eaf2; border-radius: 14px; }
.section-title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.section-title h3 { margin: 0; font-size: 16px; }
.section-title span, .impact-card p { color: #667085; font-size: 13px; }
.department-editor :deep(.el-select) { width: 100%; }
.impact-card { background: #f8fafc; }
.impact-card p { margin: 8px 0 0; }
.impact-card strong { color: #101828; }
</style>
