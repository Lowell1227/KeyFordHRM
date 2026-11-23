export interface PayrollAbsenceCandidate {
  employeeId: string; workDate: string; proofHash: string; hours: string;
  intervals: Array<{ startsAt: string; endsAt: string }>;
}
export interface PayrollConfirmedAbsence extends PayrollAbsenceCandidate {
  id: string; reference: string; proposedById: string; proposedAt: string; approvedById: string; approvedAt: string; note: string;
}
export interface PayrollAttendanceReview {
  kind?: string; id?: string; proposalId?: string; employeeId?: string; workDate?: string;
  actorId: string; at: string; note?: string; reference?: string; hours?: string;
}
export interface PayrollAbsenceDetail {
  snapshotId: string; version: number; actors: Array<{ id: string; name: string }>;
  review: PayrollAttendanceReview[]; candidates: PayrollAbsenceCandidate[]; confirmed: PayrollConfirmedAbsence[];
}
