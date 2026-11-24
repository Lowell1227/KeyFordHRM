# Recruitment Demand Upstream Adapter Evidence

## 2026-11-25 Submission Verification Addition

This section includes the authorized technical scope receipt and bounded-completeness implementation, and supersedes the earlier 62/74-test source/spec freezes. No gateway types, ledger, public lock/transaction code, Web, shared helper, runtime configuration or permissions were changed by this worker.

### Contract And Safety Boundary

The adapter now exports the structurally compatible result and implements:

```typescript
verifyForSubmission(instanceId: string): Promise<{
  source: RecruitmentDemandSource;
  relatedSources: RecruitmentDemandSource[];
  replacementCoverage: 'complete' | 'unproven';
  checkedAt: string;
}>;
```

- The selected source is read freshly, with the existing trusted organization/form membership and state/field checks. If that read fails, the method throws a sanitized error; it does not reuse a cached ledger row.
- With a matching technical scope receipt and a readable selected main chain, the query starts at the earliest necessary chain creation minute and ends at fixed cutoff T. That entire window must fit within 120 days. Otherwise, bounded discovery uses the most recent 120 days and remains `unproven`. Only the configured form is queried, without status or initiator filters that could hide pending/withdrawn records.
- Verification consumes at most TWO listing pages (official maximum 20 IDs per page) and TWENTY distinct detail IDs in total, including the selected instance, necessary ancestors and failed attempts. A 21st detail ID is never fetched. Incomplete pagination, more than 20 listed IDs, unreadable details, missing selected/in-window chain IDs, contradictory identity/form evidence, unknown relationships or cycles prevent `complete`.
- Same-operation form-list membership can prove a candidate's positive form membership without repeating its minute lookup. It is passed only as a local set inside this verification, never cached, accepted from a client, or reused by a later operation. Optional contradictory identity echoes still fail.
- Only sources on an observed relationship chain rooted at the selected ID enter `relatedSources`; unrelated instance data are discarded. Approved MODIFY/REVOKE carries `supersedesInstanceId` only after the existing verified relationship/time checks. Pending/rejected/terminated records have no supersession pointer and cannot invalidate the original merely because of their relationship label. Children are returned in predecessor-first discovery order.
- `replacementCoverage: 'complete'` means only that the technically accepted organization/form data scope, necessary creation window through T, all listing pages and required details/explicit relationships were checked without ambiguity, errors or truncation. It requires the matching receipt below; exhausted app-visible pages alone are insufficient. A same-root sibling whose direct predecessor cannot be established makes coverage `unproven`; the adapter does not choose a replacement merely by timestamp.
- Complete coverage is not selected-source eligibility: a known approved successor may be returned with `complete`, allowing the parent to persist supersession and reject the old selection. Pending/rejected/terminated related records may be fully covered without acquiring a supersession pointer. REVOKE is a reissue relationship, not a withdrawal state; only TERMINATED is normalized as withdrawn.
- `checkedAt` is the fixed query cutoff T, captured after the selected/main-chain reads and before enumeration, not the completion time of later detail reads. Coverage does not promise anything outside the accepted scope/window, hidden/future instances, a provider-wide consistent snapshot or no change after T. Parent's issued one-time proof, 15-second age, source/revision/scope checks and final DB transaction do not turn remote reads into an atomic DingTalk/local commit.
- The entire method uses ONE unchanged 10-second deadline across selected detail/membership, directory pages, candidates, predecessor lookups, token retrieval, fetch and response bodies. Late page/token/body continuations cannot start another read. A compensation error returns only whatever related evidence was already proved, with unproven coverage; a deadline abort escapes all fallback catches and throws `RECRUITMENT_TIMEOUT`.
- This service has no Prisma or lock dependency. Parent owns invoking it outside all DB transactions/public locks, persisting known approved supersession before rejecting unproven coverage, marking failure, and rechecking its server-issued proof inside the final transaction. Raw source data must never be accepted from a client as that proof.

### Server-Only Technical Scope Receipt

Optional `DINGTALK_RECRUITMENT_VERIFIED_SCOPE` is a JSON object parsed with the standard JSON parser, with keys `organizationKey`, `processCode`, `appKey`, `recordId` and `verifiedAt`. The first three must match the current `DINGTALK_CORP_ID`, `DINGTALK_RECRUITMENT_PROCESS_CODE` and `DINGTALK_APP_KEY`. `recordId` must be nonblank and at most 200 characters; `verifiedAt` must be a valid zoned ISO timestamp, not in the future.

- The record references future, controlled technical acceptance of the actual internal application's exact form/data visibility. It is not an additional user approval/sign-off workflow, access credential or substitute for fresh API success.
- Missing, malformed, mismatched or invalid receipts produce `scopeVerified:false` and `unproven` coverage; they do not make otherwise valid ordinary adapter configuration missing. `status()` exposes only the boolean, not receipt contents, app key or record ID. `scopeVerified:true` does not assert that current API permission is working.
- This run did not create a real acceptance record or write any production/runtime configuration. Only explicitly fictional test receipts were used. An actual 403 remains a failed fresh read even with a matching receipt.

### Official Successor Contract Findings

The following primary Markdown contracts were fetched again on 2026-11-25; no real app or approval instance was queried by this worker:

- [Get instance detail](https://open.dingtalk.com/document/development/obtains-the-details-of-a-single-approval-instance-pop.md): `mainProcessInstanceId` is a main-process reference; `attachedProcessInstanceIds` is described only as attached instances. The contract does NOT promise an exhaustive successor-ID enumeration, nor guarantee that refreshing an old instance reveals every subsequent MODIFY/REVOKE. Relationships and terminal state remain separate.
- [List instance IDs](https://open.dingtalk.com/document/development/obtain-an-approval-list-of-instance-ids.md): results are limited to the application's visible department scope. Pagination exhaustion proves only exhaustion of that visible query. Created-time windows do not alone establish complete replacement coverage or a consistent snapshot across requests.
- [Premium process pages](https://open.dingtalk.com/document/development/api-premiumgetprocessinstances.md): this is a paginated form-data API, not a documented closed-world successor lookup. Its required `Premium.Workflow.ReadWrite.All` and OA premium entitlement are broader than the authorized read-only contract; it was NOT used and no permission was requested. The official server API index/search likewise supplied no stronger successor completeness guarantee in the reviewed contracts; this is not a claim that all future platform capabilities have been ruled out.

The agreed implementable boundary is narrower than global successor absence: technically accepted actual app/form data visibility, the earliest necessary selected-chain creation through fixed T within 120 days, exhaustive pagination and readable explicit relationships within the limits above. The receipt references that technical acceptance; the adapter verifies the bounded query on every submission check. No such real acceptance record or successful real form read was established in this task. A target-form list 200 alone is not sufficient, and the reviewed APIs provide no atomic no-change guarantee at the later HRM commit.

### Real Permission Evidence And Remaining Blocker

The requirement conversation reports that its REAL target-form list query for the previous day, with list size 1, returned HTTP 403 `PermissionDenied`; no real form field content was read. This is evidence supplied by that conversation, not a call repeated or independently reproduced here. It is recorded as a failed real access attempt, NOT successful app authorization, a zero-instance result, or proof of no replacements. No process code, identity, credential, response body or field values are copied into this document.

Accordingly, the current real integration must still fail closed until actual access/data-scope acceptance is recorded and a fresh bounded check succeeds. This implementation can return `complete` after those conditions are met; it is not a permanent block even after permissions are corrected. Fictional adapter/gateway acceptance is not evidence of real DingTalk coverage. No PAT substitution, platform write, permission expansion, callback installation, premium endpoint, production scan or notification was performed.

### Focused Verification

- Earlier submission-method TDD produced 12 failing cases, then 12 passing cases and a 74-test adapter baseline. That earlier implementation intentionally returned only `unproven`; the newly approved bounded-completeness contract supersedes it.
- Receipt/bounded-completeness TDD first produced 16 failed / 8 passed / 74 skipped, then 24 passed / 74 skipped after implementation. Four additional positive regression cases cover fully enumerated pending/rejected/terminated relationships without supersession and two exhausted pages totaling 20 readable IDs.
- Direct cases cover valid/missing/malformed/array/null/wrong-scope receipts, bad/future/impossible dates, matching receipt plus 403, fixed cutoff semantics, earliest necessary main-chain windows, over-120-day chains, same-root ambiguity, approved successor preservation, cycles, unknown actions, omitted IDs, unreadable/conflicting-form details, remaining cursors, the 20-distinct-detail cap, and all previous state/privacy/deadline cases.
- Final command from `api`: `npm test -- --runInBand --runTestsByPath src/dingtalk/dingtalk-recruitment.service.spec.ts`: ONE suite / **102 tests passed**, after final source/spec formatting. Scoped TypeScript `createProgram` with repository compiler options, adapter/spec roots, `noEmit:true` and `incremental:false` also passed; it emits no build artifacts.
- Read-only implementation review confirmed that this method reuses signal-bearing private methods rather than public methods that would reset the deadline. Detail/membership caching is operation-local, unrelated candidate data never enter the result, and the receipt alone cannot upgrade an incomplete query or failed fresh read. Parent integration review/full API results remain separate evidence.
- Source/spec were last written at local time **2026-11-25 01:35:38 +08:00** and are frozen at this 102-test result. SHA-256: source `68EFFAA61BEC6E5FC7AE6415998DA8010EDFB67B01131E4CFCE543BE2059A01C`; spec `7BE73BDD5011415F3AD6D5C879603084CFC03892051BFCF4076479961EF7B1B3`. Subsequent edits in this worker are documentation only. No full API suite, integration DB, real app call, build, commit, push or deployment is part of this addition.

Date: 2026-11-24. Scope: read-only sidecar in `contract-transfer-display-20261124/HRM`.
Implemented and tested locally; not committed, deployed, or accepted against real DingTalk instances.
No production connection, platform permission change, notification, real-instance scan, or business-data write was performed.
Initial worktree HEAD and live remote main: `0c3ae94f`. Local `main` was different; no merge/reset was performed.
Other workers' schema, talent-pool and Web changes were preserved. Production was not re-inspected by this bounded worker.

## Integration Contract

- `DingtalkRecruitmentService` is registered/exported only by `DingtalkModule`.
- Its exported `RecruitmentDemandSource` is structurally compatible with the talent-pool contract, including `supersedesInstanceId?: string | null`. There is no dependency back into talent-pool.
- The ledger injects `DingtalkRecruitmentService` directly through its structural gateway contract. The isolated test bootstrap overrides that provider only; there is no second source token or browser-controlled gateway. Parent/B owns all ledger/submission behavior.
- `status()` returns `configured`, configuration key names in `missing`, `readOnly: true` and technical receipt validity as `scopeVerified`. When configured it also returns `scope: { organizationKey, processCode }` from the CURRENT server configuration, without credentials; when unconfigured it omits scope. B must limit selection/refresh to that exact source scope, not historical instances from a previous configuration. Neither configured nor scopeVerified proves current app permission or approved business mappings.
- `listIds({from,to})` returns deduplicated IDs and completeness. `readInstance(id)` returns only the fixed allowlist; no raw form, salary, attachment, initiator, reviewer, title, remarks, or arbitrary upstream URLs are returned or logged.

## Server Configuration

All are server-side `ConfigService` keys, never accepted from browser input:

| Key | Required meaning |
| --- | --- |
| `DINGTALK_CORP_ID` | Trusted organization associated with the existing internal-app credentials |
| `DINGTALK_APP_KEY` | Existing HRM internal app; also the public AppLink `from` parameter, not an app secret |
| `DINGTALK_APP_SECRET` | Existing app secret, used only through `DingtalkService.getAccessToken(signal)` |
| `DINGTALK_RECRUITMENT_PROCESS_CODE` | Exact published recruitment demand form, not a form title |
| `DINGTALK_RECRUITMENT_DEPARTMENT_CONTROL_ID` | Verified department control ID; its documented string value can contain department JSON |
| `DINGTALK_RECRUITMENT_POSITION_CONTROL_ID` | Verified position-text control ID |
| `DINGTALK_RECRUITMENT_HEADCOUNT_CONTROL_ID` | Verified headcount-text control ID |

Missing/invalid keys make the adapter unconfigured and prevent network calls. Control IDs must be distinct.
There are no real defaults, credential substitutions, title-based field matching, or organization/form fallback.
The actual formal process code and three control IDs are absent from the approved requirements/plan; they were not guessed or obtained by scanning instances.

## Official Contract Verification

Official index and Markdown bodies were fetched read-only on this date. Web browsing confirmed the official pages; their corresponding `.md` bodies supplied the readable contracts. No third-party sources were used.

1. [Instance ID list](https://open.dingtalk.com/document/development/obtain-an-approval-list-of-instance-ids.md): `POST https://api.dingtalk.com/v1.0/workflow/processes/instanceIds/query`, app token in `x-acs-dingtalk-access-token`, required `processCode/startTime/nextToken/maxResults`, optional `endTime`. Page maximum 20, initial cursor 0; response `result.list` plus nonempty `nextToken` means continue. Both endpoints require `Workflow.Instance.Read`. Without a premium entitlement, the documented explicit range is at most 120 days and start lookback at most 365 days; premium history must not be assumed.
2. [Instance detail](https://open.dingtalk.com/document/development/obtains-the-details-of-a-single-approval-instance-pop.md): `GET https://api.dingtalk.com/v1.0/workflow/processInstances?processInstanceId=...`, same token header. Only instance-level `COMPLETED` plus lowercase `agree` is terminal approval evidence; individual task agreement is insufficient. `RUNNING` is pending, `TERMINATED` withdrawn, and `COMPLETED/refuse` rejected. The response lists control IDs, create/finish times, `bizAction` and `mainProcessInstanceId`, but not a guaranteed form code, organization ID, last-modified time or canonical instance URL.
3. [Open approval detail](https://open.dingtalk.com/document/development/open-approval-details.md): the official cross-client AppLink is `https://applink.dingtalk.com/approval/detail`, with required `corpId`, `instanceId`, `from` (recommended internal-app Client ID/appKey). Minimum listed Android/iOS/Mac/Windows client version is 7.0.30. The adapter uses `URL`/`searchParams` to encode these trusted IDs; it does not guess an aflow URL or copy task/response links. URL construction is covered by tests; actual client opening/access is not yet verified.

The official detail Markdown was fetched again after the final contract correction. `REVOKE` means a new instance started after the original was withdrawn; `MODIFY` means a new instance modified from the original. These describe relationships, NOT the new instance's terminal state. Only instance `TERMINATED` maps to `withdrawn`. A reissued `REVOKE` can be approved when its own state is `COMPLETED/agree`, its required source controls and timestamps are verifiable, and its main-instance relationship is verified under the same trusted organization/form. Reading or approving the new instance never reactivates the withdrawn/superseded original. The earlier forced REVOKE-to-withdrawn assumption and its incorrect assertions have been removed.

## Provenance And Failure Boundaries

- Details alone cannot prove form membership. For each requested instance, read its documented creation time and exhaust the exact configured form's ID list within that creation minute, using the SAME internal-app token source. Missing membership, incomplete pagination, contradictory optional identity echoes, or missing creation time reject the read. This is not a global scan.
- Organization trust comes from the controlled app/corp configuration and the app-token scope. An operator must verify that binding before real use; a configured string or personal PAT cannot prove it.
- Only terminal-agreed `MODIFY/REVOKE` with all required source-control strings, a verified same-organization/form main instance, valid time ordering and no direct self/back-link can be approved and return `supersedesInstanceId`. Invalid/unreadable main instances or unverifiable required controls make the correction unknown without a pointer. `RUNNING` is pending, `COMPLETED/refuse` rejected and `TERMINATED` withdrawn regardless of the relationship label; none can produce a replacement pointer. The original remains independently withdrawn/superseded, never restored by the new instance's state.
- Missing/duplicate configured controls, non-string responses or strings beyond the 2,000-character bound make source fields unverifiable (null) and an otherwise approved demand unknown. They are source/configuration issues, not an upstream refusal. A valid department JSON STRING is preserved verbatim without parsing; uncertain textual headcount remains approved source evidence, never guessed into a numeric count. Terminal approval and HRM mapping are separate: B must require explicit checked mappings/numbers and render raw strings through escaped text, never HTML.
- `sourceCreatedAt` and approved `approvedAt` use only documented timestamps. `sourceUpdatedAt` stays null: do not treat creation or approval time as a reliable last-modified timestamp. B must enforce its own current-version/serialized-refresh and no-stale-reactivation rules.
- Date-only query boundaries mean inclusive Asia/Shanghai days; explicit timestamps require a timezone. Local range maximum is less than 366 days, split into contiguous windows shorter than 120 days. No status filter hides pending/withdrawn records. Listing caps at 500 requests / 10,000 unique IDs; repeated cursors or a remaining page/window at the cap return `complete:false`. Invalid pages/cursors throw safe errors, not a false success.
- Each entire `listIds` or `readInstance` operation uses ONE existing 10-second deadline, covering every sequential page, detail, membership check, token lookup and response body. The exact outer `AbortSignal` reaches token retrieval and fetch (whose signal also cancels real response-body reading). Loop/request entry and post-await guards prevent late continuations from sending more requests, even when a test transport ignores cancellation. Relationship fallback cannot swallow an aborted outer operation. No per-request timer resets the total budget; the shared deadline helper is unchanged. Only the two fixed official API paths are used, redirects refused. Errors contain stable `RECRUITMENT_*` categories only, with no token, original error/cause, raw response, upstream message or arbitrary upstream code. There is no adapter logging or persistence.
- A created-time listing does not discover later status changes to old instances by itself. Parent refresh/current-source checks remain necessary; callbacks and write-side platform actions are outside this adapter.

## Earlier Verification Evidence (Before Nov 25 Addition)

All upstream response fixtures and app identities in tests are fictional. `global.fetch` and app-token retrieval are stubbed; no app API was contacted.

- TDD baseline: missing module failed first; a typed unimplemented shell then produced 33 behavioral failures / 1 pass. Implementation reached 34 passes; additional boundary cases expanded coverage.
- Canonical AppLink construction and its hostile-upstream-link exclusion are directly tested against the official contract.
- Current-scope and raw-control tests were observed RED: 3 failed / 47 passed, then fixed. These include a reconfigured scope, raw department JSON and uncertain headcount, without expanding the control allowlist.
- Final REVOKE contract correction was observed RED: 2 failed / 54 passed; after removing the forced status and field-validation exemption, 56 passed. Direct tests cover approved reissue with verified replacement pointer while the original remains withdrawn; pending/rejected/terminated reissue without a pointer; missing source controls; and an original created after the new instance.
- Final operation-budget TDD: `npm test -- --runInBand --runTestsByPath src/dingtalk/dingtalk-recruitment.service.spec.ts --testNamePattern="shared whole-operation budget"` observed 6 failures, with all previous 56 tests skipped. The tests exposed independent timer resets, missing whole-operation cancellation and distinct request signals.
- Earlier deadline-only freeze: `npm test -- --runInBand --runTestsByPath src/dingtalk/dingtalk-recruitment.service.spec.ts` from `api`: 1 suite, 62 direct adapter tests passed (the previous 56 unchanged plus 6 budget cases). That run followed its implementation/formatting; no full API, related suites or build were rerun for that limited fix. The latest source/spec freeze is the 102-test result above.
- Budget cases assert failure at exactly 10,000 virtual milliseconds: list pages taking 4 seconds each; relationship verification calls taking 3 or 4 seconds each; delayed membership token and response-body continuations. Advancing another 20 seconds proves no next fetch/token call is issued. A four-call success at 4 seconds proves shared token/fetch signal identity and timer cleanup without changing approved MODIFY behavior.
- Earlier related command: `npm test -- --runInBand --runTestsByPath src/dingtalk/dingtalk-recruitment.service.spec.ts src/dingtalk/dingtalk.service.spec.ts src/dingtalk/dingtalk-attendance.service.spec.ts`: 3 suites / 93 tests passed on the pre-correction snapshot; this is historical related-regression evidence, not the final contract result.
- Covered: configuration missing/duplicate IDs and current scope; all terminal/pending/refusal states independently of relationship; verified and unverifiable MODIFY/REVOKE; approved reissue and unchanged withdrawn original; same-form/org/instance contradictions; uncertain headcount and department JSON preservation; field-name fallbacks rejected; bounded raw strings; salary/attachment/PII exclusion; canonical link/host/parameters; complete paging, 120-day splitting, repeated cursors and 10,000-ID cap; malformed pages; token/network/permission/JSON error sanitization; stalled token/fetch/body deadlines.
- Earlier scoped TypeScript `createProgram` with repository compiler options and `noEmit:true, incremental:false` passed on the pre-correction snapshot. The final adapter Jest run compiles the changed source/spec; no additional integration build was claimed.
- `npm run build` was attempted and failed with 27 errors in the concurrently added `talent-pool/recruitment-demands.service.ts` because the existing generated Prisma client lacks the new `RecruitmentDemand*` types/delegates. No error referenced this adapter. This worker did not change schema, generate another worker's client, or claim a successful full build. Parent must generate the settled schema and rerun the integration build.
- No full API suite, UI acceptance, real DingTalk permission check, production smoke, git commit or release was performed by this sidecar.

## Earlier Budget Review And 62-Test Freeze

- Only the adapter source/spec and this evidence document were changed for the final budget authorization. `DingtalkModule` registration was not changed again; the shared deadline helper and B/C modules were not edited.
- Read-only review of the final adapter found no additional P0/P1/P2 within this budget change: both public operations enter one deadline; all internal network paths receive that signal; late token/body/page continuations are guarded; aborted relationship verification escapes the non-abort fallback; API/type/configuration/state/filtering contracts remain unchanged.
- This was implementation-side read-only review, NOT a separately dispatched independent reviewer. No subagent/reviewer tool is available in this worker; parent independent sign-off remains to be supplied rather than falsely claimed.
- The adapter is frozen after the 62-test result. Its source IO budget is now 10 seconds, not a claim that arbitrary B lock waits plus DB work always fit 30 seconds. B owns its remaining transaction budget, persistence/resume behavior and failure-record commit. C owns only endpoint-scoped HTTP timeout changes; neither area was modified here.
- Virtual timing proves adapter cancellation/continuation behavior, not an actual Prisma expiry or real DingTalk latency/permission test. External evidence requirements below remain unchanged.

## Minimum Remaining External Evidence

1. Trusted HRM app identity and its organization binding, the exact published form `processCode`, and the three verified non-sensitive control IDs/types (not their real instance values).
2. That application's effective `Workflow.Instance.Read` entitlement and relevant approval-data scope, followed by a narrowly authorized known-instance read. Permission metadata alone is not successful real-form access.
3. Real-client opening of the official AppLink under an authorized account; upstream DingTalk still decides whether that account may see the original approval, including its existing salary-field boundary.

DWS is installed, but the scoped requirements contain no verified HRM unified-app ID/name binding for a safe targeted metadata query. This worker therefore did not enumerate unrelated applications, request a PAT grant, or claim personal DWS access as HRM app authorization. Actual app permission introspection remains explicitly unverified; no user question or platform change was made.
