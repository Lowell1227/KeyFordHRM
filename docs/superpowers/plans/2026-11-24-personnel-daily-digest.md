# Personnel Daily Digest Implementation Plan

**Goal** Deliver one counts-only archive reminder daily in the confirmed DingTalk group and show the underlying work in HRM.

- [x] Project six read-only categories using the existing personnel and archive visibility rules. Verify boundary dates and excluded records with fictional data.
- [x] Expose the projection on a protected HRM page, with overdue groups open and the other groups expandable. Route actions to existing screens.
- [x] Implement the schedule in Asia/Shanghai, default 09:00. Claim the date in the existing audit table before sending. An ambiguous provider response must never trigger an automatic repeat.
- [x] Verify signing and dispatch against a fictional webhook response. Deploy API/Web only and check both services.
- [x] Load the group's runtime-only webhook and signing secret from the host. Enable delivery and verify the running configuration and account scope.
- [ ] Verify the first scheduled message against the delivery audit and the target DingTalk group.
