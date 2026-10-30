# Archive Assistant Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Execute continuously; the human has approved the design and asks to complete and launch it.

**Goal:** 姚瑶 can privately request a fabricated archive sample in DingTalk, preview it, explicitly save a draft, and open the existing HRM record without changing formal personnel data.

**Architecture:** Reuse EmployeeDataChangeRequest and EmployeeArchivesService transaction helpers. A short-lived signed preview links the verified DingTalk sender to the authenticated HRM operator; no model or new card template is needed for the fixed fabricated pilot. The preview page is a thin confirmation step and delegates maintenance to the current personnel page.

**Tech Stack:** Existing NestJS/Prisma/PostgreSQL, Node crypto, Vue3/ElementPlus, Jest/Playwright; no new dependencies or schema migrations.

**Spec:** docs/requirements/2026-10-30-employee-archive-assistant-intake.md (human approved 2026-10-30).

## Global Constraints

- Only employeeNo `312`, actual employee account, existing `employee_archive_edit`, existing DingTalk admission. No extra identity, capability, source access, OA reads, real model transfer or proactive messages.
- Explicit feature gate `ARCHIVE_ASSISTANT_PILOT_ENABLED=true`, default off. Fabricated sample only: unbound `【测试】档案助手样例`, no phone/ID/company/employment status/department/account/employeeNo; workLocation `杭州（测试资料）`.
- No submission/approval/application of pilot-source records even if edited through ordinary HRM forms. Source discriminator `archive_assistant_pilot` must remain server-owned and survive normal draft edits. No new authoritative ledger.
- Preview is read-only. New save writes existing draft + source + issue + audit atomically. Replay returns current real status; no resetting submitted/applied/cancelled records, no duplicate draft/audit. Stale preview or cross-actor/source refuses.
- Original main docs/project-memory.md is unrelated dirty work; preserve it. Production baseline must be rechecked before release. API/Web only; backup + restore check + rollback images; quick-login stays off.

## Review Focus

- A forwarded URL or revoked HR capability never permits preview/save; revalidate database actor and DingTalk binding.
- A synthetic draft edited in normal forms still cannot be submitted/approved or allocate an employee number.
- Two simultaneous saves/events cannot duplicate an active pilot draft or overwrite existing HR draft.
- A successful request whose reply fails replays current state without duplicate audit; signed payload excludes client field overrides.
- Mobile navigation and late responses cannot show/save another preview; token never appears in app logs or audit.

### Task 1: Controlled draft reception and HTTP boundary

**Files:** Create api/src/employee-archives/archive-assistant.service.ts, archive-assistant.controller.ts and focused specs. Modify employee-archives.module.ts, employee-archives.service.ts, employee-data-reviews.service.ts and existing issue source constant/tests as necessary.

**Interfaces:** Export ArchiveAssistantService from EmployeeArchivesModule. `prepare(viewer: AuthUser, source: {corpId:string; senderStaffId:string; conversationId:string; deliveryId:string}): Promise<{url:string}>`; `preview(token:string, viewer:AuthUser)`; `save(token:string, viewer:AuthUser)`. GET `/employee-archives/assistant/preview` using `x-archive-preview` header; POST `/employee-archives/assistant/save` body `{token}`. Return preview fields `employeeName`, `workLocation`, `notice`, `expiresAt`, `saved` (null or {requestId,requestVersion,recordStatus,url,replayed}). Save returns that saved object. Saved URL `/users?assistantRequestId=<id>` (existing personnel route verified). All DTOs strict and no external proposal/actor/source values. Preview signature includes source event hash, actor and 10 minute expiry and version; compare HMAC with timingSafeEqual and bounded input. No sensitive values in token. Preview link `/archive-assistant/preview/:sourceReference#preview=<token>`; strip fragment into sourceReference-keyed sessionStorage before any login redirect; signed token never enters request URI/access logs.

- [ ] Write failing specs for permission revocation/other actor/gate disabled/signature/expiry; preview zero writes; fixed sample; explicit save no user/number/contract writes; atomic rollback; concurrent replay/conflicting source payload; replay after state change; existing active pilot draft; source survives ordinary edits; submission and approval reject pilot before reserve/apply.
- [ ] Run focused Jest, observe intended assertion failures, record output.
- [x] Extract the existing new-employee draft save transaction body into a shared with-client helper (ordinary save retains behavior); extend trusted source metadata + warnings internally, source cannot enter via public DTO. Pilot service uses same helper inside its READ COMMITTED transaction and per-actor advisory lock; dedupe source unique and active pilot requests. Reuse existing JSON/normalization/audit behavior, avoid parallel draft creation.
- [ ] Block pilot source in all existing manual-new-employee submission and review application paths, retaining normal records behavior. No need to expose existing-employee changes during this fabricated unbound pilot; future generic changes remain in spec and explicitly deferred from this rollout.
- [ ] Run focused tests and API build. Commit only task source/tests and report exact evidence, paths and remaining concerns.

### Task 2: DingTalk entry and thin preview page

**Files:** Modify api/src/dingtalk/dingtalk-bot.gateway.ts and spec, api/src/ai-progress/ai-progress.module.ts. Add web/src/views/employee-archives/ArchiveAssistantPreviewView.vue and web/src/api/archive-assistant.api.ts, route/navigation metadata. Modify existing UserManageView.vue only for assistantRequestId deep-link to its existing application detail. Add focused Playwright.

**Interfaces:** Consume Task 1 API. After existing verified identity admission, exact text `档案测试` prepares only the fixed sample and sends a business reply with signed preview URL. `档案帮助` explains the pilot and that preview alone saves nothing. All other commands/performance behavior unchanged. No automatic archive-specific callbacks, no new template or provider call. Final send uses existing presenter re-admission/deduplication. Existing help may append short pilot entry only for eligible pilot HR.

- [ ] Write failing gateway tests for single pilot allowed, no other recipients/groups/providers, no draft until explicit HTTP save; ordinary performance commands unchanged.
- [ ] Implement gateway injection/import and exact command branch before performance/progress fallback; catch with archive-specific safe error without input/token leakage.
- [ ] Write failing Playwright with mock HTTP for PC/390px, GET-only initial load, save click/double-click/replay, login return, expired/403/409/network error, route switch/late response; save result opens current personnel detail with existing role route guard.
- [ ] Implement one compact preview page showing synthetic badge, source HR-provided/not OA-verified, sample facts, explicit `保存待核草稿`, saved real state and `打开草稿` link. Capture fragment before auth/login guard; use sessionStorage keyed by route reference, validate route changes and suppress stale responses. Existing save/detail link `/users?assistantRequestId=<id>`. No new maintenance form or menu.
- [ ] Run focused gateway, Web type-check/build/Playwright, commit and report.

### Task 3: Integrated acceptance and release

**Files:** Add bounded isolated acceptance harness under api/scripts and deployment/verification notes in docs/dingtalk; release scratch stays in ignored tmp or C:/Users/lwei/kayford-releases/archive-assistant-intake-20261030.

- [ ] Final independent review full branch + connected shared save/submit/review/identity/delivery paths; address findings and scoped re-review.
- [ ] Full API Jest/build, Web type-check/build + targeted existing personnel/issue tests. Actual PostgreSQL HTTP candidate checks synthetic users/records: draft-save/replay/concurrency/rollback/denials/submission block/DB preservation. No production synthetic save unless human initiates it in authorized pilot.
- [ ] Recheck main/origin and live image against baseline; integrate only this branch, preserve dirty main file, push and verify HEAD=origin/main. Build from clean committed source.
- [ ] Back up production and prove isolated restore; preserve API/Web rollback images and stateful IDs. No migration expected. Set only the new pilot gate after proven single-user/capability/binding checks, keep existing bot config and allowlist intact. Replace API/Web only.
- [ ] Verify external health, JS hash/content, migration state/quickLogin false, single-user read-only authenticated preview, other identities denied, production business fingerprints unchanged; no proactive bot message. Provide exact command `档案测试` for Yao and honestly distinguish synthetic automated acceptance from human DingTalk end-to-end.

## Preflight rulings

- User's current instruction approves execution and launch of the previously explained pilot. Do not ask again about implementation method or rollout within that scope.
- Generic real-employee changes, free-text/model extraction, and non-DingTalk channels are subsequent slices; this rollout is explicitly the fixed fabricated unbound sample, matching the approved first trial.
- Use authenticated HRM preview link and existing personnel details rather than creating/publishing another native template. A clickable save lives on the thin HRM preview page.
- If production Yao lacks existing archive_edit or channel admission, do not grant it; finish candidate and report the exact required decision.

## Execution checkpoints (2026-10-31)

- Task 1 implemented and independently reviewed. Pilot lifecycle ownership and restore prohibition fixed; old mixed-batch restore fixture updated without weakening assertions.
- Task 2 implemented and independently reviewed. Actual mocked external OAuth action/callback now returns to the preview with no token in URLs; reserved archive commands with extra material are rejected before recognition/model access.
- Evidence: 32 archive preview/browser cases + 15 existing login cases + 50 existing personnel/source-issue cases passed using isolated mocked HTTP; Web type/build passed. Full API and real PostgreSQL candidate checks remain separately recorded in release QA/proofs.
- Guarded release/probe preparation: 27 offline checks, syntax and zero-network self-check passed; independent review and submission-guard proof fix closed. Runtime candidate proof, deployment and actual DingTalk user acceptance are distinct remaining gates.
- The user authorized implementation and launch of this bounded pilot; merge/push/release proceed within it without another implementation-method question. No broader business capability is enabled by that authorization.
