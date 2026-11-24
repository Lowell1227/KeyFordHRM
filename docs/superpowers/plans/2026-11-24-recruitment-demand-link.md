# Recruitment Demand Link Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Implement only the approved first batch; no production release.

**Goal:** 招聘经办在当前应聘提交录用时选取已批准有效需求，系统核对其部门、岗位和版本。

**Architecture:** 沿用NestJS/Prisma招聘模块、既有能力和审计。新增只读来源适配及需求/版本台账，现有应聘保存可空需求关系和提交快照；不新建审批流。按随后确认的增量在候选人接受时计名额，明确终止才释放；不决定超额阻断和离职补招规则。

**Tech Stack:** NestJS, Prisma, PostgreSQL, Vue3, Element Plus, Playwright.

**Spec:** `docs/requirements/2026-11-24-recruitment-planning-closure.md`.

## Constraints And Review Focus

- 虚构数据、隔离真实后端，禁止真实通知/工资数据、生产写入、扩权或部署。
- 未选单、未终审、撤销/更正失效、映射待核、目录停用、部门/岗位不匹配必须拒绝；只在提交录用新增门槛，不追改已提交历史。
- 重复同步不重复台账/事件，旧响应不得恢复已撤销/被更正需求。锁后读当前来源及人工映射版本。
- 只保留必要来源字段，薪资/附件/个人审批意见不得进入通用招聘读取或日志。
- PC/手机清晰显示缺项和前往需求核对入口；409保留录用意见和选单，不能静默重提。

## Work Packages

### 1. Read-only DingTalk Adapter

Files: new `api/src/dingtalk/dingtalk-recruitment.service.ts` and tests; register/export in `dingtalk.module.ts`.

Interface: `status()` returns configured/missing/readOnly; `listIds({from,to})` returns instanceIds/complete; `readInstance(instanceId)` returns allowlisted organizationKey/processCode/instanceId/status/rawDepartment/rawPosition/rawHeadcount/approvedAt/sourceCreatedAt/sourceUpdatedAt/sourceLink/mainInstanceId/bizAction. Unknown or unverifiable source remains non-usable. Missing config never falls back to another form or organization.

- [x] Verify official request contracts, minimal application permissions and safe configuration needs; do not infer HRM authorization from personal DWS. Official contract checked; actual app/form access remains an explicit external dependency.
- [x] Write failing contract tests for terminal approval, withdraw/correction, wrong form/org, pagination, malformed count and salary exclusion.
- [x] Implement deadline-bound official-host read calls using existing app token; no callbacks, platform writes or notification expansion. Parent corrected the initial REVOKE assumption against official documentation: it is a restarted instance relationship, not itself a withdrawal state.
- [x] Run adapter tests: 62 direct cases; record actual external verification and unverified conditions separately.

### 2. Ledger And Submission Gate

Files: schema + additive migration, new `api/src/talent-pool/recruitment-demands.*`, `talent-pool.module.ts`, existing recruitment service/DTO and direct tests.

Interface: `/recruitment-demands` list/detail; `/directories` minimal active HRM department/position references; `/options?applicationId=` eligible requests for that actual application; `/status`; POST `/sync` from/to; POST `/:id/refresh`; PATCH `/:id/mapping` with expectedRevision/deptId/positionId/approvedHeadcount/reason. Source state is never accepted as user HTTP input.

Submission action adds `recruitmentDemandId` and `expectedDemandRevision`. Persist selected ID, selected revision and immutable allowlisted snapshot in the same transaction as stage/version/audit. Match current application deptId and exact catalog position name against confirmed request mapping; do not fuzzy-match or grant authority from titles. Only recruitment editors sync/map, existing readers view, independent confirm unchanged.

- [x] Add failing tests and additive demand/event plus resumable sync tables, nullable application relation/snapshot; no historic backfill.
- [x] Implement idempotent source updates, mapping invalidation, audit and optimistic versions; serialize source read/write to reject stale use.
- [x] Test missing/pending/revoked/changed/invalid/mismatched demand, multi-application isolation, permission and existing submitted-history protection.
- [x] Complete final real isolated HTTP proof: 21 groups passed, plus 14 real PostgreSQL integration cases.

### 3. Existing UI And Acceptance

Files: demand API/types; demand list/detail/mapping view; routes; `TalentApplicationPanel.vue`, existing API/types; focused tests. Keep planning non-goals visible without a second workflow.

- [x] Build compact demand list with clear upstream/mapping states, source link, timeline and enabled editor actions; pure viewers cannot sync/map.
- [x] Add selector to submit-hiring panel, near-field errors, stale/version feedback and exact next-step link. Existing creation/interview stays independent of demand.
- [x] Run targeted Web tests/type-check/build and real-backend PC/mobile workflow: demand fixture/sync contract → select → submit → independent confirmation → candidate accepts → original onboarding/arrival. No API bypass for candidate or demand selection. Full new flow, old operator regression and final timeline-only fix each passed on PC/mobile; preserve failed fixture/ARIA attempts separately.
- [x] Run strict full API once: 271 suites/5516 cases. Subsequent independent-review fixes (explicit zero headcount and null historical accepted-seat reassignment) use final affected 6 suites/173 cases including real PostgreSQL; preserve RED evidence rather than reusing an unchanged-snapshot claim.
- [x] Deliver fixed `http://localhost:5173` preview, acceptance evidence and remaining exact configuration/permission/business dependencies. No commit/push/deploy; termination action remains awaiting answer rather than marked complete.

### 4. Confirmed Seat-Counting Increment

User confirmed in the requirements conversation: candidate acceptance occupies one seat per linked application; rescheduling and repeatable onboarding cancellation retain it; explicit offer termination releases it; actual arrival remains counted as hired. Over-quota blocking, historical exceptions and post-hire resignation replacement remain undecided.

Files: new `api/src/talent-pool/recruitment-demand-seats.ts` and direct tests; narrowly decorate demand API projections after ledger worker freezes; new Web seat summary and direct tests; existing application action policy only after termination semantics are confirmed.

- [x] Prove count derivation with 14 direct tests: accept once, ordinary cancellation/withdrawal not interpreted as termination, arrival retained, independent applications, unknown capacity not zero, and no quota policy inferred.
- [x] Prove Web presentation with 5 direct tests: zero versus missing/unverified values and overage facts.
- [x] Integrate counts into real list/detail/application projections; immutable source snapshots exclude dynamic counts. Prevent demand reassignment while a prior acceptance remains unterminated, including legacy null associations; no mutable aggregate counter or unnecessary new allocation table.
- [ ] Resolve the concrete existing-action gap: accepted applications currently only have generic withdrawal; ask whether to make termination explicit with reason and second confirmation, and require cancellation of an active onboarding request first (that cancellation itself never releases).
- [ ] Real PostgreSQL/HTTP and PC/mobile acceptance: approved two places → submit/approve still two → accept leaves one → explicit termination restores two; duplicate/concurrent retries count once, arrival still counted.

Partial evidence for the final unchecked item: submit/approve/accept/onboarding cancellation/retry/arrival counts passed real HTTP and both UI sizes. Explicit termination/release has pure derivation coverage only, no public command, pending the separately asked business-action decision.

Technical correction: the initial synchronous cap could not reach a completed state for cap+1 inputs. Add only a module-scoped persisted sync batch with stable request ID/cursor, actor/source/range ownership checks, atomic item progress and explicit continuation/recovery; do not introduce a generic task platform or pretend a partial response is complete.
