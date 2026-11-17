# Contract usability implementation plan

> **For agentic workers:** Use subagent-driven-development for the independent API and UI tasks; the primary agent owns integration, validation and release.

**Goal:** Implement the eight contract-management improvements approved by the user, and deploy the verified change.

**Architecture:** Reuse the employee archive drawer, its versioned draft/submit transaction, upload service and audit history. Contract actions edit one selected record inside the existing drawer. Add derived presentation metadata, not a new approval workflow or automatic contract termination.

**Tech Stack:** Vue 3, Element Plus, NestJS, Prisma/PostgreSQL, Playwright.

**Spec:** User-approved eight-point optimization summary in this conversation, following the 2026-11-17 contract usability audit.

## Global constraints

- User explicitly authorized development and direct production release; no repeated preview approval required. Existing direct-main authorization applies; current main is clean at c418a238.
- Date states: 待生效、期限内、已到期、待核实. 无固定期限 is a term type, not a conflicting date state. Use Shanghai business dates.
- Show all non-removed contracts within term or upcoming; expired history collapses. Missing/invalid dates remain visible with reasons. Overlap is a nonblocking advisory, not an automatic termination.
- Distinguish retained/removed records from real expired contracts. Unknown old provenance must not be guessed. No physical deletion or source-date rewriting.
- Entry/exit, role permissions, employee identity and frozen performance snapshots are unchanged.
- Ordinary contract changes explicitly save and apply immediately; autosave only persists drafts. Preserve concurrency checks, upload gates and audit.
- No new external messages, calendar invitations or e-signing. No real-data acceptance writes.
- Version remains 0.8. Only API/Web deploy; retain rollback images, back up database, verify production runtime and external assets.

## Review focus

- Concurrent contracts, future renewal and invalid/missing dates must never hide today's contract or label unknown records terminated.
- A contract-only edit must preserve unrelated profile and contract records, and resume existing drafts without overwriting unsaved work.
- New/renewal/transfer prefills are editable; transfer must not silently alter employee company or old contract dates.
- Removing a row or leaving an editor during upload must not reattach late files or lose remaining contracts.
- Real HR edit capability must suffice; ordinary employees cannot access private materials; archived employees remain read-only.

### Task 1: API field errors and record provenance

**Owner:** backend agent. Files: employee-archives service, contract-subject helper as needed, new small contract-record-state helper and focused API specs.

- [x] Pin inactive subject errors to contracts.N.contractSubjectId with tests.
- [x] Derive active/removed/retained status only from reliable current flags and applied change snapshots; unknown inactive provenance uses retained, never terminated.
- [x] Return minimized additive record metadata in existing archive read response; keep request/authorization boundaries.
- [x] Verify targeted tests; root runs final API regression/build. Do not commit or deploy independently.

### Task 2: Contract UI and single-record actions

**Owner:** frontend agent. Files: UserManageView.vue, EmployeeArchiveInlineEditor.vue, focused contract fields component if useful, API types, interaction specs.

- [x] Add focused regression for direct actions and one-record editing before implementation.
- [x] Replace current-only grouping with shared date groups from Task 3. Compact record cards, details on demand, retained records separated, change history accessible.
- [x] Direct actions: 录入合同、续签、转签、补录合同、补充材料、修改信息、删除合同. Open one record inside the current drawer, not nested drawers.
- [x] Prefill company/name and transfer original company; new company determines signing company; keep original dates/history intact. Term/agreement choices retain legacy values.
- [x] Reuse archive autosave and explicit submit, preserve draft continuation and errors; contract action submit label 保存并生效. Show field errors on the exact contract.
- [x] Verify responsive interactions and unchanged whole-archive editing. Do not commit/deploy independently.

### Task 3: Shared date classification and grouping

**Owner:** primary. Files: employee-contract-status.ts, employee-contract-presentation.ts, focused Web tests.

- [x] Test Shanghai date boundaries, expired/missing/invalid dates, open-ended terms, overlap and inactive records.
- [x] Add stable date-state keys/reasons and grouping interface: groupEmployeeContracts(records, now) -> { withinTerm, upcoming, needsReview, history, retained }, with each group sorted by business date.
- [x] Keep legacy latest-record selector for callers outside the management view; distinguish its latest-record meaning from the new date groups.
- [x] Add overlap information without assuming a unique legally active contract.

### Task 4: Integration and release

**Owner:** primary, independent review by agents after implementation.

- [x] Verify fixed preview environment isolation before writes; use fictional fixtures only. Preserve unrelated main-checkout work.
- [x] Run final API regression/build, Web type-check/build, focused Playwright and real-backend contract flow covering create/renew/transfer/materials/correct/delete/draft/permissions/concurrency at desktop/mobile sizes.
- [x] Review diffs, stage only task files, commit and push main; compare full remote hash.
- [x] Snapshot production containers/config/migrations, make verified backup and rollback image tags; build fixed source once.
- [x] Deploy only API/Web; external health/assets and read-only affected-page smoke. Record technical proof and remaining human acceptance separately.

## Progress

- 2026-11-17: Approved scope implemented and independently reviewed; strict validation completed with traceable targeted reruns. Fixed functional commit c0d988e1 pushed and deployed at 09:50 Shanghai time; external health/assets and read-only 1440/1024/390px smoke passed. Human HR business acceptance remains separate. See docs/acceptance/2026-11-17-contract-usability-release.md.
