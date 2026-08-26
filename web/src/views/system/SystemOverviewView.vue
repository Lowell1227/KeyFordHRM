<script setup lang="ts">
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
        <h1>系统能力总览</h1>
        <p class="header-copy">
          集中记录当前已有能力和缺失项，避免后续规划遗漏。本页只展示状态，不提供配置操作。
        </p>
      </div>
      <span class="read-only-tag">只读</span>
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
.capability-panel {
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

h1,
h2,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 10px;
  font-size: 28px;
  line-height: 1.3;
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
