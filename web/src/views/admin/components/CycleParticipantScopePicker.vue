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
type ScopeTab = 'includedDepartments' | 'includedUsers' | 'excludedDepartments' | 'excludedUsers';

const activeTab = ref<ScopeTab>('includedDepartments');
const departmentKeyword = ref('');
const departmentDraft = ref<string[]>([]);
const userDraft = ref<string[]>([]);
const excludedDepartmentDraft = ref<string[]>([]);
const excludedUserDraft = ref<string[]>([]);
type DepartmentTreeRef = {
  filter: (value: string) => void;
  getCheckedKeys: (leafOnly?: boolean) => Array<string | number>;
  setCheckedKeys: (keys: string[]) => void;
};

const includedDepartmentTreeRef = ref<DepartmentTreeRef | null>(null);
const excludedDepartmentTreeRef = ref<DepartmentTreeRef | null>(null);

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
  const cloneNestedNodes = (items: Department[], parentId?: string): DepartmentTreeNode[] => items.map((department) => ({
    ...department,
    parentId: department.parentId ?? parentId,
    disabled: department.isActive === false,
    children: cloneNestedNodes(department.children ?? [], department.id),
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

const departmentById = computed(() => {
  const result = new Map<string, DepartmentTreeNode>();
  const visit = (items: DepartmentTreeNode[]) => {
    for (const item of items) {
      result.set(item.id, item);
      visit(item.children);
    }
  };
  visit(departmentTree.value);
  return result;
});

const uniqueIds = (ids: string[]) => [...new Set(ids)];
const countDirectMembers = (ids: string[]) => ids.reduce(
  (total, id) => total + (departmentById.value.get(id)?.directMemberCount ?? 0),
  0,
);

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
  return {
    ids: selectedIds,
    rootIds,
    descendantCount: Math.max(0, selectedIds.length - rootIds.length),
  };
}

function expandDepartmentSelection(ids: string[]) {
  const result = new Set<string>();
  const visit = (id: string) => {
    const department = departmentById.value.get(id);
    if (!department || result.has(id)) return;
    result.add(id);
    department.children.forEach((child) => visit(child.id));
  };
  departmentSelection(ids).rootIds.forEach(visit);
  return [...result];
}

const includedDepartmentSelection = computed(() => departmentSelection(departmentDraft.value));
const allowedCustomExceptionDepartmentIds = computed(() => {
  const roots = new Set(includedDepartmentSelection.value.rootIds);
  return expandDepartmentSelection(includedDepartmentSelection.value.rootIds)
    .filter((id) => !roots.has(id));
});
const customExceptionDepartmentTree = computed<DepartmentTreeNode[]>(() => {
  const allowed = new Set(allowedCustomExceptionDepartmentIds.value);
  const collect = (nodes: DepartmentTreeNode[]): DepartmentTreeNode[] => nodes.flatMap((node) => {
    const children = collect(node.children);
    return allowed.has(node.id) ? [{ ...node, children }] : children;
  });
  return collect(departmentTree.value);
});
const excludedDepartmentTree = computed(() => (
  props.scope === 'custom' ? customExceptionDepartmentTree.value : departmentTree.value
));

function departmentSummary(ids: string[], prefix: string) {
  const selection = departmentSelection(ids);
  const descendants = selection.descendantCount > 0
    ? `，包含 ${selection.descendantCount} 个下级组织`
    : '';
  return `${prefix}${selection.rootIds.length} 个部门${descendants}（预计 ${countDirectMembers(selection.ids)} 人）`;
}

function buildSummary(
  scope: ParticipantScopeMode,
  departmentIds: string[],
  userIds: string[],
  excludedDepartmentIds: string[],
  excludedUserIds: string[],
) {
  const parts = scope === 'all'
    ? ['全公司']
    : [departmentSummary(departmentIds, '已选 '), `另选 ${userIds.length} 人`];
  if (scope === 'all' && excludedDepartmentIds.length > 0) {
    parts.push(departmentSummary(excludedDepartmentIds, '排除 '));
  }
  if (scope === 'all' && excludedUserIds.length > 0) {
    parts.push(`${excludedDepartmentIds.length > 0 ? '另排除' : '排除'} ${excludedUserIds.length} 人`);
  }
  if (scope === 'custom' && (excludedDepartmentIds.length > 0 || excludedUserIds.length > 0)) {
    const exceptionParts: string[] = [];
    if (excludedDepartmentIds.length > 0) {
      const exceptionSelection = departmentSelection(excludedDepartmentIds);
      const descendants = exceptionSelection.descendantCount > 0
        ? `（包含 ${exceptionSelection.descendantCount} 个更下级组织）`
        : '';
      exceptionParts.push(`${exceptionSelection.rootIds.length} 个下级组织${descendants}`);
    }
    if (excludedUserIds.length > 0) exceptionParts.push(`${excludedUserIds.length} 人`);
    parts.push(`排除例外：${exceptionParts.join('、')}`);
  }
  if (scope === 'custom') {
    const estimatedParticipants = Math.max(
      0,
      countDirectMembers(departmentIds) + userIds.length
        - countDirectMembers(excludedDepartmentIds) - excludedUserIds.length,
    );
    parts.push(`预计参评 ${estimatedParticipants} 人`);
  }
  return parts.join(' · ');
}

const summary = computed(() => buildSummary(
  props.scope,
  props.departmentIds,
  props.userIds,
  props.excludedDepartmentIds,
  props.excludedUserIds,
));

const visibleSummary = computed(() => (
  props.scope === 'all'
    ? summary.value.replace(/^全公司(?: · )?/, '')
    : summary.value
));

const draftSummary = computed(() => buildSummary(
  props.scope,
  departmentDraft.value,
  userDraft.value,
  excludedDepartmentDraft.value,
  excludedUserDraft.value,
));

function setScope(value: string | number | boolean | undefined) {
  if (value !== 'all' && value !== 'custom') return;
  emit('update:scope', value);
  if (value === 'all') {
    emit('update:departmentIds', []);
    emit('update:userIds', []);
  }
  emit('update:excludedDepartmentIds', []);
  emit('update:excludedUserIds', []);
  emit('change');
}

async function openPicker() {
  departmentDraft.value = props.scope === 'custom'
    ? expandDepartmentSelection(props.departmentIds)
    : [];
  userDraft.value = [...props.userIds];
  const allowedExceptionIds = new Set(allowedCustomExceptionDepartmentIds.value);
  excludedDepartmentDraft.value = uniqueIds(props.excludedDepartmentIds)
    .filter((id) => props.scope === 'all' || allowedExceptionIds.has(id));
  excludedUserDraft.value = [...props.excludedUserIds];
  departmentKeyword.value = '';
  activeTab.value = props.scope === 'all' ? 'excludedDepartments' : 'includedDepartments';
  drawerVisible.value = true;
  await nextTick();
  if (activeTab.value === 'includedDepartments') {
    includedDepartmentTreeRef.value?.setCheckedKeys(departmentDraft.value);
  } else {
    excludedDepartmentTreeRef.value?.setCheckedKeys(excludedDepartmentDraft.value);
  }
}

function syncDepartmentDraft() {
  departmentDraft.value = uniqueIds(
    (includedDepartmentTreeRef.value?.getCheckedKeys(false) ?? []).map(String),
  );
  const allowedExceptionIds = new Set(allowedCustomExceptionDepartmentIds.value);
  excludedDepartmentDraft.value = excludedDepartmentDraft.value
    .filter((id) => allowedExceptionIds.has(id));
  excludedUserDraft.value = [];
  excludedDepartmentTreeRef.value?.setCheckedKeys(excludedDepartmentDraft.value);
}

function syncExcludedDepartmentDraft() {
  excludedDepartmentDraft.value = uniqueIds(
    (excludedDepartmentTreeRef.value?.getCheckedKeys(false) ?? []).map(String),
  );
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
  if (activeTab.value === 'includedDepartments') {
    departmentDraft.value = [];
    includedDepartmentTreeRef.value?.setCheckedKeys([]);
  } else if (activeTab.value === 'includedUsers') {
    userDraft.value = [];
  } else if (activeTab.value === 'excludedDepartments') {
    excludedDepartmentDraft.value = [];
    excludedDepartmentTreeRef.value?.setCheckedKeys([]);
  } else {
    excludedUserDraft.value = [];
  }
}

function applySelection() {
  emit('update:departmentIds', props.scope === 'custom' ? [...departmentDraft.value] : []);
  emit('update:userIds', props.scope === 'custom' ? [...userDraft.value] : []);
  emit('update:excludedDepartmentIds', [...excludedDepartmentDraft.value]);
  emit('update:excludedUserIds', [...excludedUserDraft.value]);
  emit('change');
  drawerVisible.value = false;
}

function filterDepartment(value: string) {
  if (activeTab.value === 'includedDepartments') {
    includedDepartmentTreeRef.value?.filter(value);
  } else if (activeTab.value === 'excludedDepartments') {
    excludedDepartmentTreeRef.value?.filter(value);
  }
}

function departmentMatches(value: string, data: unknown) {
  if (!value.trim()) return true;
  const keyword = value.trim().toLowerCase();
  const department = data as Partial<DepartmentTreeNode>;
  return `${department.name ?? ''} ${department.fullPath ?? ''}`.toLowerCase().includes(keyword);
}

watch(activeTab, async (value) => {
  if (value !== 'includedDepartments' && value !== 'excludedDepartments') return;
  departmentKeyword.value = '';
  await nextTick();
  if (value === 'includedDepartments') {
    includedDepartmentTreeRef.value?.setCheckedKeys(departmentDraft.value);
  } else {
    excludedDepartmentTreeRef.value?.setCheckedKeys(excludedDepartmentDraft.value);
  }
});
</script>

<template>
  <div class="participant-scope-picker">
    <div class="participant-scope-toolbar" data-testid="cycle-scope-toolbar">
      <el-radio-group :model-value="scope" :validate-event="false" @change="setScope">
        <el-radio-button data-testid="cycle-scope-all" value="all">全公司</el-radio-button>
        <el-radio-button data-testid="cycle-scope-custom" value="custom">自定义范围</el-radio-button>
      </el-radio-group>

      <button
        type="button"
        class="participant-scope-action"
        data-testid="cycle-scope-picker-open"
        @click="openPicker"
      >{{ scope === 'all' ? '设置排除范围' : '选择考核对象' }}</button>
    </div>

    <button
      v-if="visibleSummary"
      type="button"
      class="participant-scope-summary"
      @click="openPicker"
    >
      <span data-testid="cycle-scope-summary">{{ visibleSummary }}</span>
      <strong>调整</strong>
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
      <el-alert
        :title="scope === 'all' ? '当前覆盖全公司，可按部门或人员设置不参与范围' : '先选择参评部门或人员，再从已选部门内排除例外'"
        type="info"
        :closable="false"
        show-icon
      />

      <el-tabs v-model="activeTab" class="scope-tabs">
        <el-tab-pane v-if="scope === 'custom'" label="按部门" name="includedDepartments">
          <el-input
            v-model="departmentKeyword"
            clearable
            placeholder="搜索部门"
            @input="filterDepartment"
          />
          <div class="department-tree-panel" data-testid="cycle-scope-department-tree">
            <el-tree
              ref="includedDepartmentTreeRef"
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

        <el-tab-pane v-if="scope === 'custom'" label="按人员" name="includedUsers">
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

        <el-tab-pane :label="scope === 'custom' ? '例外部门' : '排除部门'" name="excludedDepartments">
          <el-input
            v-model="departmentKeyword"
            clearable
            placeholder="搜索需要排除的部门"
            @input="filterDepartment"
          />
          <p class="department-exclusion-hint">
            {{ scope === 'custom'
              ? '仅显示已选部门内的下级组织；正式人数以发起检查结果为准。'
              : '勾选父部门会同时排除其全部子部门，正式人数以发起检查结果为准。' }}
          </p>
          <div class="department-tree-panel" data-testid="cycle-scope-excluded-department-tree">
            <el-tree
              ref="excludedDepartmentTreeRef"
              :data="excludedDepartmentTree"
              :props="treeProps"
              node-key="id"
              show-checkbox
              default-expand-all
              :filter-node-method="departmentMatches"
              @check="syncExcludedDepartmentDraft"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane :label="scope === 'custom' ? '例外人员' : '排除人员'" name="excludedUsers">
          <div class="people-picker-panel" data-testid="cycle-scope-excluded-select">
            <p>
              {{ scope === 'all'
                ? '被排除人员将标记为本周期豁免，不进入考核流程；系统会保留豁免记录，并通知本人及主管。'
                : '仅可选择已选部门内的人员作为例外；系统会保留豁免记录。' }}
            </p>
            <UserSelect
              :model-value="excludedUserDraft"
              multiple
              :department-ids="scope === 'custom' ? includedDepartmentSelection.rootIds : undefined"
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

.participant-scope-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 3px;
  background: var(--el-color-primary-light-9);
  border-radius: 8px;
}

.participant-scope-action {
  flex: none;
  padding: 7px 10px;
  color: var(--el-color-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
}

.participant-scope-action:hover {
  background: rgb(255 255 255 / 70%);
}

.participant-scope-action:focus-visible,
.participant-scope-summary:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
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

.department-exclusion-hint {
  margin: 10px 0 0;
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
  .scope-drawer-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .participant-scope-action {
    text-align: left;
  }

  .scope-drawer-footer > div:last-child {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}
</style>
