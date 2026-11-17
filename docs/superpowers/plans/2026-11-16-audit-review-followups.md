# Audit Review Followups Implementation Plan

**Goal:** Fix the three review findings approved by the user: stale self-evaluation completion, authenticated attachment downloads, and transient approval conflicts.

**Architecture:** Keep current task identities, archive authorization and Serializable approval transactions. No schema change, approval-policy change, production data write, commit or release.

**Spec:** This chat's code review and user instruction to fix it. Existing AGENTS.md preview/release and concurrent-work boundaries apply.

## Tasks

- [x] Main: add failing SFC regressions for A submission completing after switching to B, leaving, or reopening A. Eight new cases failed before the fix; final SFC suite 30/30 passed. Real delayed backend submission with B draft preservation/reload passed on PC/mobile (2/2). Bind side effects to the original load session and component, and never clear a different draft. Check two-request actual-value/self-evaluation sequencing.
- [x] Download worker: 22 RED then 22 GREEN tests; three callers now use authenticated same-origin Blob downloads. Real PC/mobile checks passed (2/2: six byte-verified downloads plus two permission denials), owned files/tasks/cycles cleaned. Web Node 272/272, type-check and build passed. Main integrated TaskDetail markup; no permission loosening or URL tokens.
- [x] Approval worker: 28 GREEN regressions after RED cases; retry only genuine P2034 up to 3 total attempts, preserve business messages and sanitize other errors. Each retry rereads request/status/base guards. Authorization remains the supplied request AuthUser, not a fresh database role lookup. No success/audit duplication.
- [x] Main: strict API final 168 suites/2876 tests passed; API/Web build and Web type-check passed. Preview refreshed with production IDs unchanged. Real PostgreSQL forced interleavings (transient, exhausted, cancellation) passed with owned cleanup; normal dual-HR PC/mobile 2/2 passed.
- [x] Independent review passed scoped UI/API checks (52+28 targeted cases), and reviewed real-DB test quality. Acceptance record docs/acceptance/2026-11-16-audit-review-followups.md separates technical evidence/limits, the unrelated baseline H1/H2 contract debt, and four delivery states. Final preview/public health JSON ok, production unchanged, no staging/commit/release.

## Review Focus

- A late completion must not clear B's draft, issue the second write after a route change, reset a newer operation, or mutate an unmounted page.
- Downloads must preserve authenticated permission denial, reject external URLs and clean up Blob URLs; click tests must verify file bytes, not merely upload success.
- Retried approval must reread the request and all guards, with no writes or notifications outside the rolled-back transaction duplicated.
- An exhausted conflict must retain a pending unactivated request and expose only a business-level retry message.
- No production replacement or live employee changes. Reuse prior unchanged evidence without claiming older integration as proof of changed code.
