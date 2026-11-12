# Fixed Interactive Preview

Status: implemented and technically verified; user acceptance pending. No production release.

## Boundaries

- Reuse the existing `hrm` Docker project, not `kayford-deploy`.
- Keep the old development database and all production containers unchanged.
- Create a separate `hrm_preview` database, `hrm-preview` bucket, Redis database 9, and independent signing/encryption keys.
- Seed fictional identities only, once. Re-running startup must preserve acceptance edits.
- Bind the preview to loopback only. No real DingTalk identity, notification, calendar, or external AI calls.
- Archive unsafe/obsolete untracked artifacts outside Git with checksums. Do not merge AI or department-self-review branches.

## Implementation

1. Add tested startup guards, a preview-only Compose file, and an idempotent fictional seed.
2. Add development-only preview account selection and an environment badge; reuse existing controlled test authentication.
3. Start only the existing development API/Web services, regenerate Prisma against current source, and migrate the new database.
4. Exercise real-backend login, authorization, persisted CRUD, and desktop/mobile rendering. Run focused checks and builds.
5. Record evidence, commit only reviewed files, push main. Production release is a separate explicit authorization.

## Acceptance

- `http://localhost:5173` is the fixed interactive preview, not a static mock.
- HR/admin and employee identities can log in without real credentials; employees cannot access HR candidate management.
- Fictional edits survive reload and preview restart.
- Preview tokens do not authenticate to production; production quick-login remains disabled.
- No production container is recreated and no old development database is altered.
- Third-party delivery and business acceptance remain explicitly unverified.
