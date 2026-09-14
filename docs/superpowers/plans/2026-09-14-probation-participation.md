# 试用期员工参与正式绩效 Implementation Plan

> **For agentic workers:** Execute the checked steps inline in this worktree; do not modify real employee or production data.

**Goal:** 试用期员工被选入周期后，不因试用期身份被自动豁免，并能生成正常绩效任务。

**Architecture:** 保留现有候选人员查询及任务生成，只移除开放计划中单独针对试用期身份的豁免分支。显式豁免、最高负责人豁免和暂未讨论的在岗不足 1/3 规则不变。

**Tech Stack:** NestJS、Prisma、Jest。

**Spec:** `docs/requirements/2026-09-14-probation-confirmation.md`

## Global Constraints

- HRM 员工档案和经确认花名册为人员权威来源。
- 试用期身份不得单独触发豁免；不得在本任务暗改在岗不足 1/3 规则。
- 保留既有周期的负责人、显式豁免与绩效直属上级快照逻辑。

---

### Task 1: 开放计划中的试用期参与状态

**Files:**
- Modify: `api/src/cycles/launch.service.spec.ts`，现有试用期候选测试。
- Modify: `api/src/cycles/launch.service.ts`，`resolveParticipantDisposition()`。

**Interfaces:** 候选人员仍带 `UserStatus.probation`；开放计划返回 `participantDisposition: 'active'`、`isExempt: false`，任务按活动状态生成。

- [x] 将现有“试用期为豁免参与者”测试改成“试用期为正常参与者”：预检中期待 `participantDisposition: 'active'` 与 `isExempt: false`；开放后期待新任务 `status: 'indicator_drafting'`、`isExempt: false`。测试候选人的入职日期早于周期，避免与 1/3 规则混淆。
- [x] 运行 `npm test -- --runInBand src/cycles/launch.service.spec.ts`，确认该测试因旧试用期豁免分支而失败。
- [x] 删除 `api/src/cycles/launch.service.ts` 中 `candidate.status === UserStatus.probation` 的专门豁免分支和过时注释，不调整 `resolveExemption()`。
- [x] 重新运行上述测试，确认试用期参与、显式豁免、最高负责人豁免和 1/3 相关用例通过。
- [x] 运行 `npm run build` 并检查 `git diff --check`。
