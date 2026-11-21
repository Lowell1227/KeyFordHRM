<template>
  <main class="recruitment-planning" data-testid="recruitment-planning">
    <p class="planning-state">未立项 · 未排期</p>
    <section aria-label="当前已可用">
      <h2>当前已可用</h2>
      <p>人才资料、跟进、应聘、面试反馈、录用确认和入职衔接已上线。招聘交接后，由人员模块办理到岗、员工档案、合同和任职。</p>
    </section>
    <section aria-label="尚未立项">
      <h2>尚未立项</h2>
      <ul><li>招聘需求与编制</li><li>职位发布</li><li>Offer 文书</li><li>薪资审批</li></ul>
    </section>
    <section aria-label="钉钉边界">
      <h2>钉钉负责的通用流程</h2>
      <p>请假、出差、外出、加班、补卡、排班、打卡及通用审批继续在钉钉办理。报销、付款不进入 HRM，本期不开发重复功能。</p>
      <p>未来如薪酬或分析确有需要，再评审最小化只读同步终审结果；草稿、审批中、退回和撤销不作为工资事实。当前未接入。</p>
    </section>
  </main>
</template>

<style scoped>
.recruitment-planning { max-width: 1000px; margin: 0 auto; padding: 8px 12px; color: var(--el-text-color-primary); }
.planning-state { color: var(--el-text-color-secondary); font-size: 13px; }
section { padding: 18px 0; border-top: 1px solid var(--el-border-color-lighter); }
h2 { margin: 0 0 10px; font-size: 16px; }
p, li { font-size: 14px; line-height: 1.8; overflow-wrap: anywhere; }
p { margin: 8px 0; } ul { margin: 0; padding-left: 22px; }
@media (max-width: 768px) { .recruitment-planning { padding: 4px; } }
</style>
