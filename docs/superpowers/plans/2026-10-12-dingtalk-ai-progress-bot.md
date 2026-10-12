# 钉钉 AI 目标进展助手（第一期） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 员工在钉钉单聊描述本人正式目标进展，经本人明确保存后写入现有 HRM 进展记录，并由系统管理员动态配置 Kimi、DeepSeek 或千问。

**Architecture:** 沿用 NestJS 单体和 `ObjectivesService` 的目标权限、月份与事务校验；钉钉 Stream 只做输入/卡片适配，AI 只产候选草稿。Redis 草稿 24 小时失效，正式记录在 PostgreSQL 中以草稿 ID 去重；Web 提供管理员配置页和钉钉内简短确认页。

**Tech Stack:** NestJS 10、Prisma 5、PostgreSQL 14、Redis 7、Vue 3、Element Plus、Jest、Playwright、钉钉官方 Node Stream SDK。无新微服务。

**Spec:** `docs/superpowers/specs/2026-10-12-dingtalk-ai-progress-bot-design.md`（执行前同时阅读 `AGENTS.md` 和 `docs/project-memory.md`）。

## Global Constraints

- 员工本人设定目标、上级审核；本期只更新已经确认的本人目标进展，不改目标基线、评分或审核流程。
- HRM/花名册是人员与任职权威；钉钉只提供身份与消息，不以通讯录、姓名或钉钉组织关系猜测目标权限。
- 机器人总开关默认关闭；试运行仅受控账号；不主动发送提醒、不向真实员工发送测试消息。
- 未通过名单、身份、有效任职、考核范围和可更新目标校验的消息不调用模型、不生成草稿/卡片、不写正式记录；不提供通用 AI 闲聊。
- AI Key 只写、服务端加密、独立主密钥；不回显、记录或提交密钥、完整聊天正文、模型原始响应。不使用 Kimi Code 凭据代替 Kimi API 开放平台凭据。
- 同时只激活一个服务商；失败不自动切换；切换仅影响新消息。服务商 URL 固定在适配器中，管理页不能输入任意 URL。
- 新进展必须点击“保存进展”才写入；定性进展不显示 0%，量化超额保留实际/目标与超额完成度，进度条最多 100%。
- 每任务只提交本任务文件；保护当前 `web/e2e/specs/23-employee-data-review.spec.ts`、`web/src/views/admin/UserManageView.vue`、`web/src/views/admin/components/DepartmentCreateDrawer.vue` 的其他未提交修改。

## Review Focus

1. 名单外、无绑定、离职或未纳入绩效的发送人：只得对应提示，模型调用次数、草稿数和正式记录数均为零（Task 5）。
2. 多目标、单位不明或模型返回他人目标 ID：不能直接保存；必须由员工在确认页选定/补齐（Tasks 2、7）。
3. 密钥缺失、错误、超时、限流或服务商返回畸形结构：不泄密、不自动转发给另一服务商、不写正式记录（Tasks 2、3）。
4. 重复点击、重试、转发卡片、草稿过期与月度提交并发：至多一条本人正式进展；已保存重试返回原记录（Tasks 6、7）。
5. 无数值基线、定性更新及超额完成：旧目标列表/详情不出现假 0%，量化实际/目标和 120% 等事实仍可读（Task 1）。

## File/Interface Map

- `api/src/objectives/`：既有正式进展、候选目标准入及读模型；这里持有最终可写判断，不在机器人内复制绩效规则。
- `api/src/ai-progress/`：统一候选结构、三家固定域名适配、加密配置、草稿、保存编排和认证后的确认 API。
- `api/src/dingtalk/`：Stream 会话、单聊消息与互动卡片适配；不持有业务权限或 AI 密钥。
- `web/src/views/system/`、`web/src/views/ai-progress/`：管理员配置和员工确认；目标跟进旧页面只做空值/实际值兼容。
- `api/prisma/migrations/`：先扩展旧进展表，再建独立服务商凭据表；`system_configs` 只放非敏感开关、当前服务商与受控用户 ID。

---

### Task 1: 扩展正式进展与旧页面的空值语义

**Files:** Modify `api/prisma/schema.prisma`, `api/src/objectives/objectives.service.ts`, `api/src/objectives/objectives.service.spec.ts`, `api/src/objectives/dto/update-indicator-progress.dto.spec.ts`, `web/src/types/api.types.ts`, `web/src/views/objectives/GoalTrackingCyclePanel.vue`, `web/src/views/objectives/GoalTrackingIndicatorPanel.vue`, `web/src/views/objectives/GoalTrackingDetailDrawer.vue`, `web/src/views/objectives/goal-tracking.ts`; create `api/prisma/migrations/202610120001_ai_progress_fields/migration.sql`; test `web/e2e/specs/41-goal-progress-entry.spec.ts`, `web/e2e/specs/12-goal-tracking-model.spec.ts`.

**Interfaces:** Preserve old `UpdateIndicatorProgressDto` required `progress: 0..100` and `healthStatus`; widen `UpdateIndicatorProgressInput` to `progress: number | null`, `healthStatus: IndicatorProgressHealth | null`, `actualValue?: string | null` for AI saves. Add optional `actualValue`, `targetValueSnapshot` (`Decimal(10,2)`), `unitSnapshot`, `aiAssisted` (default false), and unique nullable `aiDraftId` (UUID) to `IndicatorProgressUpdate`. Read DTOs expose `actualValue`, `targetValueSnapshot`, `unitSnapshot`, `completionPercent`; `GoalTrackingItem.progress` becomes `number | null` only when latest progress is qualitative (no record retains existing 0 behavior). Quantitative completion comes from stored actual/target; bar uses `min(100, completionPercent)`.

- [ ] **Step 1: Write failing tests.** Name `preserves legacy DTO while serializing qualitative and 120 percent AI progress`; key assertions: `expect(result.completionPercent).toBe(120)`, `expect(result.progress).toBe(100)`, `expect(indicator.actualValue).toBeNull()`. DTO still rejects missing progress. Playwright asserts qualitative list/detail contain neither `0%` nor `null%`, while historical numeric records remain unchanged.
- [ ] **Step 2: Run failing tests.** `npm --prefix api test -- --runInBand objectives.service.spec.ts update-indicator-progress.dto.spec.ts`; `npm --prefix web run test:e2e -- e2e/specs/41-goal-progress-entry.spec.ts e2e/specs/12-goal-tracking-model.spec.ts`. Expected: new assertions fail only for missing fields/semantics.
- [ ] **Step 3: Add Prisma fields and SQL migration.** Run `npm --prefix api exec prisma validate` and `npm --prefix api exec prisma generate`; expected: both succeed.
- [ ] **Step 4: Extend `ObjectivesService` write/read mapping.** Derive numeric percent on the server from employee-confirmed actual and current formal target; reject negative/non-finite/over-precision actual; never trust model target/percent. Preserve monthly-review reads and old Web write contract.
- [ ] **Step 5: Adapt the named Vue consumers and types** so null completion is hidden, 120% comes from snapshots and the bar is capped at 100.
- [ ] **Step 6: Verify.** Rerun focused API/Web tests, `npm --prefix web run type-check`, `npm --prefix api run build`. Expected: all pass, no fake 0%.
- [ ] **Step 7: Commit only Task 1 files** after `git diff --cached --check` and staged-file review.

### Task 2: 三家模型的候选识别适配

**Files:** Create `api/src/objectives/bot-goal-access.types.ts`, `api/src/ai-progress/recognition.types.ts`, `api/src/ai-progress/provider-client.ts`, `api/src/ai-progress/provider-client.spec.ts`.

**Interfaces:** `BotGoalCandidate = { id: string; title: string; targetValue: string | null; unit: string | null; periodId: string | null; periodKey: string | null }` and `BotGoalAccess` union live in `bot-goal-access.types.ts` for Tasks 5–7. `ProgressCandidate = { indicatorId: string | null; content: string; actualValue: string | null; healthStatus: IndicatorProgressHealth | null; uncertain: boolean }`; `ProviderClient.recognize(input: { message: string; goals: BotGoalCandidate[] }, config: { provider: 'kimi'|'deepseek'|'qwen'; apiKey: string; modelId: string; region?: string; workspaceId?: string }): Promise<ProgressCandidate>`. Request contains only current message and those goal fields; return candidate ID must be in input goals.

- [ ] **Step 1: Write failing mocked-fetch tests.** Name `does not accept foreign indicator or fail over on provider error`; key assertions: `expect(candidate.indicatorId).toBeNull()`, `expect(otherProviderFetch).not.toHaveBeenCalled()`. Also cover fixed hosts, invalid decimal/status, oversized text, ambiguity and 401/429/timeout without logging key/body.
- [ ] **Step 2: Run `npm --prefix api test -- --runInBand provider-client.spec.ts`.** Expected: FAIL because adapter is absent.
- [ ] **Step 3: Implement non-streaming text requests and strict response parser.** Use provider-specific fixed endpoints and bounded timeout/response size. Qwen region/workspace is validated against an allowlist, not concatenated from arbitrary URL; verify current endpoint/model compatibility against linked official docs before implementation. No live key or employee text in tests.
- [ ] **Step 4: Rerun focused tests and `npm --prefix api run build`.** Expected: PASS.
- [ ] **Step 5: Commit only adapter and test files.**

### Task 3: 加密凭据与仅管理员可用的动态配置 API

**Files:** Modify `api/prisma/schema.prisma`, `.env.example`, `api/src/app.module.ts`; create `api/prisma/migrations/202610120002_ai_provider_credentials/migration.sql`, `api/src/ai-progress/ai-progress.module.ts`, `ai-config.service.ts`, `ai-config.controller.ts`, `dto/ai-config.dto.ts`, `ai-config.service.spec.ts`, `ai-config.controller.spec.ts`.

**Interfaces:** `AiProviderCredential(provider unique, encryptedKey Bytes, modelId, region?, workspaceId?, configVersion Int, testedVersion Int?, testedAt?, updatedAt)`; `AiConfigService.getPublicState()`, `saveProvider(provider, dto, operatorId)`, `testProvider(provider, operatorId)`, `activate(provider, operatorId)`, `setBotEnabled(enabled, operatorId)`, `setAllowlist(userIds, operatorId)`, `getActiveRuntimeConfig()`; edits increment `configVersion`, and activation requires `testedVersion === configVersion`. All mutations audit only safe metadata. Admin routes under `/ai-progress/config` use `@Roles(SysRole.system_admin)`; responses expose configured/tested/active status but never encrypted or plaintext key. `AI_PROVIDER_ENCRYPTION_KEY` must Base64 解码为独立的 32 字节主密钥；缺失或格式错误时机器人保持关闭。

- [ ] **Step 1: Write failing tests.** Name `does not activate stale or untested provider`; key assertions: `expect(state.activeProvider).toBeNull()`, `expect(JSON.stringify(state)).not.toContain('apiKey')`. Cover HR/employee/manager denial, AES round-trip, wrong/missing master key, changed key/model/region invalidating a test, disabled bot, and safe audit.
- [ ] **Step 2: Run `npm --prefix api test -- --runInBand ai-config.service.spec.ts ai-config.controller.spec.ts`.** Expected: FAIL for absent API/model.
- [ ] **Step 3: Add credential model and migration.** Run Prisma validate/generate; expected: success without changing existing data.
- [ ] **Step 4: Implement AES-256-GCM credential service** with independent environment key and version-bound synthetic connection test.
- [ ] **Step 5: Implement admin DTO/controller and `system_configs` keys** `ai_progress_active_provider`, `ai_progress_bot_enabled`, `ai_progress_allowlist`; register `AiProgressModule` in `AppModule` with `AuthModule`/`ObjectivesModule` imports and safe audit metadata. Do not reuse notification switch, `JWT_SECRET`, archive encryption key or Kimi Code key.
- [ ] **Step 6: Run focused tests and `npm --prefix api run build`.** Expected: PASS and config GET serialization contains no secret fields.
- [ ] **Step 7: Commit only Task 3 files.**

### Task 4: 系统管理配置页

**Files:** Create `web/src/api/ai-progress.api.ts`, `web/src/views/system/AiServiceConfigView.vue`, `web/e2e/specs/42-ai-service-config.spec.ts`; modify `web/src/router/routes.ts`, `web/src/types/api.types.ts`.

**Interfaces:** Route `/system/ai-services`, navigation label `AI 服务配置`, role `system_admin`; Web API mirrors Task 3 config endpoints. Key field is blank on every load and sent only on explicit replacement; provider model/region/workspace fields and test/activate/bot switch/controlled users have distinct actions and status text.

- [ ] **Step 1: Write failing Playwright test.** Name `admin configures but cannot read stored key`; key assertions: `await expect(page.getByText('已配置')).toBeVisible()` and `await expect(page.getByRole('textbox', { name: 'API Key' })).toHaveValue('')` after reload. Cover HR/employee denial, stale test rejection and PC/390px controls/errors.
- [ ] **Step 2: Run `npm --prefix web run test:e2e -- e2e/specs/42-ai-service-config.spec.ts`.** Expected: FAIL for missing route/page.
- [ ] **Step 3: Implement minimal Element Plus page/API/route**, with business-language labels and field-level errors; no changes to existing System Overview layout.
- [ ] **Step 4: Run focused Playwright, `npm --prefix web run type-check` and `npm --prefix web run build`.** Expected: PASS.
- [ ] **Step 5: Commit only Task 4 files.**

### Task 5: 钉钉发送人、受控名单与本人可更新目标判定

**Files:** Create `api/src/ai-progress/bot-eligibility.service.ts`, `api/src/ai-progress/bot-eligibility.service.spec.ts`; modify `api/src/objectives/objectives.service.ts`, `api/src/objectives/objectives.service.spec.ts`, `api/src/auth/auth.service.ts`, `api/src/auth/auth.service.spec.ts`.

**Interfaces:** `ObjectivesService.findBotGoalAccess(viewer: AuthUser): Promise<BotGoalAccess>` uses existing `canSubmitActiveProgress`/period checks; `BotGoalAccess` is the Task 2 union of `{ kind: 'ready'; goals: BotGoalCandidate[] }` and `{ kind: 'no_cycle'|'not_participant'|'awaiting_goal_approval'|'month_locked'|'self_eval_submitted'; message: string }`. `BotEligibilityService.resolve(sender: BotSender): Promise<{ kind:'ready'; viewer: AuthUser; goals: BotGoalCandidate[] } | { kind:'reply'; text:string }>` where `BotSender = { corpId: string; senderStaffId: string; conversationId: string; conversationType: string; deliveryId: string }`. Resolve enabled binding by external user ID, otherwise `DingtalkService.fetchUserDetail` → unionId; then reuse `AuthService` effective-employment validation, check controlled HRM user ID before any performance query. Reject wrong corporation/group sessions before model call.

- [ ] **Step 1: Write failing tests.** Name `returns no-progress reply without exposing goals`; key assertion: `expect(result).toEqual({ kind: 'reply', text: '你当前没有可更新的绩效目标。如果你认为自己应参加本期考核，请联系绩效管理员核对参与范围。' })`. For名单外 assert `expect(objectives.findBotGoalAccess).not.toHaveBeenCalled()`. Cover no cycle, unconfirmed goals, locked/submitted month, disabled binding, resignation, wrong corp/group and foreign goals; Task 9 asserts zero provider calls end-to-end.
- [ ] **Step 2: Run `npm --prefix api test -- --runInBand bot-eligibility.service.spec.ts objectives.service.spec.ts auth.service.spec.ts`.** Expected: FAIL for absent methods.
- [ ] **Step 3: Implement eligibility using current HRM task/period state.** Make the existing auth employment check reusable instead of copying rules; no DingTalk organization sync or name/phone fallback. Limit returned candidate fields to Task 2 contract.
- [ ] **Step 4: Rerun focused tests and `npm --prefix api run build`.** Expected: PASS with zero performance queries for名单外 and zero model calls for all blocked states.
- [ ] **Step 5: Commit only Task 5 files.**

### Task 6: Redis 草稿与幂等正式保存

**Files:** Create `api/src/ai-progress/progress-draft.store.ts`, `ai-progress.service.ts`, `ai-progress.controller.ts`, `dto/save-progress-draft.dto.ts`, `ai-progress.service.spec.ts`; modify `api/src/objectives/objectives.service.ts`, `api/src/objectives/objectives.service.spec.ts`, `api/src/ai-progress/ai-progress.module.ts`.

**Interfaces:** `AiProgressService.prepare(message: string, sender: BotSender): Promise<ProgressPreview>` calls Tasks 2/5, deduplicates `sender.deliveryId`, and writes Redis `ai-progress:draft:<UUID>` with 86400-second TTL and owner/session/provider-version/goal candidates; `getDraft(draftId: string, viewerId: string)`, `updateDraft(draftId: string, viewerId: string, changes: ConfirmedDraftChanges)`, `saveDraft(draftId: string, viewerId: string, conversationId?: string)` share one owner-checked path for card and JWT-confirmation API. Define `ProgressPreview` and `ConfirmedDraftChanges` in `recognition.types.ts` when this task starts; the latter contains only editable goal ID, content, actual value and health status. Authenticated routes are `GET/PATCH /ai-progress/drafts/:id` and `POST /ai-progress/drafts/:id/save`. `ObjectivesService.updateIndicatorProgress(indicatorId, input, viewer, options?: { aiDraftId: string; aiAssisted: true })` receives `input.actualValue` from confirmed draft and rechecks current formal target, month and actor inside its transaction; database `aiDraftId` unique constraint is final retry guard. Duplicate requests return the saved row only after verifying same owner.

- [ ] **Step 1: Write failing tests.** Name `saves each confirmed draft once`; key assertions: `expect(savedAgain.id).toBe(saved.id)`, `expect(await prisma.indicatorProgressUpdate.count()).toBe(1)`. Cover Redis-only preview/86400-second TTL, expired/foreign owner, 12/10 = 120%, audit, no assessment write, correction history, provider switch without re-call, month-close race and card-refresh failure.
- [ ] **Step 2: Run `npm --prefix api test -- --runInBand ai-progress.service.spec.ts objectives.service.spec.ts`.** Expected: FAIL for absent draft/save path.
- [ ] **Step 3: Implement Redis draft store** from `REDIS_URL` with 86400-second expiry and delivery ID deduplication.
- [ ] **Step 4: Implement shared prepare/get/update/save methods.** Validate edited content/actual/status/server-owned target; use existing progress transaction/lock order and audit, catching only unique-draft conflicts for idempotent return.
- [ ] **Step 5: Expose authenticated draft controller endpoints** with owner check on every request.
- [ ] **Step 6: Rerun focused tests and `npm --prefix api run build`.** Expected: PASS, one row per draft.
- [ ] **Step 7: Commit only Task 6 files.**

### Task 7: 钉钉 Stream 单聊与互动卡片

**Files:** Create `api/src/dingtalk/dingtalk-bot.gateway.ts`, `api/src/dingtalk/dingtalk-bot.gateway.spec.ts`, `api/src/dingtalk/dingtalk-card.presenter.ts`; modify `api/src/ai-progress/ai-progress.module.ts`, `api/package.json`, `api/package-lock.json`, `.env.example`.

**Interfaces:** Gateway uses the official `dingtalk-stream` Node SDK and existing HRM DingTalk app credentials; starts only if bot config/keys/permissions are present. Message handler accepts configured enterprise/application and one-to-one text only; callback resolves card sender and calls `AiProgressService.saveDraft`, never trusts card ID as authorization. Presenter has `sendPreview`, `sendBusinessReply`, `markSaved`; card shows goal/month, editable actual/target context, “修改” and “保存进展”.

- [ ] **Step 1: Write failing SDK-mocked tests.** Name `does not save forwarded card`; key assertions: `expect(progressUpdate.create).not.toHaveBeenCalled()`, `expect(card.actions).not.toContain('保存进展')` for ambiguous match. Cover wrong enterprise/group/disabled bot, duplicate Stream delivery, expired draft and card-refresh failure.
- [ ] **Step 2: Run `npm --prefix api test -- --runInBand dingtalk-bot.gateway.spec.ts`.** Expected: FAIL for missing gateway.
- [ ] **Step 3: Add SDK and adapter**, registering the gateway in `AiProgressModule` and injecting the existing global `DingtalkService` without making `DingtalkModule` depend on AI. Use current official Stream/card protocol verified at implementation time; no webhook/group-bot parallel path. Never enable outbound test delivery by default.
- [ ] **Step 4: Rerun focused tests and `npm --prefix api run build`.** Expected: PASS with mocked transport and disabled-by-default startup.
- [ ] **Step 5: Commit only Task 7 files.**

### Task 8: 钉钉内员工确认页

**Files:** Create `web/src/views/ai-progress/AiProgressConfirmView.vue`, `web/e2e/specs/43-ai-progress-confirm.spec.ts`; modify `web/src/router/routes.ts`, `web/src/api/ai-progress.api.ts`, `web/src/types/api.types.ts`.

**Interfaces:** Authenticated non-navigation route `/ai-progress/confirm/:draftId`; GET/patch/save use Task 6 endpoints and current HRM login. Page shows only current user's draft, candidate goal selector, description, actual value/unit, status, computed preview and explicit “保存进展”; no automatic save on open/close. Saving/loading errors preserve edits.

- [ ] **Step 1: Write failing Playwright test.** Name `employee must explicitly save corrected draft`; key assertions: `await expect(page.getByText('120%')).toBeVisible()` for 12/10 and `await expect(page.getByRole('button', { name: '保存进展' })).toBeEnabled()` only after required selections. Cover qualitative no 0%, wrong user/expiry, 390px action, preserved edits and retry.
- [ ] **Step 2: Run `npm --prefix web run test:e2e -- e2e/specs/43-ai-progress-confirm.spec.ts`.** Expected: FAIL for missing route/page.
- [ ] **Step 3: Implement page against Task 6 API.** Use ordinary HRM DingTalk login; draft URL alone never authorizes access. Show specific field errors and manual HRM update link on recoverable failure.
- [ ] **Step 4: Run focused Playwright, `npm --prefix web run type-check` and `npm --prefix web run build`.** Expected: PASS on PC/mobile.
- [ ] **Step 5: Commit only Task 8 files.**

### Task 9: 跨模块回归、受控验收与发布闸门

**Files:** Create `api/test/ai-progress.e2e-spec.ts`; update `docs/project-memory.md` only after actual status evidence exists. No production config or real employee data in source control.

**Interfaces:** End-to-end case uses isolated PostgreSQL/Redis, fake provider and mocked DingTalk transport, exercising exact Task 5→2→6→7 flow. Operational release checklist is a gate, not an automatic deploy step.

- [ ] **Step 1: Add integrated tests** named `rejects out-of-scope before model`, `saves confirmed quantitative progress once`, `keeps qualitative completion empty`; key assertions: `expect(provider.recognize).not.toHaveBeenCalled()` for blocked senders, `expect(rows).toHaveLength(1)` after repeat save, and `expect(detail.progress).toBeNull()` for qualitative. Cover admin-only config, employee/manager/other-user reads and month-lock race.
- [ ] **Step 2: Run `npm --prefix api run test:e2e -- --runInBand ai-progress.e2e-spec.ts`.** Expected: integration contract passes; if it fails, capture the exact stage and cause.
- [ ] **Step 3: Fix only owning-component integration defects and rerun full verification.** Commands: `npm --prefix api test -- --runInBand`; `npm --prefix api run build`; `npm --prefix web run type-check`; `npm --prefix web run build`; `npm --prefix web run test:e2e -- e2e/specs/41-goal-progress-entry.spec.ts e2e/specs/42-ai-service-config.spec.ts e2e/specs/43-ai-progress-confirm.spec.ts`. Expected: all pass or exact failing debt documented; no compile-only acceptance claim.
- [ ] **Step 4: Commit only integration tests and evidence-backed status docs.** Recheck all staged files; do not include unrelated worktree changes.
- [ ] **Step 5: Controlled DingTalk acceptance preflight.** Verify current application robot, Stream and card template permissions, selected account/provider key, configured enterprise, test identities and no real-employee deliveries; if anything is missing, leave bot off and report blocker. Do not paste a credential into logs, tests or docs.
- [ ] **Step 6: Before any authorized production change**, recheck `main`/`origin/main`/production hashes, backup PostgreSQL and test restore/migration, retain identifiable API/Web rollback images, deploy only changed API/Web services, ensure `ENABLE_TEST_QUICK_LOGIN=false`, verify external health/migration/assets, then test controlled employee/manager/admin paths. Code committed, pushed, deployed and business-accepted must be reported separately. Stop before enabling general delivery or reminders; that is outside Phase 1.

## External API verification at execution

- DingTalk Stream Node SDK and app-robot setup: https://opensource.dingtalk.com/developerpedia/docs/explore/tutorials/stream/bot/nodejs/build-bot/ and https://opensource.dingtalk.com/developerpedia/docs/explore/tutorials/stream/bot/nodejs/create-bot/ .
- Kimi API product/key distinction: https://www.kimi.com/help/kimi-api/api-overview ; DeepSeek Chat API: https://api-docs.deepseek.com/api/create-chat-completion/ ; Qwen regional endpoint: https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions/ .
