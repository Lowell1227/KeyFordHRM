export type RecruitmentDemandSourceState = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'unknown';

export interface RecruitmentDemandSource {
  organizationKey: string;
  processCode: string;
  instanceId: string;
  status: RecruitmentDemandSourceState;
  rawDepartment: string | null;
  rawPosition: string | null;
  rawHeadcount: string | null;
  approvedAt: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  sourceLink: string | null;
  mainInstanceId: string | null;
  bizAction: string | null;
  supersedesInstanceId?: string | null;
}

export interface RecruitmentDemandGateway {
  status(): { configured: boolean; missing: string[]; readOnly: true; scope?: { organizationKey: string; processCode: string } };
  listIds(input: { from: string; to: string }): Promise<{ instanceIds: string[]; complete: boolean }>;
  readInstance(instanceId: string): Promise<RecruitmentDemandSource>;
  verifyForSubmission?(instanceId: string): Promise<RecruitmentDemandVerification>;
}

export interface RecruitmentDemandVerification {
  source: RecruitmentDemandSource;
  relatedSources: RecruitmentDemandSource[];
  replacementCoverage: 'complete' | 'unproven';
  checkedAt: string;
}

export interface RecruitmentDemandSubmissionProof {
  demandId: string;
  revision: number;
  sourceFingerprint: string;
  actorId: string;
  organizationKey: string;
  processCode: string;
  verifiedAt: string;
}

export interface RecruitmentDemandSubmissionSnapshot {
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
  verifiedAt?: string;
}
