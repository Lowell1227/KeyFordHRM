<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Plus,
  EditPen,
  Delete,
  Aim,
  RefreshRight,
  List,
  Grid,
} from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useAuthStore } from '@/stores/auth.store';
import { actionItemsApi } from '@/api/action-items.api';
import { objectivesApi } from '@/api/objectives.api';
import { usersApi } from '@/api/users.api';
import {
  ACTION_ITEM_STATUS_META,
  type ActionItemStatus,
} from '@/types/enums';
import type {
  ActionItem,
  Objective,
  User,
  CreateActionItemBody,
} from '@/types/api.types';
import EmptyState from '@/components/common/EmptyState.vue';
import PerformanceWorkspace from '@/components/performance/PerformanceWorkspace.vue';
import PerformanceContextPanel from '@/components/performance/PerformanceContextPanel.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

// ---------------------------------------------------------------------------
// 数据
// ---------------------------------------------------------------------------

const treeData = ref<ActionItem[]>([]);
const loading = ref(false);
const objectives = ref<Objective[]>([]);
const users = ref<User[]>([]);

const activeTab = ref<'list' | 'kanban'>('list');
const objectiveKeyword = ref('');

const filters = reactive<{
  objectiveId: string;
  status: ActionItemStatus | '';
  assigneeId: string;
}>({
  objectiveId: (route.query.objectiveId as string) || '',
  status: '',
  assigneeId: '',
});

const selectedObjective = computed(
  () => objectives.value.find((o) => o.id === filters.objectiveId) ?? null,
);

const filteredObjectives = computed(() => {
  const keyword = objectiveKeyword.value.trim().toLowerCase();
  if (!keyword) return objectives.value;
  return objectives.value.filter((objective) =>
    [objective.title, objective.ownerName, objective.deptName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword)),
  );
});

/** 仅管理者可写：vp/chairman 等只读角色隐藏所有增改删入口，得到纯只读视图。 */
const canManage = computed(() =>
  ['system_admin', 'hr', 'dept_head', 'manager'].includes(auth.user?.sysRole ?? ''),
);

const statusOptions: ActionItemStatus[] = ['todo', 'in_progress', 'done', 'blocked'];

const kanbanColumns: { status: ActionItemStatus; label: string }[] = [
  { status: 'todo', label: '待办' },
  { status: 'in_progress', label: '进行中' },
  { status: 'done', label: '已完成' },
  { status: 'blocked', label: '阻塞' },
];

function matchesFilters(item: ActionItem): boolean {
  const statusMatches = !filters.status || item.status === filters.status;
  const assigneeMatches = !filters.assigneeId || item.assigneeId === filters.assigneeId;
  return statusMatches && assigneeMatches;
}

function filterTree(nodes: ActionItem[]): ActionItem[] {
  return nodes.flatMap((item) => {
    const children = filterTree(item.children ?? []);
    if (!matchesFilters(item) && children.length === 0) return [];
    return [{ ...item, children }];
  });
}

const filteredTreeData = computed<ActionItem[]>(() => filterTree(treeData.value));

/** 筛选后的平铺列表（用于看板，层级父节点只作为列表上下文保留）。 */
const flatItems = computed<ActionItem[]>(() => {
  const result: ActionItem[] = [];
  const walk = (nodes: ActionItem[]) => {
    nodes.forEach((n) => {
      if (matchesFilters(n)) result.push(n);
      if (n.children) walk(n.children);
    });
  };
  walk(filteredTreeData.value);
  return result;
});

const kanbanByStatus = computed<Record<ActionItemStatus, ActionItem[]>>(() => {
  const map: Record<ActionItemStatus, ActionItem[]> = {
    todo: [],
    in_progress: [],
    done: [],
    blocked: [],
  };
  flatItems.value.forEach((item) => {
    map[item.status].push(item);
  });
  return map;
});

// ---------------------------------------------------------------------------
// 加载
// ---------------------------------------------------------------------------

onMounted(async () => {
  await loadObjectives();
  await loadUsers();
  if (!filters.objectiveId && objectives.value.length > 0) {
    chooseObjective(objectives.value[0].id);
  } else if (filters.objectiveId) {
    loadTree();
  }
});

watch(() => filters.objectiveId, (val) => {
  if (val) loadTree();
  else treeData.value = [];
});

async function loadTree() {
  if (!filters.objectiveId) return;
  loading.value = true;
  try {
    treeData.value = await actionItemsApi.getTree(filters.objectiveId);
  } catch {
    treeData.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadObjectives() {
  try {
    const res = await objectivesApi.findAll({ flat: true, pageSize: 100 });
    objectives.value = Array.isArray(res) ? res : (res as { items: Objective[] }).items;
  } catch {
    objectives.value = [];
  }
}

function chooseObjective(objectiveId: string) {
  filters.objectiveId = objectiveId;
  router.replace({ query: { ...route.query, objectiveId: objectiveId || undefined } });
}

async function loadUsers() {
  try {
    const u = auth.user;
    if (!u) return;
    // 行动计划对所有角色开放，员工也能建并指派给自己；按角色取可分配人选，避免越权 403。
    if (u.sysRole === 'manager' && u.id) {
      const subs = await usersApi.getSubordinates(u.id);
      users.value = [...subs, u as User];
    } else if (u.sysRole === 'hr' || u.sysRole === 'system_admin') {
      const res = await usersApi.findAll({ page: 1, pageSize: 100 });
      users.value = res.items;
    } else {
      users.value = [u as User];
    }
  } catch {
    users.value = [];
  }
}

// ---------------------------------------------------------------------------
// 表单弹窗
// ---------------------------------------------------------------------------

const dialogVisible = ref(false);
const dialogTitle = ref('新建行动项');
const editingId = ref<string | null>(null);
const submitting = ref(false);

interface ActionItemForm {
  title: string;
  description: string;
  assigneeId: string | undefined;
  startDate: string | undefined;
  dueDate: string | undefined;
  status: ActionItemStatus;
  parentId: string | undefined;
  progress: number;
}

const form = reactive<ActionItemForm>({
  title: '',
  description: '',
  assigneeId: undefined,
  startDate: undefined,
  dueDate: undefined,
  status: 'todo',
  parentId: undefined,
  progress: 0,
});

/** 当前目标下所有顶层行动项（可作为父任务）。 */
const availableParents = computed<ActionItem[]>(() => {
  const list: ActionItem[] = [];
  treeData.value.forEach((n) => {
    if (n.id !== editingId.value) list.push(n);
  });
  return list;
});

function openCreate(parentId?: string) {
  editingId.value = null;
  dialogTitle.value = parentId ? '新建子任务' : '新建行动项';
  resetForm();
  if (parentId) form.parentId = parentId;
  dialogVisible.value = true;
}

function openEdit(item: ActionItem) {
  editingId.value = item.id;
  dialogTitle.value = '编辑行动项';
  form.title = item.title;
  form.description = item.description ?? '';
  form.assigneeId = item.assigneeId ?? undefined;
  form.startDate = item.startDate ?? undefined;
  form.dueDate = item.dueDate ?? undefined;
  form.status = item.status;
  form.parentId = item.parentId ?? undefined;
  form.progress = item.progress;
  dialogVisible.value = true;
}

function resetForm() {
  form.title = '';
  form.description = '';
  form.assigneeId = undefined;
  form.startDate = undefined;
  form.dueDate = undefined;
  form.status = 'todo';
  form.parentId = undefined;
  form.progress = 0;
}

async function submitForm() {
  if (!form.title.trim()) {
    ElMessage.warning('请输入行动项标题');
    return;
  }
  if (!filters.objectiveId) {
    ElMessage.warning('请先选择目标');
    return;
  }

  submitting.value = true;
  try {
    if (editingId.value) {
      const body: Parameters<typeof actionItemsApi.update>[1] = {
        title: form.title.trim(),
        description: form.description || undefined,
        assigneeId: form.assigneeId,
        startDate: form.startDate,
        dueDate: form.dueDate,
        status: form.status,
        parentId: form.parentId,
        progress: form.progress,
      };
      await actionItemsApi.update(editingId.value, body);
      ElMessage.success('行动项已更新');
    } else {
      const body: CreateActionItemBody = {
        objectiveId: filters.objectiveId,
        title: form.title.trim(),
        description: form.description || undefined,
        assigneeId: form.assigneeId,
        startDate: form.startDate,
        dueDate: form.dueDate,
        status: form.status,
        parentId: form.parentId,
        progress: form.progress,
      };
      await actionItemsApi.create(body);
      ElMessage.success('行动项已创建');
    }
    dialogVisible.value = false;
    loadTree();
  } finally {
    submitting.value = false;
  }
}

// ---------------------------------------------------------------------------
// 进度更新
// ---------------------------------------------------------------------------

const progressDialogVisible = ref(false);
const progressItem = ref<ActionItem | null>(null);
const progressValue = ref(0);
const progressSubmitting = ref(false);

function openProgress(item: ActionItem) {
  progressItem.value = item;
  progressValue.value = item.progress;
  progressDialogVisible.value = true;
}

async function submitProgress() {
  if (!progressItem.value) return;
  progressSubmitting.value = true;
  try {
    await actionItemsApi.updateProgress(progressItem.value.id, { progress: progressValue.value });
    ElMessage.success('进度已更新');
    progressDialogVisible.value = false;
    loadTree();
  } finally {
    progressSubmitting.value = false;
  }
}

// ---------------------------------------------------------------------------
// 状态快捷切换（看板用）
// ---------------------------------------------------------------------------

async function changeStatus(item: ActionItem, status: ActionItemStatus) {
  try {
    await actionItemsApi.update(item.id, { status });
    ElMessage.success('状态已更新');
    loadTree();
  } catch {
    ElMessage.error('更新失败');
  }
}

// ---------------------------------------------------------------------------
// 删除
// ---------------------------------------------------------------------------

async function removeItem(item: ActionItem) {
  try {
    await ElMessageBox.confirm('确定删除该行动项吗？', '删除确认', { type: 'warning' });
    await actionItemsApi.remove(item.id);
    ElMessage.success('已删除');
    loadTree();
  } catch {
    // 取消
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function statusLabel(status: ActionItemStatus): string {
  return ACTION_ITEM_STATUS_META[status]?.label ?? status;
}

function statusType(status: ActionItemStatus): string {
  return ACTION_ITEM_STATUS_META[status]?.type ?? 'info';
}

function dueDateClass(item: ActionItem): string {
  if (!item.dueDate || item.status === 'done') return '';
  const today = new Date().toISOString().slice(0, 10);
  if (item.dueDate < today) return 'overdue';
  return '';
}

function dueDateDisplay(date: string | null): string {
  if (!date) return '-';
  return date;
}
</script>

<template>
  <PerformanceWorkspace title="目标跟进" active-section="tracking">
    <template #toolbar>
      <el-button
        v-if="canManage"
        type="primary"
        :icon="Plus"
        :disabled="!filters.objectiveId"
        data-testid="action-item-create"
        @click="openCreate()"
      >
        新建行动项
      </el-button>
    </template>

    <template #context>
      <PerformanceContextPanel title="目标列表">
        <div data-testid="tracking-context" class="tracking-context">
          <el-input
            v-model="objectiveKeyword"
            data-testid="tracking-objective-search"
            placeholder="搜索目标"
            clearable
          />

          <div class="tracking-context__list">
            <button
              v-for="objective in filteredObjectives"
              :key="objective.id"
              type="button"
              :class="[
                'objective-context-item',
                { 'is-active': objective.id === filters.objectiveId },
              ]"
              :aria-pressed="objective.id === filters.objectiveId"
              @click="chooseObjective(objective.id)"
            >
              <span class="objective-context-item__title">{{ objective.title }}</span>
              <span class="objective-context-item__meta">
                {{ objective.ownerName || objective.deptName || '未指定负责人' }}
                <span>{{ objective.progress }}%</span>
              </span>
            </button>

            <div v-if="filteredObjectives.length === 0" class="tracking-context__empty">
              暂无可跟进目标
            </div>
          </div>
        </div>
      </PerformanceContextPanel>
    </template>

    <div class="action-items-view page-stack">
      <section data-testid="tracking-surface" class="performance-surface">
        <div class="tracking-surface__header">
          <div class="tracking-surface__summary">
            <span class="tracking-surface__eyebrow">当前目标</span>
            <strong>{{ selectedObjective?.title || '请选择目标' }}</strong>
            <el-progress
              v-if="selectedObjective"
              :percentage="selectedObjective.progress"
              :stroke-width="7"
              class="tracking-surface__progress"
            />
          </div>

          <div class="tracking-surface__controls">
            <el-select
              v-model="filters.status"
              data-testid="tracking-status-filter"
              placeholder="全部状态"
              clearable
              class="status-filter"
            >
              <el-option
                v-for="status in statusOptions"
                :key="status"
                :label="statusLabel(status)"
                :value="status"
              />
            </el-select>
            <el-select
              v-model="filters.assigneeId"
              data-testid="tracking-assignee-filter"
              placeholder="全部负责人"
              clearable
              class="assignee-filter"
            >
              <el-option
                v-for="user in users"
                :key="user.id"
                :label="user.name"
                :value="user.id"
              />
            </el-select>
            <el-button :icon="RefreshRight" @click="loadTree">刷新</el-button>
        <el-radio-group v-model="activeTab" size="small">
          <el-radio-button value="list">
            <el-icon><List /></el-icon> 列表
          </el-radio-button>
          <el-radio-button value="kanban">
            <el-icon><Grid /></el-icon> 看板
          </el-radio-button>
        </el-radio-group>
          </div>
        </div>

      <!-- 列表视图 -->
      <el-table
        v-if="activeTab === 'list'"
        v-loading="loading"
        class="app-table"
        :data="filteredTreeData"
        row-key="id"
        default-expand-all
        :tree-props="{ children: 'children' }"
      >
        <el-table-column label="行动项" min-width="260">
          <template #default="{ row }">
            <div class="item-title-row">
              <el-tag v-if="(row as ActionItem).parentId" size="small" type="info" effect="plain">
                子任务
              </el-tag>
              <span class="item-title">{{ (row as ActionItem).title }}</span>
            </div>
            <div v-if="(row as ActionItem).description" class="item-desc">
              {{ (row as ActionItem).description }}
            </div>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag
              :type="statusType((row as ActionItem).status) as any"
              size="small"
            >
              {{ statusLabel((row as ActionItem).status) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="负责人" width="120">
          <template #default="{ row }">
            {{ (row as ActionItem).assigneeName || '-' }}
          </template>
        </el-table-column>

        <el-table-column label="起止日期" width="200">
          <template #default="{ row }">
            <div :class="['date-cell', dueDateClass(row as ActionItem)]">
              <span>{{ dueDateDisplay((row as ActionItem).startDate) }}</span>
              <span v-if="(row as ActionItem).startDate || (row as ActionItem).dueDate"> → </span>
              <span>{{ dueDateDisplay((row as ActionItem).dueDate) }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="进度" width="180">
          <template #default="{ row }">
            <el-progress :percentage="(row as ActionItem).progress" :stroke-width="8" />
          </template>
        </el-table-column>

        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canManage" link type="primary" :icon="EditPen" size="small" @click="openEdit(row as ActionItem)">
              编辑
            </el-button>
            <el-button v-if="canManage" link type="primary" :icon="Aim" size="small" @click="openProgress(row as ActionItem)">
              进度
            </el-button>
            <el-button
              v-if="canManage && !(row as ActionItem).parentId"
              link
              type="success"
              :icon="Plus"
              size="small"
              @click="openCreate((row as ActionItem).id)"
            >
              子任务
            </el-button>
            <el-button v-if="canManage" link type="danger" :icon="Delete" size="small" @click="removeItem(row as ActionItem)">
              删除
            </el-button>
            <span v-if="!canManage" class="readonly-dash">—</span>
          </template>
        </el-table-column>
      </el-table>

      <EmptyState
        v-if="activeTab === 'list' && !loading && filteredTreeData.length === 0"
        :description="filters.objectiveId
          ? (filters.status || filters.assigneeId ? '没有符合筛选条件的行动项' : '该目标下暂无行动项，点击右上角新建')
          : '请先选择一个目标'"
      />

      <!-- 看板视图 -->
      <div v-if="activeTab === 'kanban'" v-loading="loading" class="kanban-board">
      <div
        v-for="col in kanbanColumns"
        :key="col.status"
        class="kanban-column"
      >
        <div class="kanban-col-header">
          <el-tag :type="statusType(col.status) as any" size="small">
            {{ col.label }}
          </el-tag>
          <span class="kanban-count">{{ kanbanByStatus[col.status].length }}</span>
        </div>

        <div class="kanban-cards">
          <div
            v-for="item in kanbanByStatus[col.status]"
            :key="item.id"
            class="kanban-card"
          >
            <div class="kanban-card-title">{{ item.title }}</div>
            <div v-if="item.assigneeName" class="kanban-card-meta">
              负责人：{{ item.assigneeName }}
            </div>
            <div v-if="item.dueDate" :class="['kanban-card-meta', dueDateClass(item)]">
              截止：{{ item.dueDate }}
            </div>
            <el-progress :percentage="item.progress" :stroke-width="6" class="kanban-progress" />
            <div v-if="canManage" class="kanban-card-actions">
              <el-select
                :model-value="item.status"
                size="small"
                style="width: 110px"
                @change="(s: ActionItemStatus) => changeStatus(item, s)"
              >
                <el-option
                  v-for="s in statusOptions"
                  :key="s"
                  :label="statusLabel(s)"
                  :value="s"
                />
              </el-select>
              <el-button link type="primary" size="small" :icon="EditPen" @click="openEdit(item)" />
              <el-button link type="danger" size="small" :icon="Delete" @click="removeItem(item)" />
            </div>
          </div>

          <div v-if="kanbanByStatus[col.status].length === 0" class="kanban-empty">
            暂无
          </div>
        </div>
      </div>

        <EmptyState
          v-if="!loading && flatItems.length === 0 && filters.objectiveId"
          description="该目标下暂无行动项"
          style="grid-column: 1 / -1;"
        />
      </div>
      </section>

    <!-- 新建 / 编辑弹窗 -->
    <el-dialog v-model="dialogVisible" data-testid="action-item-dialog" :title="dialogTitle" width="600px" destroy-on-close>
      <el-form :model="form" label-width="90px">
        <el-form-item label="标题" required>
          <el-input v-model="form.title" data-testid="action-item-title" placeholder="请输入行动项标题" maxlength="200" show-word-limit />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            placeholder="请输入描述"
          />
        </el-form-item>
        <el-form-item label="负责人">
          <el-select
            v-model="form.assigneeId"
            placeholder="选择负责人"
            clearable
            filterable
            style="width: 100%"
          >
            <el-option
              v-for="u in users"
              :key="u.id"
              :label="`${u.name}${u.employeeNo ? ' (' + u.employeeNo + ')' : ''}`"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="开始日期">
          <el-date-picker
            v-model="form.startDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择开始日期"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="截止日期">
          <el-date-picker
            v-model="form.dueDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择截止日期"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio-button value="todo">待办</el-radio-button>
            <el-radio-button value="in_progress">进行中</el-radio-button>
            <el-radio-button value="done">已完成</el-radio-button>
            <el-radio-button value="blocked">阻塞</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="!form.parentId || editingId" label="父任务">
          <el-select
            v-model="form.parentId"
            placeholder="（可选）选择父任务，设为子任务"
            clearable
            filterable
            style="width: 100%"
          >
            <el-option
              v-for="p in availableParents"
              :key="p.id"
              :label="p.title"
              :value="p.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="进度">
          <el-slider v-model="form.progress" :max="100" show-input style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button data-testid="action-item-save" type="primary" :loading="submitting" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>

    <!-- 进度更新弹窗 -->
    <el-dialog v-model="progressDialogVisible" title="更新进度" width="400px" destroy-on-close>
      <div v-if="progressItem" class="progress-item-title">{{ progressItem.title }}</div>
      <el-slider v-model="progressValue" :max="100" show-input />
      <template #footer>
        <el-button @click="progressDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="progressSubmitting" @click="submitProgress">
          保存
        </el-button>
      </template>
    </el-dialog>
    </div>
  </PerformanceWorkspace>
</template>

<style scoped>
.action-items-view {
  min-width: 0;
  min-height: 100%;
  padding: 16px;
}

.tracking-context {
  min-width: 0;
}

.tracking-context__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
}

.objective-context-item {
  width: 100%;
  min-width: 0;
  min-height: 58px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  color: #30384b;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.objective-context-item:hover {
  background: #f2f6fc;
}

.objective-context-item.is-active {
  color: #155cc3;
  background: #e6f2ff;
}

.objective-context-item__title {
  width: 100%;
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.objective-context-item__meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #7b8495;
  font-size: 12px;
}

.tracking-context__empty {
  padding: 28px 8px;
  color: #8c95a5;
  font-size: 13px;
  text-align: center;
}

.performance-surface {
  min-width: 0;
  min-height: 500px;
  overflow: hidden;
  background: #fff;
  border: 1px solid #e2e6ed;
  border-radius: 7px;
}

.tracking-surface__header {
  min-height: 68px;
  display: flex;
  align-items: stretch;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid #e8ebf0;
}

.tracking-surface__summary {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.tracking-surface__summary strong {
  max-width: 300px;
  overflow: hidden;
  color: #20283a;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tracking-surface__eyebrow {
  flex-shrink: 0;
  color: #7b8495;
  font-size: 12px;
}

.tracking-surface__progress {
  width: 150px;
}

.tracking-surface__controls {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.status-filter {
  width: 130px;
}

.assignee-filter {
  width: 150px;
}

.performance-surface :deep(.el-table) {
  border: 0;
  border-radius: 0;
}

.item-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.item-title {
  font-weight: 500;
}

.item-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.readonly-dash {
  color: var(--el-text-color-placeholder);
}

.date-cell {
  font-size: 13px;
}

.date-cell.overdue {
  color: var(--el-color-danger);
  font-weight: 500;
}

/* 看板 */
.kanban-board {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  align-items: start;
}

.kanban-column {
  background: var(--el-fill-color-light);
  border-radius: 8px;
  padding: 12px;
  min-height: 200px;
}

.kanban-col-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.kanban-count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  border-radius: 10px;
  padding: 0 8px;
  line-height: 20px;
}

.kanban-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.kanban-card {
  background: #fff;
  border-radius: 6px;
  padding: 10px 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.kanban-card-title {
  font-weight: 500;
  font-size: 13px;
  margin-bottom: 6px;
  line-height: 1.4;
  word-break: break-word;
}

.kanban-card-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}

.kanban-card-meta.overdue {
  color: var(--el-color-danger);
}

.kanban-progress {
  margin-bottom: 8px;
}

.kanban-card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.kanban-empty {
  text-align: center;
  color: var(--el-text-color-placeholder);
  font-size: 12px;
  padding: 20px 0;
}

.progress-item-title {
  margin-bottom: 16px;
  font-weight: 500;
}

@media (max-width: 768px) {
  .action-items-view {
    min-height: auto;
    padding: 10px;
  }

  .tracking-context__list {
    flex-direction: row;
    overflow-x: auto;
  }

  .objective-context-item {
    width: 210px;
    min-width: 210px;
  }

  .tracking-surface__header {
    align-items: stretch;
    flex-direction: column;
  }

  .tracking-surface__summary,
  .tracking-surface__controls {
    width: 100%;
  }

  .tracking-surface__summary {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .tracking-surface__controls {
    justify-content: flex-start;
    overflow-x: auto;
  }

  .tracking-surface__progress {
    width: 100%;
  }

  .performance-surface {
    min-height: 420px;
    overflow-x: auto;
  }

  .kanban-board {
    min-width: 880px;
  }
}
</style>
