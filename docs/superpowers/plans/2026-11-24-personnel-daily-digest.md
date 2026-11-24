# Personnel Daily Digest Implementation Plan

**Goal** Deliver one counts-only archive reminder daily in the confirmed DingTalk group and show the underlying work in HRM.

- [ ] Project six read-only categories using the existing personnel and archive visibility rules. Verify boundary dates and excluded records with fictional data.
- [ ] Expose the projection on a protected HRM page, with overdue groups open and the other groups expandable. Route actions to existing screens.
- [ ] Schedule delivery in Asia/Shanghai, default 09:00. Claim the date in the existing audit table before sending. An ambiguous provider response must never trigger an automatic repeat.
- [ ] Use a separate runtime-only webhook and signing secret. Verify against a fictional webhook response before publishing. Validate current production scope, deploy API/Web only and check both services.
