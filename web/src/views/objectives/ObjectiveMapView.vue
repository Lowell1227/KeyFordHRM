<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Plus,
  Delete,
  Aim,
  List,
} from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useAuthStore } from '@/stores/auth.store';
import { objectivesApi } from '@/api/objectives.api';
import { departmentsApi } from '@/api/departments.api';
import { cyclesApi } from '@/api/cycles.api';
import { indicatorsApi } from '@/api/indicators.api';
import { usersApi } from '@/api/users.api';
import {
  OBJECTIVE_LEVEL_LABELS,
  OBJECTIVE_STATUS_META,
  type ObjectiveLevel,
  type ObjectiveStatus,
} from '@/types/enums';
import type {
  Objective,
  Department,
  AssessmentCycle,
  Indicator,
  User,
  CreateObjectiveBody,
} from '@/types/api.types';
import PerformanceWorkspace from '@/components/performance/PerformanceWorkspace.vue';
import ObjectiveMapFilters from './components/ObjectiveMapFilters.vue';
import ObjectiveMapDisplaySettings from './components/ObjectiveMapDisplaySettings.vue';
import ObjectiveMapCanvas from './components/ObjectiveMapCanvas.vue';
import {
  countObjectivesByScope,
  layoutObjectives,
  selectObjectiveScope,
  type ObjectiveMapActorContext,
  type ObjectiveMapScope,
} from './objective-map-layout';
import {
  OBJECTIVE_MAP_DISPLAY_STORAGE_KEY,
  parseObjectiveMapDisplay,
  saveObjectiveMapDisplay,
} from './objective-map-settings';

const auth = useAuthStore();
const router = useRouter();

const treeData = ref<Objective[]>([]);
const loading = ref(false);
const cycles = ref<AssessmentCycle[]>([]);
const departments = ref<Department[]>([]);
const indicators = ref<Indicator[]>([]);
const users = ref<User[]>([]);
const directReports = ref<User[]>([]);

const filters = reactive<{ cycleId: string }>({
  cycleId: '',
});
const selectedScope = ref<ObjectiveMapScope>('team');
const selectedObjective = ref<Objective | null>(null);
const detailVisible = ref(false);
const loadError = ref('');
const display = ref(parseObjectiveMapDisplay(
  typeof window === 'undefined'
    ? null
    : window.localStorage.getItem(OBJECTIVE_MAP_DISPLAY_STORAGE_KEY),
));

const canManage = computed(() =>
  ['system_admin', 'hr', 'dept_head', 'manager'].includes(auth.user?.sysRole ?? ''),
);

function defaultLevelForCreate(): ObjectiveLevel {
  const role = auth.user?.sysRole;
  if (role === 'manager') return 'individual';
  if (role === 'dept_head') return 'department';
  return 'company';
}

onMounted(async () => {
  // 部门/指标/用户列表仅用于「新建·编辑目标」弹窗，普通员工无管理权限、不会打开弹窗，
  // 因此不预加载——既省请求，也避免触发越权 403。
  if (canManage.value) {
    await Promise.all([loadDepartments(), loadIndicators(), loadUsers(), loadCycles()]);
  } else {
    await loadCycles();
  }
  await loadTree();
});

watch(() => filters.cycleId, loadTree);
watch(display, (value) => saveObjectiveMapDisplay(value), { deep: true });

async function loadTree() {
  loading.value = true;
  loadError.value = '';
  try {
    const params: Record<string, unknown> = {};
    if (filters.cycleId) params.cycleId = filters.cycleId;
    const res = await objectivesApi.findAll(params);
    treeData.value = Array.isArray(res) ? res : res.items;
  } catch {
    treeData.value = [];
    loadError.value = '目标数据加载失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

async function loadCycles() {
  try {
    const res = await cyclesApi.findAll({ page: 1, pageSize: 100 });
    cycles.value = res.items;
  } catch {
    cycles.value = [];
  }
}

async function loadDepartments() {
  try {
    departments.value = await departmentsApi.findAll({});
  } catch {
    departments.value = [];
  }
}

async function loadIndicators() {
  try {
    const res = await indicatorsApi.findAll({ page: 1, pageSize: 100 });
    indicators.value = res.items;
  } catch {
    indicators.value = [];
  }
}

async function loadUsers() {
  try {
    const u = auth.user;
    if (!u) return;
    // 主管看下属、HR/管理员看全员、其余角色至少能选到自己——按角色取可分配人选，避免越权 403。
    if (u.sysRole === 'manager' && u.id) {
      const subs = await usersApi.getSubordinates(u.id);
      directReports.value = subs;
      users.value = [...subs, u as User];
    } else if (u.sysRole === 'hr' || u.sysRole === 'system_admin') {
      const res = await usersApi.findAll({ page: 1, pageSize: 100 });
      users.value = res.items;
    } else {
      users.value = [u as User];
    }
  } catch {
    directReports.value = [];
    users.value = [];
  }
}

function flattenDepartments(items: readonly Department[]): Department[] {
  return items.flatMap((department) => [
    department,
    ...flattenDepartments(department.children ?? []),
  ]);
}

const managedDepartmentIds = computed(() => {
  const currentUserId = auth.user?.id;
  if (!currentUserId) return [];
  const flat = flattenDepartments(departments.value);
  const childrenByParent = new Map<string, Department[]>();
  flat.forEach((department) => {
    if (!department.parentId) return;
    const children = childrenByParent.get(department.parentId) ?? [];
    children.push(department);
    childrenByParent.set(department.parentId, children);
  });
  const ids = new Set(flat.filter((department) => department.leaderId === currentUserId).map((department) => department.id));
  const appendChildren = (departmentId: string) => {
    for (const child of childrenByParent.get(departmentId) ?? []) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      appendChildren(child.id);
    }
  };
  [...ids].forEach(appendChildren);
  return [...ids];
});

const actorContext = computed<ObjectiveMapActorContext>(() => ({
  userId: auth.user?.id ?? '',
  teamOwnerIds: directReports.value.map((user) => user.id),
  managedDeptIds: managedDepartmentIds.value,
}));

const scopeCounts = computed(() => countObjectivesByScope(treeData.value, actorContext.value));
const scopedObjectives = computed(() => selectObjectiveScope(
  treeData.value,
  selectedScope.value,
  actorContext.value,
));
const canvasLayout = computed(() => layoutObjectives(scopedObjectives.value, display.value));

let scopeInitialized = false;

watch(scopeCounts, (counts) => {
  const hasAnyScope = Object.values(counts).some((count) => count > 0);
  if (!hasAnyScope) return;
  const role = auth.user?.sysRole;
  const order: ObjectiveMapScope[] = role === 'manager'
    ? ['team', 'mine', 'organization', 'other']
    : ['mine', 'organization', 'other', 'team'];
  if (!scopeInitialized) {
    selectedScope.value = order.find((scope) => counts[scope] > 0) ?? selectedScope.value;
    scopeInitialized = true;
    return;
  }
  if (counts[selectedScope.value] > 0) return;
  selectedScope.value = order.find((scope) => counts[scope] > 0) ?? selectedScope.value;
}, { deep: true, immediate: true });

function levelLabel(level: ObjectiveLevel): string {
  return OBJECTIVE_LEVEL_LABELS[level] ?? level;
}

function statusType(status: ObjectiveStatus): string {
  return OBJECTIVE_STATUS_META[status]?.type ?? 'info';
}

function statusLabel(status: ObjectiveStatus): string {
  return OBJECTIVE_STATUS_META[status]?.label ?? status;
}

function formatProgress(progress: number): string {
  return `${progress ?? 0}%`;
}

function openDetail(objective: Objective) {
  selectedObjective.value = objective;
  detailVisible.value = true;
}

function openTracking(objective: Objective) {
  router.push({ path: '/action-items', query: { objectiveId: objective.id } });
}

// ---------------------------------------------------------------------------
// 表单弹窗
// ---------------------------------------------------------------------------

const dialogVisible = ref(false);
const dialogTitle = ref('新建目标');
const editingId = ref<string | null>(null);
const submitting = ref(false);

const form = reactive<CreateObjectiveBody & { status?: ObjectiveStatus }>({
  title: '',
  description: '',
  level: 'company',
  deptId: undefined,
  ownerId: undefined,
  parentId: undefined,
  cycleId: undefined,
  weight: undefined,
  priority: 0,
  relatedIndicatorId: undefined,
  status: 'active',
});

const availableParentObjectives = computed(() => {
  // company 无父；department 父为公司级；individual 父为部门级。
  if (form.level === 'company') return [];
  const expectedParentLevel: ObjectiveLevel = form.level === 'department' ? 'company' : 'department';
  const list: Objective[] = [];
  const walk = (nodes: Objective[]) => {
    nodes.forEach((n) => {
      if (n.level === expectedParentLevel && n.id !== editingId.value) {
        list.push(n);
      }
      if (n.children) walk(n.children);
    });
  };
  walk(treeData.value);
  return list;
});

function openCreate() {
  editingId.value = null;
  dialogTitle.value = '新建目标';
  resetForm();
  form.level = defaultLevelForCreate();
  dialogVisible.value = true;
}

function openEdit(row: Objective) {
  editingId.value = row.id;
  dialogTitle.value = '编辑目标';
  form.title = row.title;
  form.description = row.description ?? '';
  form.level = row.level;
  form.deptId = row.deptId ?? undefined;
  form.ownerId = row.ownerId ?? undefined;
  form.parentId = row.parentId ?? undefined;
  form.cycleId = row.cycleId ?? undefined;
  form.weight = row.weight ?? undefined;
  form.priority = row.priority;
  form.relatedIndicatorId = row.relatedIndicatorId ?? undefined;
  form.status = row.status;
  dialogVisible.value = true;
}

function resetForm() {
  form.title = '';
  form.description = '';
  form.level = defaultLevelForCreate();
  form.deptId = undefined;
  form.ownerId = undefined;
  form.parentId = undefined;
  form.cycleId = filters.cycleId || undefined;
  form.weight = undefined;
  form.priority = 0;
  form.relatedIndicatorId = undefined;
  form.status = 'active';
}

async function submitForm() {
  if (!form.title.trim()) {
    ElMessage.warning('请输入目标标题');
    return;
  }
  if (form.level !== 'company' && !form.parentId) {
    ElMessage.warning('请选择父目标');
    return;
  }

  submitting.value = true;
  try {
    const body: CreateObjectiveBody = {
      title: form.title.trim(),
      description: form.description || undefined,
      level: form.level,
      deptId: form.deptId,
      ownerId: form.ownerId,
      parentId: form.parentId,
      cycleId: form.cycleId,
      weight: form.weight,
      priority: form.priority,
      relatedIndicatorId: form.relatedIndicatorId,
    };

    if (editingId.value) {
      await objectivesApi.update(editingId.value, { ...body, status: form.status });
      ElMessage.success('目标已更新');
    } else {
      await objectivesApi.create(body);
      ElMessage.success('目标已创建');
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
const progressRow = ref<Objective | null>(null);
const progressValue = ref(0);
const progressSubmitting = ref(false);

function openProgress(row: Objective) {
  progressRow.value = row;
  progressValue.value = row.progress;
  progressDialogVisible.value = true;
}

async function submitProgress() {
  if (!progressRow.value) return;
  progressSubmitting.value = true;
  try {
    await objectivesApi.updateProgress(progressRow.value.id, { progress: progressValue.value });
    ElMessage.success('进度已更新');
    progressDialogVisible.value = false;
    loadTree();
  } finally {
    progressSubmitting.value = false;
  }
}

// ---------------------------------------------------------------------------
// 删除
// ---------------------------------------------------------------------------

async function removeRow(row: Objective) {
  try {
    await ElMessageBox.confirm('确定删除该目标吗？删除前请先移除子目标。', '删除确认', {
      type: 'warning',
    });
    await objectivesApi.remove(row.id);
    ElMessage.success('目标已删除');
    loadTree();
  } catch {
    // 取消删除
  }
}
</script>

<template>
  <PerformanceWorkspace title="目标地图" active-section="map" :show-context="false">
    <template #toolbar>
      <el-button
        v-if="canManage"
        data-testid="objective-create"
        type="primary"
        :icon="Plus"
        @click="openCreate"
      >
        新建目标
      </el-button>
    </template>

    <div class="objective-map page-stack">
      <section data-testid="objective-map-surface" class="performance-surface">
        <div data-testid="objective-map-toolbar" class="objective-map__toolbar">
          <ObjectiveMapFilters
            :cycles="cycles"
            :cycle-id="filters.cycleId"
            :scope="selectedScope"
            :scope-counts="scopeCounts"
            @update:cycle-id="filters.cycleId = $event"
            @update:scope="selectedScope = $event"
          />
          <div class="objective-map__toolbar-spacer" />
          <ObjectiveMapDisplaySettings v-model="display" />
        </div>

        <ObjectiveMapCanvas
          :layout="canvasLayout"
          :display="display"
          :loading="loading"
          :error="loadError"
          :can-manage="canManage"
          @retry="loadTree"
          @open="openDetail"
          @edit="openEdit"
          @progress="openProgress"
          @track="openTracking"
          @remove="removeRow"
        />
      </section>

      <el-drawer
        v-model="detailVisible"
        data-testid="objective-map-detail"
        title="目标详情"
        size="420px"
      >
        <div v-if="selectedObjective" class="objective-detail">
          <h2>{{ selectedObjective.title }}</h2>
          <p>{{ selectedObjective.ownerName || selectedObjective.deptName || '未指定负责人' }}</p>
          <strong>{{ formatProgress(selectedObjective.progress) }}</strong>
        </div>
      </el-drawer>

    <!-- 新建 / 编辑弹窗 -->
    <el-dialog v-model="dialogVisible" data-testid="objective-dialog" :title="dialogTitle" width="640px" destroy-on-close>
      <el-form :model="form" label-width="100px">
        <el-form-item label="目标标题" required>
          <el-input v-model="form.title" data-testid="objective-title" placeholder="请输入目标标题" maxlength="200" show-word-limit />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            placeholder="请输入目标描述"
          />
        </el-form-item>
        <el-form-item label="目标层级" required>
          <el-radio-group v-model="form.level">
            <el-radio-button value="company">公司级</el-radio-button>
            <el-radio-button value="department">部门级</el-radio-button>
            <el-radio-button value="individual">个人级</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.level !== 'company'" label="父目标" required>
          <el-select
            v-model="form.parentId"
            placeholder="选择父目标"
            clearable
            style="width: 100%"
            filterable
          >
            <el-option
              v-for="p in availableParentObjectives"
              :key="p.id"
              :label="`[${levelLabel(p.level)}] ${p.title}`"
              :value="p.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="所属部门">
          <el-select v-model="form.deptId" placeholder="选择部门" clearable style="width: 100%" filterable>
            <el-option
              v-for="d in departments"
              :key="d.id"
              :label="d.name"
              :value="d.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="负责人">
          <el-select v-model="form.ownerId" placeholder="选择负责人" clearable style="width: 100%" filterable>
            <el-option
              v-for="u in users"
              :key="u.id"
              :label="`${u.name} ${u.employeeNo ? '(' + u.employeeNo + ')' : ''}`"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="考核周期">
          <el-select v-model="form.cycleId" placeholder="选择周期" clearable style="width: 100%">
            <el-option
              v-for="c in cycles"
              :key="c.id"
              :label="c.name"
              :value="c.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="关联指标">
          <el-select
            v-model="form.relatedIndicatorId"
            placeholder="选择关联考核指标（可选）"
            clearable
            style="width: 100%"
            filterable
          >
            <el-option
              v-for="i in indicators"
              :key="i.id"
              :label="i.name"
              :value="i.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="权重">
          <el-input-number v-model="form.weight" :min="0" :max="100" :precision="2" placeholder="可选" />
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="form.priority" :min="0" :step="1" />
        </el-form-item>
        <el-form-item v-if="editingId" label="状态">
          <el-radio-group v-model="form.status">
            <el-radio-button value="draft">草稿</el-radio-button>
            <el-radio-button value="active">进行中</el-radio-button>
            <el-radio-button value="archived">已归档</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button data-testid="objective-save" type="primary" :loading="submitting" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>

    <!-- 进度更新弹窗 -->
    <el-dialog v-model="progressDialogVisible" title="更新进度" width="400px" destroy-on-close>
      <div v-if="progressRow" class="progress-row-title">{{ progressRow.title }}</div>
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
.objective-map {
  min-width: 0;
  min-height: 100%;
  padding: 16px;
}

.objective-map__toolbar {
  min-height: 50px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 10px;
  background: #fff;
  border-bottom: 1px solid #e2e6ed;
}

.objective-map__period {
  display: flex;
  align-items: center;
  gap: 8px;
}

.objective-map__filter-label {
  color: #697386;
  font-size: 13px;
  font-weight: 600;
}

.objective-map__cycle-select {
  width: 220px;
}

.objective-map__toolbar-spacer {
  flex: 1;
}

.performance-surface {
  min-width: 0;
  min-height: 420px;
  overflow: hidden;
  background: #fff;
  border: 1px solid #e2e6ed;
  border-radius: 7px;
}

.performance-surface :deep(.el-table) {
  border: 0;
  border-radius: 0;
}

.objective-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.level-tag {
  flex-shrink: 0;
}

.title-text {
  font-weight: 500;
}

.objective-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}

.meta-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}

.meta-line {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.meta-line .el-icon {
  color: #8791a4;
}

.progress-row-title {
  margin-bottom: 16px;
  font-weight: 500;
}

@media (max-width: 768px) {
  .objective-map {
    min-height: auto;
    padding: 10px;
  }

  .objective-map__toolbar {
    align-items: stretch;
    flex-direction: column;
    overflow: hidden;
  }

  .objective-map__period,
  .objective-map__cycle-select {
    width: 100%;
  }

  .objective-map__toolbar :deep(.el-radio-group) {
    width: max-content;
    max-width: none;
  }

  .objective-map__toolbar :deep(.el-radio-group) {
    overflow-x: auto;
  }

  .objective-map__toolbar-spacer {
    display: none;
  }

  .performance-surface {
    min-height: 360px;
    overflow-x: auto;
  }
}
</style>
