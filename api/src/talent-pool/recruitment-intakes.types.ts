/** HTTP contract: dates are ISO strings; raw sources/files are recruitment-editor-only. */
export const RECRUITMENT_INTAKE_STATES = ['awaiting_resume', 'pending_review', 'needs_material', 'completed', 'closed'] as const;
export type RecruitmentIntakeState = typeof RECRUITMENT_INTAKE_STATES[number];
export interface RecruitmentSourceEventView {
  id: string; action: string; revision: number; actorName: string | null; reason: string | null; createdAt: string;
  metadata?: Record<string, unknown>; snapshot?: Record<string, unknown>;
}
export interface RecruitmentPostingView {
  id: string; revision: number; demandId: string; channel: string; name: string; url: string;
  externalId: string | null; verifiedIdentity: boolean; evidence: string | null; active: boolean;
  ownerId: string; ownerName: string | null; createdAt: string; updatedAt: string;
  events?: RecruitmentSourceEventView[];
}
export interface RecruitmentIntakeFileView {
  id: string; fileName: string; mimeType: string; fileSize: number; url: string; createdAt: string;
}
export interface RecruitmentIntakeView {
  id: string; revision: number; state: RecruitmentIntakeState; transport: 'manual' | 'email';
  ownerId: string; ownerName: string | null; sourceChannel: string | null;
  postingId: string | null; demandId: string | null; positionName: string | null;
  sourceNotes: string | null; nextFollowUpAt: string | null;
  followUpSources?: Array<{ intakeId: string; nextFollowUpAt: string; primary: boolean }>;
  candidateDraft: Record<string, unknown> | null; applicationDraft: Record<string, unknown> | null;
  parseStatus: 'idle' | 'processing' | 'succeeded' | 'failed'; parseResult: Record<string, unknown> | null;
  parseMessage: string | null; issues: string[]; files: RecruitmentIntakeFileView[];
  candidateId: string | null; applicationId: string | null;
  candidateUrl: string | null; applicationUrl: string | null;
  associatedToId: string | null; associatedFromIds: string[]; closeReason: string | null;
  mail: { messageId: string; receivedAt: string; subject: string; bodyText: string; sourcePartId: string; mailboxId: string | null; mailboxName: string | null } | null;
  createdAt: string; updatedAt: string; events?: RecruitmentSourceEventView[];
}
export interface RecruitmentMailboxSyncView {
  configured: boolean; synced: number; skipped: number; failed: number; complete: boolean;
  hasMore: boolean; lastSyncedAt: string | null;
}
/**
 * Routes (all editor-only): GET/POST /recruitment-intakes; GET/PATCH /:id;
 * POST /:id/files multipart(file,expectedRevision); GET /:id/files/:fileId;
 * POST /:id/parse {expectedRevision,fileId?}; POST /:id/confirm;
 * POST /:id/close {expectedRevision,reason};
 * POST /:id/associate {expectedRevision,targetIntakeId,expectedTargetRevision};
 * GET /mailbox/status; POST /mailbox/sync {limit?:1..20} (server-owned cursor).
 * GET/POST /recruitment-postings; GET/PATCH /:id. Standard paginated lists.
 * Confirmation: requestId,expectedRevision,mode,candidate OR existingCandidateId,
 * application? (existing CreateTalentApplicationDto), existingApplicationId? for explicit reuse.
 * Result is RecruitmentIntakeView, including exact result IDs/links. Source demand is a hint,
 * never the frozen hiring approval snapshot. Uploads never accept client object keys.
 */
