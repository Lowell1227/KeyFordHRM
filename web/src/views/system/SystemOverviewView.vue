<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { cyclesApi } from '@/api/cycles.api';

const productVersion = '0.9.1';

type NotificationStatus = 'loading' | 'enabled' | 'disabled' | 'unavailable' | 'error';
const notificationStatus = ref<NotificationStatus>('loading');
const notificationRuntime = computed(() => ({
  loading: { label: '读取中', note: '正在读取钉钉工作通知状态。' },
  enabled: { label: '已启用', note: '平台可用且业务开关已开启；具体发送仍按各业务通知策略执行。' },
  disabled: { label: '业务开关已关闭', note: '平台可用，业务开关关闭，暂不外发钉钉工作通知。' },
  unavailable: { label: '平台不可用或未启用', note: '平台可用性取决于部署开关及凭据，当前不能外发钉钉工作通知。' },
  error: { label: '读取失败', note: '暂时无法确认运行状态，请重新读取。' },
}[notificationStatus.value]));
let notificationGeneration = 0;
let disposed = false;

async function loadNotificationSettings() {
  if (disposed) return;
  const generation = ++notificationGeneration;
  notificationStatus.value = 'loading';
  try {
    const settings = await cyclesApi.getDingtalkNotificationSettings();
    if (disposed || generation !== notificationGeneration) return;
    if (typeof settings?.available !== 'boolean'
      || typeof settings?.enabled !== 'boolean'
      || typeof settings?.effectiveEnabled !== 'boolean'
      || settings.effectiveEnabled !== (settings.available && settings.enabled)) {
      throw new Error('Invalid notification settings');
    }
    notificationStatus.value = !settings.available ? 'unavailable'
      : settings.effectiveEnabled ? 'enabled' : 'disabled';
  } catch {
    if (!disposed && generation === notificationGeneration) notificationStatus.value = 'error';
  }
}

onMounted(loadNotificationSettings);
onBeforeUnmount(() => {
  disposed = true;
  notificationGeneration++;
});

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
    name: '站内通知',
    status: 'available',
    statusLabel: '已实现',
    note: '已有系统内通知及业务事项入口，与钉钉外部通知分别处理。',
  },
  {
    name: '钉钉工作通知',
    status: 'available',
    statusLabel: '已实现',
    note: '工作通知发送能力已实现，外发取决于平台可用性、业务开关及各业务通知策略。',
  },
  {
    name: '钉钉待办',
    status: 'pending',
    statusLabel: '未接入',
    note: '尚未接入钉钉待办写入和状态同步。',
  },
  {
    name: '钉钉面试日程',
    status: 'available',
    statusLabel: '已实现',
    note: '面试日程同步已实现，依赖部署开关及日程权限等配置；运行状态未提供。',
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
    name: '人事基础资料',
    status: 'partial',
    statusLabel: '部分可用',
    note: '已有学历、职级等人事基础目录；尚未形成跨模块统一的全局字典与配置中心。',
  },
  {
    name: '系统监控',
    status: 'pending',
    statusLabel: '待建设',
    note: '尚未提供面向业务管理员的运行状态和异常总览。',
  },
  {
    name: '人才库与招聘流转',
    status: 'available',
    statusLabel: '可用',
    note: '人才资料、跟进、应聘、面试安排与反馈、录用确认及入职衔接可用；简历解析需独立配置。',
  },
  {
    name: '招聘编制、职位发布与 Offer',
    status: 'paused',
    statusLabel: '已暂缓',
    note: '招聘编制、职位发布、Offer 文书与薪资审批暂缓建设。',
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
        <h1>系统概览</h1>
      </div>
      <span class="read-only-tag">版本 {{ productVersion }}</span>
    </header>

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
          <div class="capability-detail">
            <p>{{ item.note }}</p>
            <div v-if="item.name === '钉钉工作通知'" class="notification-runtime">
              <span class="runtime-label">运行状态</span>
              <span
                class="status-tag"
                :class="`status-tag--${notificationStatus}`"
                role="status"
                aria-live="polite"
                :aria-busy="notificationStatus === 'loading'"
                data-testid="dingtalk-notification-runtime"
              >{{ notificationRuntime.label }}</span>
              <button
                type="button"
                class="retry-button"
                aria-label="重新读取钉钉通知状态"
                title="重新读取钉钉通知状态"
                :disabled="notificationStatus === 'loading'"
                @click="loadNotificationSettings"
              >
                <Refresh aria-hidden="true" />
              </button>
              <p class="runtime-note">{{ notificationRuntime.note }}</p>
            </div>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.system-overview {
  min-height: 100%;
  min-width: 0;
  padding: 24px;
  box-sizing: border-box;
  color: #303133;
}

.overview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.capability-row p,
.panel-heading span,
.runtime-label {
  color: #606266;
}

h1,
h2,
p {
  margin: 0;
}

h1 {
  font-size: 18px;
}

h2 {
  font-size: 14px;
}

.read-only-tag,
.status-tag {
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
}

.read-only-tag {
  color: #606266;
}

.capability-panel {
  margin-top: 16px;
}

.panel-heading {
  padding-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #dcdfe6;
}

.panel-heading span {
  font-size: 13px;
}

.capability-row {
  padding: 12px 0;
  display: grid;
  grid-template-columns: minmax(160px, 1fr) 80px minmax(0, 3fr);
  align-items: start;
  gap: 12px;
  border-bottom: 1px solid #ebeef5;
}

.capability-row:last-child {
  border-bottom: 0;
}

.capability-name {
  font-size: 14px;
  font-weight: 600;
}

.capability-name,
.capability-detail {
  min-width: 0;
  overflow-wrap: anywhere;
}

.capability-row p {
  font-size: 13px;
  line-height: 1.6;
}

.status-tag {
  box-sizing: border-box;
  max-width: 100%;
  width: fit-content;
  padding: 2px 6px;
  border: 1px solid transparent;
}

.status-tag--available,
.status-tag--enabled {
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

.status-tag--paused,
.status-tag--error {
  color: #7a5260;
  border-color: #decbd2;
  background: #f8f1f4;
}

.status-tag--disabled,
.status-tag--unavailable,
.status-tag--loading {
  color: #606266;
  border-color: #dcdfe6;
  background: #f4f4f5;
}

.notification-runtime {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.runtime-label {
  font-size: 12px;
}

.runtime-note {
  flex-basis: 100%;
}

.retry-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  padding: 7px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: transparent;
  color: #606266;
  cursor: pointer;
}

.retry-button svg {
  width: 16px;
  height: 16px;
}

.retry-button:hover:not(:disabled),
.retry-button:focus-visible {
  color: #225fb3;
  border-color: #225fb3;
}

.retry-button:disabled {
  cursor: wait;
  opacity: 0.5;
}

@media (max-width: 900px) {
  .capability-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .capability-detail {
    grid-column: 1 / -1;
  }
}

@media (max-width: 768px) {
  .system-overview {
    padding: 16px;
  }

  .retry-button {
    flex-basis: 40px;
    width: 40px;
    height: 40px;
  }
}
</style>
