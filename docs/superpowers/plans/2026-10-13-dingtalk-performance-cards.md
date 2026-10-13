# DingTalk Performance Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver the first working slice of the approved lifecycle-card design: durable saved-progress links, authenticated explicit queries, four import-ready templates, and local verification.

**Architecture:** Reuse TasksService and PeriodReviewsService for authorized read projections and the existing Stream adapter for transport. Existing HRM pages remain the only write path for goal/evaluation/result cards. This slice is pull-on-request; event-driven notifications and background refresh remain a separately tracked next slice, with existing notification delivery unchanged.

**Tech Stack:** NestJS, TypeScript, Prisma, existing Redis draft/delivery store, Jest, DingTalk standard-card editor JSON.

**Spec:** `docs/superpowers/specs/2026-10-13-dingtalk-performance-card-design-review.md`

## Global Constraints

- Isolated `codex/dingtalk-ai-progress-bot` worktree; preserve unrelated main changes.
- No production writes, migrations, enable switches, model requests, or real DingTalk sends. First real tester remains 姚瑶.
- Corporate single-chat identity, active employment, and HRM bot allowlist apply before all reads and sends.
- “我的目标/我的自评/我的结果” are owner-only, even for an HR user. Assigned work uses actual workflow/period handler, never static role alone.
- All four new cards are link-only. URLs are same-origin HTTPS and constructed from fixed HRM routes. No score, grade, coefficient, full comment in chat.
- Quantitative/qualitative progress semantics and existing `save` callback remain unchanged.
- Template package generation follows the official exported editor format; native platform import/render is still a release gate.

## Review Focus

1. Multiple open periods: enumerate actual periods, preserve periodId, never select by calendar month.
2. HR as employee: explicit personal queries must not return globally readable colleagues.
3. Approval/confirmation/publication: no premature result card; confirmed is not automatically published.
4. Redelivered Stream frame or missing template: no duplicate business write; safe text fallback without legacy-app delivery.
5. Import format: editorData variables, link buttons and privacy defaults must match the backend projection, not fictitious callback controls.

### Task 1: Durable saved-progress link

**Files:** Modify `api/src/dingtalk/dingtalk-card.presenter.ts`; test `api/src/dingtalk/dingtalk-bot.gateway.spec.ts`.
**Interfaces:** Consumes `DraftPreview.saved.indicatorId`; produces unchanged params except saved `editUrl/detailUrl` use `/action-items?indicatorId=...`.

- [ ] Add a failing test asserting a saved corrected indicator URL is durable and pending URL remains `/ai-progress/confirm/:draftId`.
- [ ] Run `npm test -- --runInBand dingtalk-bot.gateway`; Expected: new URL assertion fails.
- [ ] Change the common presenter URL once, preserving draft-only paths and saved authoritative values.
- [ ] Run the same test command; Expected: all pass. Commit task files only.

### Task 2: Authorized lifecycle read projections

**Files:** Create `api/src/dingtalk/performance-card.service.ts` and `.spec.ts`; modify `api/src/ai-progress/ai-progress.module.ts`.
**Interfaces:** `PerformanceCardService.query(text: string, sender: BotSender): Promise<PerformanceCardReply | null>`; `PerformanceCardReply` is `{kind:'reply',text:string}` or `{kind:'cards',cards:PerformanceCard[],text?:string}`; `PerformanceCard` has kind `todo|goal|evaluation|result`, subjectKey, params `Record<string,string>`. Null means unrecognized, routed to progress recognition by Task 3.

- [ ] Test explicit personal goal/evaluation/result intents, identity denied before reads, HR owner-only queries, no fabricated empty-cycle result, monthly/cycle period IDs, period permission flags, final-grade pending, result approval/confirmed/publication/regrade history. Expectations use fixed synthetic task/period data.
- [ ] Run `npm test -- --runInBand performance-card`; Expected: missing implementation then semantic assertions fail as behaviors are added.
- [ ] Build projections from authorized existing service details; derive only assigned candidate IDs from Prisma for todo lookup, then re-read and validate current handler and period permissions. Cap chat output and explicitly link the full workbench; do not claim exhaustive absence when capped.
- [ ] Run the same command; Expected: all pass. Commit task files only.

### Task 3: Stream dispatch and importable template package

**Files:** Modify `dingtalk-bot.gateway.ts`, `dingtalk-card.presenter.ts`, gateway tests, `.env.example`, `docker-compose.yml` as applicable; create `scripts/dingtalk-cards/build-templates.cjs`, `docs/dingtalk/cards/{todo,goal,evaluation,result}.json`, contract tests and README.
**Interfaces:** Consumes Task 2 query response; produces `DingtalkCardPresenter.sendPerformanceCard(card: PerformanceCard,sender: BotSender)`. Config uses `DINGTALK_BOT_{TODO,GOAL,EVALUATION,RESULT}_TEMPLATE_ID`; progress template unchanged.

- [ ] Test recognized queries bypass the model, unauthorized queries emit only denial, missing template emits safe text with controlled link, transport uses dedicated robot/receiver and supportForward=false, redelivery dedupes by sender/message/card key.
- [ ] Run `npm test -- --runInBand dingtalk-bot.gateway`; Expected: new dispatch tests fail.
- [ ] Wire typed query before existing progress.prepare; reuse current deadline/ack and outbound delivery claims. Add native link-only templates, optional fields hidden, strings/primary link bound to projection, no score variables. No new external notification route.
- [ ] Test generated template contracts by parsing editorData, declared variables, optional visibility and link actions. Run generator twice and compare deterministic output. Expected: four parseable stable templates and all contract/gateway tests pass.
- [ ] Commit scoped files, no secrets or downloaded QA artifacts.

### Task 4: Verification and readiness handoff

**Files:** Update design status, add `docs/dingtalk/cards/README.md` implementation and remaining-gates evidence.
**Interfaces:** Consumes all previous tasks. No new business behavior.

- [ ] Run `npm test -- --runInBand` and `npm run build` in api; Expected: suite and build pass, list any genuine failures.
- [ ] Run existing disposable PostgreSQL/Redis AI progress integration; Expected: no regression, no real external endpoints.
- [ ] Fresh-context review of this slice and branch integration boundaries. Fix important findings with RED/GREEN tests; preserve unrelated work.
- [ ] Record exact implemented/committed/not-deployed status. Remaining: platform import/IDs/render, event-driven notification adapter and live state refresh, controlled 姚瑶 acceptance, authorized publication.
