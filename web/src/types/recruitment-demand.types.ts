import type { TalentApplicationStage } from './talent.types';

export type RecruitmentDemandSourceState = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'unknown';

export interface RecruitmentDemandEvent {
  id: string;
  action: string;
  revision: number;
  createdAt: string;
  actorName: string | null;
  reason: string | null;
}

export interface RecruitmentDemandView {
  id: string;
  revision: number;
  instanceId: string;
  sourceState: RecruitmentDemandSourceState;
  rawDepartment: string | null;
  rawPosition: string | null;
  rawHeadcount: string | null;
  deptId: string | null;
  departmentName: string | null;
  positionId: string | null;
  positionName: string | null;
  approvedHeadcount: number | null;
  occupiedCount?: number;
  acceptedCount?: number;
  hiredCount?: number;
  remainingCount?: number | null;
  overCount?: number | null;
  usable: boolean;
  issues: string[];
  approvedAt: string | null;
  sourceLink: string | null;
  lastSyncedAt: string;
  events?: RecruitmentDemandEvent[];
}

export interface RecruitmentDemandSnapshot {
  demandId: string;
  revision: number;
  instanceId: string;
  departmentId: string;
  departmentName: string;
  positionId: string;
  positionName: string;
  approvedHeadcount: number;
  approvedAt: string | null;
  sourceLink: string | null;
  syncedAt: string;
}

export interface RecruitmentDemandStatus { configured: boolean; missing: string[]; readOnly: true }
export interface RecruitmentDemandSyncInput { from: string; to: string; requestId?: string; cursor?: string }
export interface RecruitmentDemandSyncResult { synced: number; failed: number; complete: boolean; remaining: number; limit: number; cursor: string | null }
export interface RecruitmentDemandDirectories {
  departments: Array<{ id: string; name: string; fullPath?: string }>;
  positions: Array<{ id: string; code: string; name: string }>;
}
export interface RecruitmentDemandQuery { keyword?: string; status?: RecruitmentDemandSourceState; page?: number; pageSize?: number }
export interface RecruitmentDemandMapping { expectedRevision: number; deptId: string; positionId: string; approvedHeadcount: number; reason: string }
export type RecruitmentDemandApplicationCategory = 'awaiting_reply' | 'accepted' | 'terminated' | 'hired';
export interface RecruitmentDemandApplicationQuery { category: RecruitmentDemandApplicationCategory; page?: number; pageSize?: number }
export interface RecruitmentDemandApplication {
  id: string;
  candidateId: string;
  candidateName: string | null;
  candidateUnavailable?: boolean;
  positionName: string;
  stage: TalentApplicationStage;
  revision: number;
  ownerName: string | null;
  expectedEntryDate: string | null;
  category: RecruitmentDemandApplicationCategory;
  occupied: boolean;
  onboardingRequest: { id: string; recordStatus: string; onboardingStatus: string | null } | null;
}
