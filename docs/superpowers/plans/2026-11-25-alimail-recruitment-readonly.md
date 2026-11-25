# Alimail Recruitment Read-Only Intake Implementation Plan

> **For agentic workers:** Use bounded parallel workers and superpowers:executing-plans. Preserve the existing uncommitted recruitment demand/intake feature and other worktrees.

**Goal:** Add a real Alibaba Mail adapter for the single approved recruitment folder, plus private local credential entry and a no-import connection probe.

**Architecture:** Keep the existing RecruitmentMailboxGateway and intake transaction as the business boundary. Use ImapFlow and MailParser for read-only exact-folder IMAP/MIME. Default remains disabled; no mailbox credential or real mail enters the fictional preview. A Windows CurrentUser DPAPI profile is for local setup/probe only, not silently deployed into Docker.

**Tech Stack:** NestJS, existing ConfigService/intake service, ImapFlow, MailParser, Node.js, Windows Forms/DPAPI.

**Spec:** `docs/requirements/2026-11-25-recruitment-resume-intake.md` package 3 and `docs/acceptance/2026-11-25-recruitment-mailbox-preflight.md`. User approved the exact folder and continuing integration, without moving historical mail, then explicitly asked to continue development. Client credential generation requires the user's own identity verification; do not create one or disable safety settings.

## Constraints

- No production publish, production configuration, grants, mailbox policy changes, SMTP/POP, mail moves/deletes/flags, historical scan, real AI or real candidate import.
- Fix provider host to official TLS IMAP 993, require verified TLS, exact configured folder (never INBOX fallback), explicit UTC authorized start and scope-bound UIDVALIDITY cursor.
- Private credential file only, no key in browser API, shell arguments, source, logs, screenshots or documents. Existing usable client password may be reused via secure local entry; a new one is not inherently required.
- Adapter emits unknown source/job unless reliable separately verified context exists. Display name is not proof of BOSS identity. No URL fetching or HTML rendering.
- Mail fetch is bounded by UID windows, message count/encoded size, attachment count/decoded bytes and elapsed time. Invalid MIME/oversize yields an actionable material issue rather than silent data loss.
- Keep mailbox checkpoint after terminal page so later reads do not rescan old messages. Cursor advances only when the existing entire-page persistence succeeds.
- Application-level folder enforcement is not a claim of provider-side folder-only credential permissions.

## Ownership

- Worker B: only new `api/src/talent-pool/recruitment-alimail-adapter.ts` and `.spec.ts`; adapter/config validation/read-only client wrapper and MIME normalization. No package, gateway, intake or module edits.
- Worker A: only new `scripts/configure-recruitment-mail.ps1` and `scripts/configure-recruitment-mail.test.cjs`; masked user-entry form, private CurrentUser DPAPI storage and safe metadata-only completion. No browser/auth automation or deployment.
- Parent: dependencies, gateway enablement/DI, terminal checkpoint contract/transaction, local no-import probe, integration tests/review and records.

## Task 1: Adapter (B)

- [x] Add failing tests for disabled/invalid config, host/TLS/exact folder, EXAMINE-only, PEEK fetch, UID holes and changed scope/UIDVALIDITY, bounded metadata/content, MIME/attachment/body-only/quarantine and redacted errors.
- [x] Implement `AlimailRecruitmentAdapter` with `status`, `probe`, and `readPage`; injectable client factory for tests, no sender inference or mutable IMAP commands. Config `{account,password,folder,authorizedFrom}`; factory builds official host/port/TLS/timeouts/logger:false. Pages extend existing mail contract with optional terminal `checkpointCursor` and bounded `materialIssue`.
- [x] Run focused tests, report exact contracts and source limits. Never contact real mail.

## Task 2: Local Credential Entry (A)

- [x] Write tests/self-checks for metadata/config validation, private output path, no overwrite, DPAPI round trip using fictional credential only and no credential output.
- [x] Create masked Windows Forms entry. Explicit account/folder on screen, user pastes client password manually; save a single DPAPI-encrypted JSON payload under a new current-user-only directory outside the repo. Do not read clipboard or browser.
- [x] Provide an opt-in isolated fictional self-test, not an unattended real credential creation. Do not launch until parent requests the real user handoff.

## Task 3: Parent Integration

- [x] Install exact official-registry library versions compatible with the existing preview runtime; preserve version 0.9.2. Use ImapFlow 2.12.2 / MailParser 3.15.0, not the older parser with new dependency advisories. Runtime requirement from HTML-to-text is Node >=20.19; preview is 20.20.2 and local probe uses the installed supported runtime rather than upgrading global Node.
- [x] Test terminal checkpoint validation and storage without changing existing fake gateway behavior; add quarantine issue mapping for messages too large to download safely.
- [x] Default-disabled gateway loads explicitly configured server-owned private credential file only. Browser cannot choose account/folder or supply credentials. Reject partial/invalid configuration without revealing values.
- [x] Add local no-import probe: decrypt only through current-user DPAPI process pipe, authenticate approved profile, open exact folder read-only, output counts/status only; never fetch bodies, import, send or change mail. It is not the production configuration loader.
- [x] Review security and run final affected API tests/build plus full API for shared persistence/dependency integration. Final API: 281 suites / 5779 tests; focused Windows 130, Linux 111; security scripts 15. Supported Linux preview built/refreshed; readonly PC/mobile demo 2/2. Reuse prior unaffected Web build/write-flow evidence.

## Task 4: Handoff And Remaining Gate

- [x] Verify secure form with fictional profile first; open real masked form for user only after code checks. User generates/reuses client password and pastes it locally, never in chat. DPAPI/ACL self-test passed; interactive process/title verified, visual/DPI acceptance and actual entry remain user steps (new window not in enabled CUA inventory).
- [ ] No real connection before profile ready and approved account/folder verified. Run only no-import probe; separately obtain approval for the test email and its bounded read.
- [x] Record implemented/committed/deployed/business accepted separately. No commit/push/release in this batch without new instruction; preserve the original pending recruitment work. See mailbox preflight acceptance record.
