# Resume Task Recovery Implementation Plan

> **For agentic workers:** Implement scoped tasks below with test-first checks. Do not commit, publish, or change real personnel data.

**Goal:** Make resume parsing observable, bounded, recoverable after closing/reloading, and safely retryable in the fixed isolated preview.

**Architecture:** Retain the existing synchronous parser for compatibility. Add short-lived encrypted PostgreSQL task records and short HTTP task/status endpoints; the existing API process executes each accepted parse. No new queue dependency or service. A stopped API attempt is never automatically replayed: its 150-second deadline becomes a visible failure and an explicit retry can reuse its file.

**Tech Stack:** NestJS, Prisma/PostgreSQL, existing scheduler, Vue/Element Plus, Playwright.

**Design:** User approved the preceding five-point proposal by requesting optimization and another test. Implementation choices: 30-minute retention; original owner only; AES-256-GCM using the configured AI master key with separate task AAD; no credentials in task records; encrypted original file and result; at most two processing / twenty retained tasks; cleanup each minute and expired records inaccessible immediately. Temporary records can also be cleared after successfully saving talent and file attachment. Logical deletion does not erase existing database backups.

## Contracts

- `ResumeTask`: `{ id, context, status: 'processing'|'succeeded'|'failed'|'timed_out', stage: 'recognizing'|'extracting', fileName, createdAt, deadlineAt, expiresAt, message?, result?: ResumeParseResult }`.
- `POST /talent-resume/tasks`: multipart one `file`, header `X-Resume-Context` (`new` or candidate ID, max100 safe ASCII); 202 returns task. Same owner/context/file processing or succeeded returns existing task. Different file while processing is rejected, not a second AI request.
- `GET /talent-resume/tasks/current?context=...`: own latest unexpired task or null.
- `GET /talent-resume/tasks/:id`: own unexpired task; others/unavailable =>404.
- `POST /talent-resume/tasks/:id/retry`: only failed/timed-out; new attempt reuses encrypted file, old task is not overwritten; idempotently returns current same-file attempt.
- `GET /talent-resume/tasks/:id/file`: same owner/capability, validated bytes as octet-stream; client filename from task metadata, no user-controlled response headers.
- `DELETE /talent-resume/tasks/:id`: clear source/result, abort local active attempt; 204. Close does NOT delete.
- Global `AI_RESUME_PARSING_ENABLED` remains required to start/retry; retrieval/cleanup still available to authorized owner when switch is off.

## Tasks

- [x] Backend: failing tests for owner isolation, duplicate requests, recovery, deadlines, retry, stale completions and cleanup; add encrypted task model/migration/service/controller; propagate stage and AbortSignal into existing parser.
- [x] Web: tests first, then API methods and compact elapsed/status panel; poll every2s; stop polling on close without canceling server; restore only matching context; recover source file into pending uploads; explicit retry/clear; preserve manually entered fields; do not persist PII in browser storage.
- [x] Verification: final API204 suites3527 tests, API build, Web type/build and focused tests; isolated real PostgreSQL HTTP checks and actual PC/mobile pages, including reload/retry. Stub provider evidence only for deterministic failure/timeout states, separate from the single real DeepSeek page call. Independent review boundary fixes and stale harness repair included.
- [x] Preview: standard launcher applied preview-only migrations, preserved production and parallel bank export changes. Enabled only resume parsing and official-only DeepSeek egress for fictional live checks/user trial; bot/calendar/notifications remain off. Last launcher warned about a parallel one-off production-labeled stopped container; inspected running production IDs unchanged and preview health OK. Details and outside-scope28 Node test debts recorded in acceptance doc.

## Review Focus

- Cross-account task IDs never disclose file names/results; same owner who loses archive-edit capability is denied.
- Poll timeout, new attempt and late upstream completion cannot overwrite each other.
- Closing/refreshing cannot lose an accepted task; network errors preserve input and offer reconnect.
- Recovered file is attached through existing validated upload/bind flow, no automatic talent creation.
- Process restart yields a bounded timed-out attempt, not an automatic extra billable request; user explicitly retries.

## State

Baseline main/origin 253d8278. Task and existing talent work uncommitted. Parallel bank-export files are excluded. Production unchanged. No global memory updates.
