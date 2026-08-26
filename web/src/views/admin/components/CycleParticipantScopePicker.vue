<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import UserSelect from '@/components/common/UserSelect.vue';
import type { Department } from '@/types/api.types';

export type ParticipantScopeMode = 'all' | 'custom';

interface DepartmentTreeNode extends Department {
  disabled: boolean;
  children: DepartmentTreeNode[];
}

const props = defineProps<{
  scope: ParticipantScopeMode;
  departments: Department[];
  departmentIds: string[];
  userIds: string[];
  excludedUserIds: string[];
}>();

const emit = defineEmits<{
  'update:scope': [value: ParticipantScopeMode];
  'update:departmentIds': [value: string[]];
  'update:userIds': [value: string[]];
  'update:excludedUserIds': [value: string[]];
  change: [];
}>();

const drawerVisible = ref(false);
const activeTab = ref<'departments' | 'users' | 'excluded'>('departments');
const departmentKeyword = ref('');
const departmentDraft = ref<string[]>([]);
const userDraft = ref<string[]>([]);
const excludedUserDraft = ref<string[]>([]);
const departmentTreeRef = ref<{
  filter: (value: string) => void;
  getCheckedKeys: (leafOnly?: boolean) => Array<string | number>;
  setCheckedKeys: (keys: string[]) => void;
} | null>(null);

const treeProps = {
  label: 'name',
  children: 'children',
  disabled: 'disabled',
};

const departmentTree = computed<DepartmentTreeNode[]>(() => {
  const sortNodes = (items: DepartmentTreeNode[]) => {
    items.sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
    items.forEach((item) => sortNodes(item.children));
  };
  const cloneNestedNodes = (items: Department[]): DepartmentTreeNode[] => items.map((department) => ({
    ...department,
    disabled: department.isActive === false,
    children: cloneNestedNodes(department.children ?? []),
  }));

  if (props.departments.some((department) => (department.children?.length ?? 0) > 0)) {
    const nestedNodes = cloneNestedNodes(props.departments);
    sortNodes(nestedNodes);
    return nestedNodes;
  }

  const nodes = new Map<string, DepartmentTreeNode>();
  const roots: DepartmentTreeNode[] = [];

  for (const department of props.departments) {
    nodes.set(department.id, {
      ...department,
      disabled: department.isActive === false,
      children: [],
    });
  }
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  sortNodes(roots);
  return roots;
});

const summary = computed(() => {
  const parts = props.scope === 'all'
    ? ['全公司']
    : [
        `${props.departmentIds.length} 个部门`,
        `${props.userIds.length} 名员工`,
      ];
  if (props.excludedUserIds.length > 0) parts.push(`排除 ${props.excludedUserIds.length} 人`);
  return parts.join(' · ');
});

const draftSummary = computed(() => {
  const parts = props.scope === 'all'
    ? ['全公司']
    : [
        `${departmentDraft.value.length} 个部门`,
        `${userDraft.value.length} 名员工`,
      ];
  if (excludedUserDraft.value.length > 0) parts.push(`排除 ${excludedUserDraft.value.length} 人`);
  return parts.join(' · ');
});

function setScope(value: string | number | boolean | undefined) {
  if (value !== 'all' && value !== 'custom') return;
  emit('update:scope', value);
  if (value === 'all') {
    emit('update:departmentIds', []);
    emit('update:userIds', []);
  }
  emit('change');
}

async function openPicker() {
  departmentDraft.value = [...props.departmentIds];
  userDraft.value = [...props.userIds];
  excludedUserDraft.value = [...props.excludedUserIds];
  departmentKeyword.value = '';
  activeTab.value = props.scope === 'all' ? 'excluded' : 'departments';
  drawerVisible.value = true;
  await nextTick();
  departmentTreeRef.value?.setCheckedKeys(departmentDraft.value);
}

function syncDepartmentDraft() {
  departmentDraft.value = (departmentTreeRef.value?.getCheckedKeys(false) ?? []).map(String);
}

function updateUserDraft(value: string | string[] | undefined) {
  const ids = Array.isArray(value) ? value : value ? [value] : [];
  userDraft.value = ids;
  if (ids.length > 0) {
    const included = new Set(ids);
    excludedUserDraft.value = excludedUserDraft.value.filter((id) => !included.has(id));
  }
}

function updateExcludedUserDraft(value: string | string[] | undefined) {
  const ids = Array.isArray(value) ? value : value ? [value] : [];
  excludedUserDraft.value = ids;
  if (ids.length > 0) {
    const excluded = new Set(ids);
    userDraft.value = userDraft.value.filter((id) => !excluded.has(id));
  }
}

function clearCurrentTab() {
  if (activeTab.value === 'departments') {
    departmentDraft.value = [];
    departmentTreeRef.value?.setCheckedKeys([]);
  } else if (activeTab.value === 'users') {
    userDraft.value = [];
  } else {
    excludedUserDraft.value = [];
  }
}

function applySelection() {
  emit('update:departmentIds', props.scope === 'custom' ? [...departmentDraft.value] : []);
  emit('update:userIds', props.scope === 'custom' ? [...userDraft.value] : []);
  emit('update:excludedUserIds', [...excludedUserDraft.value]);
  emit('change');
  drawerVisible.value = false;
}

function filterDepartment(value: string) {
  departmentTreeRef.value?.filter(value);
}

function departmentMatches(value: string, data: unknown) {
  if (!value.trim()) return true;
  const keyword = value.trim().toLowerCase();
  const department = data as Partial<DepartmentTreeNode>;
  return `${department.name ?? ''} ${department.fullPath ?? ''}`.toLowerCase().includes(keyword);
}

watch(activeTab, async (value) => {
  if (value !== 'departments') return;
  await nextTick();
  departmentTreeRef.value?.setCheckedKeys(departmentDraft.value);
});
</script>

<template>
  <div class="participant-scope-picker">
    <el-radio-group :model-value="scope" :validate-event="false" @change="setScope">
      <el-radio-button data-testid="cycle-scope-all" value="all">全公司</el-radio-button>
      <el-radio-button data-testid="cycle-scope-custom" value="custom">自定义范围</el-radio-button>
    </el-radio-group>

    <button
      type="button"
      class="participant-scope-summary"
      data-testid="cycle-scope-picker-open"
      @click="openPicker"
    >
      <span data-testid="cycle-scope-summary">{{ summary }}</span>
      <strong>{{ scope === 'all' ? '设置排除人员' : '选择考核对象' }}</strong>
    </button>
  </div>

  <el-drawer
    v-model="drawerVisible"
    title="选择考核对象"
    size="620px"
    append-to-body
    destroy-on-close
  >
    <div class="scope-drawer-content">
      <el-alert
        :title="scope === 'all' ? '当前覆盖全公司，可设置不参与人员' : '部门和指定人员取并集，排除人员优先'"
        type="info"
        :closable="false"
        show-icon
      />

      <el-tabs v-model="activeTab" class="scope-tabs">
        <el-tab-pane v-if="scope === 'custom'" label="按部门" name="departments">
          <el-input
            v-model="departmentKeyword"
            clearable
            placeholder="搜索部门"
            @input="filterDepartment"
          />
          <div class="department-tree-panel" data-testid="cycle-scope-department-tree">
            <el-tree
              ref="departmentTreeRef"
              :data="departmentTree"
              :props="treeProps"
              node-key="id"
              show-checkbox
              default-expand-all
              :filter-node-method="departmentMatches"
              @check="syncDepartmentDraft"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane v-if="scope === 'custom'" label="按人员" name="users">
          <div class="people-picker-panel" data-testid="cycle-scope-user-select">
            <p>可补充不在所选部门内的员工。</p>
            <UserSelect
              :model-value="userDraft"
              multiple
              :disabled-ids="excludedUserDraft"
              placeholder="按姓名或工号搜索并选择人员"
              @update:model-value="updateUserDraft"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane label="排除人员" name="excluded">
          <div class="people-picker-panel" data-testid="cycle-scope-excluded-select">
            <p>
              {{ scope === 'all'
                ? '被排除人员将标记为本周期豁免，不进入考核流程；系统会保留豁免记录，并通知本人及主管。'
                : '排除优先于部门和单独选择的人员；系统会保留豁免记录，并通知本人及主管。' }}
            </p>
            <UserSelect
              :model-value="excludedUserDraft"
              multiple
              :disabled-ids="userDraft"
              placeholder="按姓名或工号搜索需要排除的人员"
              @update:model-value="updateExcludedUserDraft"
            />
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <template #footer>
      <div class="scope-drawer-footer">
        <div>
          <strong>{{ draftSummary }}</strong>
          <el-button text type="primary" @click="clearCurrentTab">清空当前</el-button>
        </div>
        <div>
          <el-button @click="drawerVisible = false">取消</el-button>
          <el-button type="primary" @click="applySelection">确定</el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.participant-scope-picker {
  display: grid;
  gap: 8px;
  width: 100%;
}

.participant-scope-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 9px 12px;
  color: var(--el-text-color-regular);
  font: inherit;
  text-align: left;
  cursor: pointer;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 7px;
}

.participant-scope-summary:hover {
  border-color: var(--el-color-primary-light-5);
}

.participant-scope-summary strong {
  flex: none;
  color: var(--el-color-primary);
  font-size: 13px;
}

.scope-drawer-content {
  display: grid;
  gap: 16px;
}

.scope-tabs {
  min-height: 360px;
}

.department-tree-panel {
  height: 320px;
  margin-top: 12px;
  padding: 8px;
  overflow: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.people-picker-panel {
  display: grid;
  gap: 12px;
}

.people-picker-panel p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.scope-drawer-footer,
.scope-drawer-footer > div {
  display: flex;
  align-items: center;
}

.scope-drawer-footer {
  justify-content: space-between;
  gap: 16px;
}

.scope-drawer-footer > div {
  gap: 8px;
}

@media (max-width: 640px) {
  .participant-scope-summary,
  .scope-drawer-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .scope-drawer-footer > div:last-child {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}
</style>
