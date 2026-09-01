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
  excludedDepartmentIds: string[];
  excludedUserIds: string[];
}>();

const emit = defineEmits<{
  'update:scope': [value: ParticipantScopeMode];
  'update:departmentIds': [value: string[]];
  'update:userIds': [value: string[]];
  'update:excludedDepartmentIds': [value: string[]];
  'update:excludedUserIds': [value: string[]];
  change: [];
}>();

const drawerVisible = ref(false);
const activeTab = ref<'departments' | 'users'>('departments');
const departmentKeyword = ref('');
const departmentDraft = ref<string[]>([]);
const userDraft = ref<string[]>([]);

type DepartmentTreeRef = {
  filter: (value: string) => void;
  getCheckedKeys: (leafOnly?: boolean) => Array<string | number>;
  setCheckedKeys: (keys: string[]) => void;
};

const departmentTreeRef = ref<DepartmentTreeRef | null>(null);
const treeProps = { label: 'name', children: 'children', disabled: 'disabled' };

const departmentTree = computed<DepartmentTreeNode[]>(() => {
  const sortNodes = (items: DepartmentTreeNode[]) => {
    items.sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
    items.forEach((item) => sortNodes(item.children));
  };
  const cloneNestedNodes = (items: Department[], parentId?: string): DepartmentTreeNode[] => items.map((department) => ({
    ...department,
    parentId: department.parentId ?? parentId,
    disabled: department.isActive === false,
    children: cloneNestedNodes(department.children ?? [], department.id),
  }));

  if (props.departments.some((department) => (department.children?.length ?? 0) > 0)) {
    const nodes = cloneNestedNodes(props.departments);
    sortNodes(nodes);
    return nodes;
  }

  const nodes = new Map<string, DepartmentTreeNode>();
  const roots: DepartmentTreeNode[] = [];
  props.departments.forEach((department) => nodes.set(department.id, {
    ...department,
    disabled: department.isActive === false,
    children: [],
  }));
  nodes.forEach((node) => {
    if (node.parentId && nodes.has(node.parentId)) nodes.get(node.parentId)!.children.push(node);
    else roots.push(node);
  });
  sortNodes(roots);
  return roots;
});

const departmentById = computed(() => {
  const result = new Map<string, DepartmentTreeNode>();
  const visit = (nodes: DepartmentTreeNode[]) => nodes.forEach((node) => {
    result.set(node.id, node);
    visit(node.children);
  });
  visit(departmentTree.value);
  return result;
});

const selectableDepartmentIds = computed(() => [...departmentById.value.values()]
  .filter((department) => !department.disabled)
  .map((department) => department.id));

const uniqueIds = (ids: string[]) => [...new Set(ids)];

function departmentSelection(ids: string[]) {
  const selectedIds = uniqueIds(ids).filter((id) => departmentById.value.has(id));
  const selected = new Set(selectedIds);
  const rootIds = selectedIds.filter((id) => {
    let parentId = departmentById.value.get(id)?.parentId;
    while (parentId) {
      if (selected.has(parentId)) return false;
      parentId = departmentById.value.get(parentId)?.parentId;
    }
    return true;
  });
  return { ids: selectedIds, rootIds };
}

function expandDepartmentSelection(ids: string[]) {
  const result = new Set<string>();
  const visit = (id: string) => {
    const department = departmentById.value.get(id);
    if (!department || department.disabled || result.has(id)) return;
    result.add(id);
    department.children.forEach((child) => visit(child.id));
  };
  departmentSelection(ids).rootIds.forEach(visit);
  return [...result];
}

function selectedDepartmentIds(
  scope: ParticipantScopeMode,
  departmentIds: string[],
  excludedDepartmentIds: string[],
) {
  if (scope === 'custom') {
    const excluded = new Set(expandDepartmentSelection(excludedDepartmentIds));
    return expandDepartmentSelection(departmentIds).filter((id) => !excluded.has(id));
  }
  const excluded = new Set(expandDepartmentSelection(excludedDepartmentIds));
  return selectableDepartmentIds.value.filter((id) => !excluded.has(id));
}

function countMembers(ids: string[]) {
  return uniqueIds(ids).reduce(
    (total, id) => total + (departmentById.value.get(id)?.directMemberCount ?? 0),
    0,
  );
}

function buildSummary(departmentIds: string[], userIds: string[]) {
  const selection = departmentSelection(departmentIds);
  const allSelected = selectableDepartmentIds.value.length > 0
    && selectableDepartmentIds.value.every((id) => departmentIds.includes(id));
  const departmentCopy = allSelected ? '已选择全部部门' : `已选择 ${selection.rootIds.length} 个部门`;
  return `${departmentCopy}，共 ${countMembers(departmentIds) + userIds.length} 人`;
}

const selectedDepartments = computed(() => selectedDepartmentIds(
  props.scope,
  props.departmentIds,
  props.excludedDepartmentIds,
));
const summary = computed(() => buildSummary(selectedDepartments.value, props.userIds));
const draftSummary = computed(() => buildSummary(departmentDraft.value, userDraft.value));

async function openPicker() {
  departmentDraft.value = [...selectedDepartments.value];
  userDraft.value = [...props.userIds];
  departmentKeyword.value = '';
  activeTab.value = 'departments';
  drawerVisible.value = true;
  await nextTick();
  departmentTreeRef.value?.setCheckedKeys(departmentDraft.value);
}

function syncDepartmentDraft() {
  departmentDraft.value = uniqueIds(
    (departmentTreeRef.value?.getCheckedKeys(false) ?? []).map(String),
  );
}

function updateUserDraft(value: string | string[] | undefined) {
  userDraft.value = Array.isArray(value) ? value : value ? [value] : [];
}

function selectAllDepartments() {
  departmentDraft.value = [...selectableDepartmentIds.value];
  departmentTreeRef.value?.setCheckedKeys(departmentDraft.value);
}

function invertDepartments() {
  syncDepartmentDraft();
  const selected = new Set(departmentDraft.value);
  departmentDraft.value = selectableDepartmentIds.value.filter((id) => !selected.has(id));
  departmentTreeRef.value?.setCheckedKeys(departmentDraft.value);
}

function clearDepartments() {
  departmentDraft.value = [];
  departmentTreeRef.value?.setCheckedKeys([]);
}

function applySelection() {
  syncDepartmentDraft();
  const expanded = expandDepartmentSelection(departmentDraft.value);
  const allSelected = selectableDepartmentIds.value.length > 0
    && selectableDepartmentIds.value.every((id) => expanded.includes(id));
  emit('update:scope', allSelected && userDraft.value.length === 0 ? 'all' : 'custom');
  emit('update:departmentIds', allSelected && userDraft.value.length === 0 ? [] : expanded);
  emit('update:userIds', [...userDraft.value]);
  emit('update:excludedDepartmentIds', []);
  emit('update:excludedUserIds', []);
  emit('change');
  drawerVisible.value = false;
}

function departmentMatches(value: string, data: unknown) {
  if (!value.trim()) return true;
  const keyword = value.trim().toLowerCase();
  const department = data as Partial<DepartmentTreeNode>;
  return `${department.name ?? ''} ${department.fullPath ?? ''}`.toLowerCase().includes(keyword);
}

watch(departmentKeyword, (value) => departmentTreeRef.value?.filter(value));
watch(activeTab, async (value) => {
  if (value !== 'departments') return;
  await nextTick();
  departmentTreeRef.value?.setCheckedKeys(departmentDraft.value);
});
</script>

<template>
  <div class="participant-scope-picker">
    <button
      type="button"
      class="participant-scope-toolbar"
      data-testid="cycle-scope-picker-open"
      @click="openPicker"
    >
      <strong>选择考核对象</strong>
    </button>

    <button type="button" class="participant-scope-summary" @click="openPicker">
      <span data-testid="cycle-scope-summary">{{ summary }}</span>
      <strong>查看与选择</strong>
    </button>
  </div>

  <el-drawer
    v-model="drawerVisible"
    class="cycle-scope-drawer"
    title="选择考核对象"
    size="620px"
    append-to-body
    destroy-on-close
  >
    <div class="scope-drawer-content">
      <el-alert title="勾选需要参加本周期考核的部门或人员" type="info" :closable="false" show-icon />

      <el-tabs v-model="activeTab" class="scope-tabs">
        <el-tab-pane label="按部门" name="departments">
          <div class="department-picker-toolbar">
            <el-input v-model="departmentKeyword" clearable placeholder="搜索部门" />
            <div class="department-picker-actions">
              <el-button data-testid="cycle-scope-select-all" text type="primary" @click="selectAllDepartments">全选</el-button>
              <el-button data-testid="cycle-scope-invert" text type="primary" @click="invertDepartments">反选</el-button>
              <el-button data-testid="cycle-scope-clear" text type="primary" @click="clearDepartments">清空</el-button>
            </div>
          </div>
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

        <el-tab-pane label="按人员" name="users">
          <div class="people-picker-panel" data-testid="cycle-scope-user-select">
            <p>可补充未包含在所选部门内的员工。</p>
            <UserSelect
              :model-value="userDraft"
              multiple
              placeholder="按姓名或工号搜索并选择人员"
              @update:model-value="updateUserDraft"
            />
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <template #footer>
      <div class="scope-drawer-footer">
        <strong>{{ draftSummary }}</strong>
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

.participant-scope-toolbar,
.participant-scope-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 9px 12px;
  font: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 8px;
}

.participant-scope-toolbar {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border: 0;
}

.participant-scope-summary {
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
}

.participant-scope-toolbar span,
.participant-scope-summary strong {
  flex: none;
  color: var(--el-color-primary);
  font-size: 13px;
}

.participant-scope-toolbar:hover,
.participant-scope-summary:hover {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-8);
}

.participant-scope-toolbar:focus-visible,
.participant-scope-summary:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.scope-drawer-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
}

.scope-tabs {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.scope-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
}

.scope-tabs :deep(.el-tab-pane) {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.department-picker-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.department-picker-actions {
  display: flex;
  flex: none;
}

.department-tree-panel {
  flex: 1;
  min-height: 0;
  margin-top: 12px;
  padding: 8px;
  overflow: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.people-picker-panel {
  display: grid;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
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

:global(.cycle-scope-drawer .el-drawer__body) {
  display: flex;
  min-height: 0;
  overflow: hidden;
}

@media (max-width: 640px) {
  .participant-scope-toolbar,
  .participant-scope-summary,
  .scope-drawer-footer,
  .department-picker-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .scope-drawer-footer > div:last-child {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}
</style>
