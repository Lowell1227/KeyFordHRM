<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useAuthStore } from '@/stores/auth.store';
import { personnelConfigApi, type PersonnelReviewMode } from '@/api/personnel-config.api';

const productVersion = '0.8';

const auth = useAuthStore();
const isSystemAdmin = computed(() => auth.user?.sysRole === 'system_admin');

const reviewMode = ref<PersonnelReviewMode>('standard');
const reviewModeLoading = ref(false);
const reviewModeSaving = ref(false);
const reviewModeLoaded = ref(false);

async function loadReviewMode() {
  reviewModeLoading.value = true;
  reviewModeLoaded.value = false;
  try {
    reviewMode.value = (await personnelConfigApi.getReviewMode()).mode;
    reviewModeLoaded.value = true;
  } catch {
    ElMessage.error('审核模式读取失败，请刷新后重试');
  } finally {
    reviewModeLoading.value = false;
  }
}

async function switchReviewMode(value: PersonnelReviewMode) {
  if (!reviewModeLoaded.value || reviewModeSaving.value || value === reviewMode.value) return;
  reviewModeSaving.value = true;
  try {
    if (value === 'relaxed') {
      await ElMessageBox.confirm('开启后，新提交的档案、部门、岗位、入职及再入职申请将由系统自动审核，部门合并仍需人工审核。未来生效的任职仍按日期生效，既有待审单不自动处理，提交权限不变。', '开启宽松审核模式', {
        confirmButtonText: '开启宽松模式', cancelButtonText: '保持标准模式', type: 'warning',
      });
    }
    await personnelConfigApi.updateReviewMode(value);
    reviewMode.value = value;
    ElMessage.success(value === 'relaxed' ? '已开启宽松模式，部门合并仍需人工审核' : '已恢复标准模式，新申请按原规则人工审核');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error('审核模式切换失败，请重试');
  } finally {
    reviewModeSaving.value = false;
  }
}

onMounted(() => { if (isSystemAdmin.value) void loadReviewMode(); });

type CapabilityStatus = 'available' | 'partial' | 'pending' | 'paused';

type CapabilityItem = {
  name: string;
  status: CapabilityStatus;
  statusLabel: string;
  note: string;
};

const capabilities: CapabilityItem[] = [
  {
    name: '账户与系统角色',
    status: 'partial',
    statusLabel: '部分可用',
    note: '已有账号和系统角色；更细的业务身份仍需逐域补充。',
  },
  {
    name: '数据权限',
    status: 'partial',
    statusLabel: '部分可用',
    note: '已有角色和部分业务能力控制；跨模块数据范围尚未统一。',
  },
  {
    name: '钉钉登录与身份绑定',
    status: 'available',
    statusLabel: '可用',
    note: '组织、人员、任职和花名册直属主管均以 HRM 花名册为准，不读取或同步钉钉组织。',
  },
  {
    name: 'OA 审批读取与事件订阅',
    status: 'pending',
    statusLabel: '待建设',
    note: '尚未接入审批实例读取、事件订阅、补偿和对账。',
  },
  {
    name: '考勤结果读取',
    status: 'pending',
    statusLabel: '待建设',
    note: '钉钉考勤已运行，HRM 尚未读取结果用于分析。',
  },
  {
    name: '钉钉待办与消息',
    status: 'pending',
    statusLabel: '待建设',
    note: '尚未接入钉钉待办写入及统一消息触达。',
  },
  {
    name: '钉钉日志读取',
    status: 'pending',
    statusLabel: '待建设',
    note: '尚未接入日志数据读取和分析。',
  },
  {
    name: '审计与留痕',
    status: 'partial',
    statusLabel: '部分可用',
    note: '核心绩效操作已有留痕；跨模块审计口径尚未统一。',
  },
  {
    name: '全局字典与基础配置',
    status: 'pending',
    statusLabel: '待建设',
    note: '尚未形成独立、统一的全局配置中心。',
  },
  {
    name: '系统监控',
    status: 'pending',
    statusLabel: '待建设',
    note: '尚未提供面向业务管理员的运行状态和异常总览。',
  },
  {
    name: '招聘候选人、面试与 Offer 全流程',
    status: 'paused',
    statusLabel: '已暂缓',
    note: '招聘模块当前仅保留规划入口，未建设候选人、面试评价和 Offer 流程。',
  },
  {
    name: '薪酬指定 HR 主管权限',
    status: 'paused',
    statusLabel: '已暂缓',
    note: '薪酬模块暂缓，本期仅系统管理员可见规划入口。',
  },
];
</script>

<template>
  <main class="system-overview" data-testid="system-overview">
    <header class="overview-header">
      <div>
        <p class="eyebrow">全局基础能力</p>
        <p class="header-copy">
          集中记录当前已有能力和缺失项，避免后续规划遗漏。除下方“人事审核模式”外，本页只展示状态，不提供其他配置操作。
        </p>
      </div>
      <span class="read-only-tag">版本 {{ productVersion }}</span>
    </header>

    <section v-if="isSystemAdmin" class="review-mode-panel" aria-label="人事审核模式" data-testid="review-mode-panel">
      <div class="review-mode-copy">
        <h2>人事审核模式</h2>
        <p>
          宽松模式：档案变更、部门与岗位变更、入职/再入职提交后自动审核，部门合并除外，按生效日期生效；
          标准模式：组织、任职、合同、证件等敏感变更需人工审核后生效。
        </p>
      </div>
      <div class="review-mode-control" v-loading="reviewModeLoading">
        <el-radio-group
          :model-value="reviewMode"
          :disabled="reviewModeSaving || reviewModeLoading || !reviewModeLoaded"
          data-testid="review-mode-switch"
          @update:model-value="value => switchReviewMode(value as PersonnelReviewMode)"
        >
          <el-radio-button value="relaxed">宽松模式</el-radio-button>
          <el-radio-button value="standard">标准模式</el-radio-button>
        </el-radio-group>
        <span class="review-mode-current">当前：{{ !reviewModeLoaded ? '尚未读取' : reviewMode === 'relaxed' ? '宽松模式（系统自动审核）' : '标准模式（人工审核）' }}</span>
      </div>
    </section>

    <section class="capability-panel" aria-label="系统能力状态">
      <div class="panel-heading">
        <h2>能力清单</h2>
        <span>共 {{ capabilities.length }} 项</span>
      </div>

      <div class="capability-list">
        <article
          v-for="item in capabilities"
          :key="item.name"
          class="capability-row"
          data-testid="system-capability-status"
        >
          <div class="capability-name">{{ item.name }}</div>
          <span class="status-tag" :class="`status-tag--${item.status}`">
            {{ item.statusLabel }}
          </span>
          <p>{{ item.note }}</p>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.system-overview {
  min-height: 100%;
  padding: 28px;
  box-sizing: border-box;
  color: #202b4d;
}

.overview-header,
.capability-panel,
.review-mode-panel {
  border: 1px solid #e4e9f2;
  border-radius: 12px;
  background: #fff;
}

.overview-header {
  padding: 28px 30px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  box-shadow: 0 6px 22px rgb(42 61 105 / 6%);
}

.eyebrow,
.header-copy,
.capability-row p,
.panel-heading span {
  color: #68738e;
}

.eyebrow {
  margin: 0 0 8px;
  font-size: 13px;
}

h2,
p {
  margin-top: 0;
}

h2 {
  margin-bottom: 0;
  font-size: 18px;
}

.header-copy {
  max-width: 760px;
  margin-bottom: 0;
  font-size: 14px;
  line-height: 1.8;
}

.read-only-tag,
.status-tag {
  flex-shrink: 0;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.read-only-tag {
  padding: 6px 12px;
  color: #4f5f80;
  background: #f1f4f9;
}

.capability-panel {
  margin-top: 18px;
  overflow: hidden;
}

.review-mode-panel {
  margin-top: 18px;
  padding: 20px 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}

.review-mode-copy h2 {
  margin: 0 0 6px;
  font-size: 16px;
}

.review-mode-copy p {
  max-width: 720px;
  margin: 0;
  color: #68738e;
  font-size: 13px;
  line-height: 1.7;
}

.review-mode-control {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.review-mode-current {
  color: #68738e;
  font-size: 12px;
}

.panel-heading {
  padding: 18px 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #edf0f5;
}

.panel-heading span {
  font-size: 13px;
}

.capability-list {
  padding: 0 22px;
}

.capability-row {
  min-height: 78px;
  padding: 16px 0;
  display: grid;
  grid-template-columns: minmax(190px, 0.8fr) 86px minmax(320px, 2fr);
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid #edf0f5;
}

.capability-row:last-child {
  border-bottom: 0;
}

.capability-name {
  font-size: 14px;
  font-weight: 700;
}

.capability-row p {
  margin-bottom: 0;
  font-size: 13px;
  line-height: 1.6;
}

.status-tag {
  width: fit-content;
  padding: 4px 9px;
  border: 1px solid transparent;
}

.status-tag--available {
  color: #16794a;
  border-color: #b9e4cc;
  background: #edf9f2;
}

.status-tag--partial {
  color: #225fb3;
  border-color: #bfd4f5;
  background: #eff5ff;
}

.status-tag--pending {
  color: #885b05;
  border-color: #f0d393;
  background: #fff8e8;
}

.status-tag--paused {
  color: #7a5260;
  border-color: #decbd2;
  background: #f8f1f4;
}

@media (max-width: 900px) {
  .capability-row {
    grid-template-columns: minmax(150px, 1fr) auto;
  }

  .capability-row p {
    grid-column: 1 / -1;
  }
}

@media (max-width: 768px) {
  .system-overview {
    padding: 16px;
  }

  .overview-header {
    padding: 22px 20px;
  }

  h1 {
    font-size: 23px;
  }

  .capability-list {
    padding: 0 18px;
  }
}
</style>
