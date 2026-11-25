import type { TalentCandidateInput, TalentSourceChannel } from './talent.types';
import type { ResumeParseResult } from '@/api/talent-resume.api';
export type IntakeState = 'awaiting_resume' | 'pending_review' | 'needs_material' | 'completed' | 'closed';
export interface IntakeFile { id: string; fileName: string; mimeType: string; fileSize: number; url: string; createdAt: string }
export interface IntakeEvent { id: string; action: string; revision: number; createdAt: string; actorName?: string | null; reason?: string | null; metadata?: Record<string, unknown>; snapshot?: Record<string, unknown> }
export interface RecruitmentIntake {
  id: string; revision: number; state: IntakeState; transport: 'manual' | 'email'; sourceChannel: TalentSourceChannel | null;
  ownerId: string; ownerName?: string | null; postingId: string | null; demandId: string | null;
  positionName: string | null; nextFollowUpAt: string | null; sourceNotes: string | null;
  candidateDraft: TalentCandidateInput | null; applicationDraft: IntakeApplication | null; files: IntakeFile[];
  parseStatus: 'idle' | 'processing' | 'succeeded' | 'failed'; parseResult: ResumeParseResult | null; parseMessage: string | null; issues: string[];
  candidateId: string | null; applicationId: string | null; candidateUrl: string | null; applicationUrl: string | null;
  associatedToId: string | null; associatedFromIds: string[]; closeReason: string | null; events?: IntakeEvent[];
  mail: { messageId: string; receivedAt: string; subject: string; bodyText: string; sourcePartId: string } | null;
  createdAt: string; updatedAt: string;
}
export interface IntakeFields {
  state?: IntakeState; ownerId: string; sourceChannel: TalentSourceChannel | null;
  postingId?: string | null; demandId?: string | null; positionName?: string | null;
  nextFollowUpAt?: string | null; sourceNotes?: string | null; candidateDraft?: TalentCandidateInput; applicationDraft?: IntakeApplication;
}
export interface IntakeCreate extends IntakeFields { requestId: string }
export interface IntakeUpdate extends IntakeFields { expectedRevision: number }
export interface IntakeQuery { state?: IntakeState; ownerId?: string; sourceChannel?: string; demandId?: string; postingId?: string; keyword?: string; page?: number; pageSize?: number }
export interface IntakeApplication { deptId?: string | null; positionName?: string; ownerId?: string; recruitmentBatch?: string | null; expectedEntryDate?: string | null }
export interface IntakeConfirm {
  requestId: string; expectedRevision: number; mode: 'candidate_only' | 'candidate_application';
  candidate?: TalentCandidateInput; existingCandidateId?: string;
  application?: IntakeApplication; existingApplicationId?: string;
}
export interface RecruitmentPosting {
  id: string; revision: number; demandId: string; channel: string; name: string; url: string; externalId: string | null;
  verifiedIdentity: boolean; evidence: string | null; ownerId: string; ownerName?: string | null; active: boolean;
  departmentName?: string | null; positionName?: string | null; events?: IntakeEvent[];
}
export interface PostingFields { demandId: string; channel: string; name: string; url: string; externalId?: string | null; verifiedIdentity: boolean; evidence?: string | null; ownerId?: string; active?: boolean }
export interface PostingQuery { demandId?: string; keyword?: string; page?: number; pageSize?: number }
export interface MailboxStatus { configured: boolean; issue?: string | null }
export interface MailboxSyncResult { configured: boolean; synced: number; skipped: number; failed: number; complete: boolean; hasMore: boolean; lastSyncedAt: string | null }
