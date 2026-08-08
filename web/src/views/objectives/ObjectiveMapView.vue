<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Plus,
  EditPen,
  Delete,
  RefreshRight,
  CollectionTag,
  Aim,
  List,
  User as UserIcon,
  OfficeBuilding,
  ScaleToOriginal,
  Star,
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
import EmptyState from '@/components/common/EmptyState.vue';
import PerformanceWorkspace from '@/components/performance/PerformanceWorkspace.vue';

const auth = useAuthStore();
const router = useRouter();

const treeData = ref<Objective[]>([]);
const loading = ref(false);
const cycles = ref<AssessmentCycle[]>([]);
const departments = ref<Department[]>([]);
const indicators = ref<Indicator[]>([]);
const users = ref<User[]>([]);

const filters = reactive<{ cycleId: string; level: ObjectiveLevel | '' }>({
  cycleId: '',
  level: '',
});

const canManage = computed(() =>
  ['system_admin', 'hr', 'dept_head', 'manager'].includes(auth.user?.sysRole ?? ''),
);

function defaultLevelForCreate(): ObjectiveLevel {
  const role = auth.user?.sysRole;
  if (role === 'manager') return 'individual';
  if (role === 'dept_head') return 'department';
  return 'company';
}

onMounted(() => {
  loadTree();
  loadCycles();
  // 部门/指标/用户列表仅用于「新建·编辑目标」弹窗，普通员工无管理权限、不会打开弹窗，
  // 因此不预加载——既省请求，也避免触发越权 403。
  if (canManage.value) {
    loadDepartments();
    loadIndicators();
    loadUsers();
  }
});

watch(() => [filters.cycleId, filters.level], loadTree);

async function loadTree() {
  loading.value = true;
  try {
    const params: Record<string, unknown> = {};
    if (filters.cycleId) params.cycleId = filters.cycleId;
    if (filters.level) params.level = filters.level;
    const res = await objectivesApi.findAll(params);
    treeData.value = Array.isArray(res) ? res : res.items;
  } catch {
    treeData.value = [];
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
      <div data-testid="objective-map-toolbar" class="objective-map__toolbar">
        <div class="objective-map__period">
          <span class="objective-map__filter-label">周期</span>
          <el-select
            v-model="filters.cycleId"
            aria-label="考核周期"
            placeholder="全部周期"
            clearable
            class="objective-map__cycle-select"
          >
            <el-option v-for="c in cycles" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </div>

        <el-radio-group v-model="filters.level" data-testid="objective-level-filter">
          <el-radio-button value="">全部目标</el-radio-button>
          <el-radio-button value="company">公司目标</el-radio-button>
          <el-radio-button value="department">部门目标</el-radio-button>
          <el-radio-button value="individual">个人目标</el-radio-button>
        </el-radio-group>

        <div class="objective-map__toolbar-spacer" />
        <el-tag type="info" size="small" effect="plain">独立目标模块</el-tag>
        <el-button :icon="RefreshRight" @click="loadTree">刷新</el-button>
      </div>

      <section data-testid="objective-map-surface" class="performance-surface">
      <el-table
        v-loading="loading"
        class="app-table"
        :data="(treeData as Objective[])"
        row-key="id"
        default-expand-all
        :tree-props="{ children: 'children' }"
      >
        <el-table-column label="目标" min-width="280">
          <template #default="scope">
            <div class="objective-title">
              <el-tag size="small" effect="plain" class="level-tag">
                {{ levelLabel((scope.row as Objective).level) }}
              </el-tag>
              <span class="title-text">{{ (scope.row as Objective).title }}</span>
            </div>
            <div v-if="(scope.row as Objective).description" class="objective-desc">{{ (scope.row as Objective).description }}</div>
          </template>
        </el-table-column>
        <el-table-column label="负责人 / 部门" width="180">
          <template #default="scope">
            <div class="meta-cell">
              <span v-if="(scope.row as Objective).ownerName" class="meta-line">
                <el-icon><UserIcon /></el-icon>{{ (scope.row as Objective).ownerName }}
              </span>
              <span v-if="(scope.row as Objective).deptName" class="meta-line">
                <el-icon><OfficeBuilding /></el-icon>{{ (scope.row as Objective).deptName }}
              </span>
              <span v-if="!(scope.row as Objective).ownerName && !(scope.row as Objective).deptName">-</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="周期" width="140">
          <template #default="scope">{{ (scope.row as Objective).cycleName || '-' }}</template>
        </el-table-column>
        <el-table-column label="权重 / 优先级" width="120">
          <template #default="scope">
            <div class="meta-cell">
              <span v-if="(scope.row as Objective).weight != null" class="meta-line">
                <el-icon><ScaleToOriginal /></el-icon>{{ (scope.row as Objective).weight }}
              </span>
              <span v-if="(scope.row as Objective).priority" class="meta-line">
                <el-icon><Star /></el-icon>{{ (scope.row as Objective).priority }}
              </span>
              <span v-if="(scope.row as Objective).weight == null && !(scope.row as Objective).priority">-</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="160">
          <template #default="scope">
            <el-progress :percentage="(scope.row as Objective).progress" :stroke-width="10" />
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="scope">
            <el-tag :type="statusType((scope.row as Objective).status) as any" size="small">
              {{ statusLabel((scope.row as Objective).status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="关联指标" min-width="140">
          <template #default="scope">{{ (scope.row as Objective).relatedIndicatorName || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="scope">
            <el-button v-if="canManage" link type="primary" :icon="EditPen" size="small" @click="openEdit(scope.row as Objective)">
              编辑
            </el-button>
            <el-button v-if="canManage" link type="primary" :icon="Aim" size="small" @click="openProgress(scope.row as Objective)">
              进度
            </el-button>
            <el-button
              link
              type="success"
              :icon="List"
              size="small"
              @click="router.push({ path: '/action-items', query: { objectiveId: (scope.row as Objective).id } })"
            >
              行动计划
            </el-button>
            <el-button v-if="canManage" link type="danger" :icon="Delete" size="small" @click="removeRow(scope.row as Objective)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <EmptyState v-if="!loading && treeData.length === 0" description="暂无目标，点击右上角新建" />
      </section>

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
  border: 1px solid #e2e6ed;
  border-radius: 7px;
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
