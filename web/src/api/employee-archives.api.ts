import http from './http';

export type EmployeeRosterImportMode = 'full' | 'incremental';

export interface EmployeeRosterPreviewSummary {
  totalRows: number;
  createCount: number;
  updateCount: number;
  blockingErrorCount: number;
  warningCount: number;
  missingFromFullRosterCount: number;
  desiredDepartmentCount: number;
}

export interface EmployeeRosterPreviewResult {
  batchId: string;
  canConfirm: boolean;
  summary: EmployeeRosterPreviewSummary;
}

export interface EmployeeRosterConfirmResult {
  batchId: string;
  status: 'pending_review' | 'completed';
  submitted: number;
}

export type EmployeeReviewStatus = 'not_required' | 'pending' | 'approved' | 'rejected';
export type EmployeeReviewScope = 'profile' | 'performance';

export interface EmployeeDataReview {
  id: string;
  userId: string | null;
  employeeNo: string | null;
  employeeName: string;
  sourceType: string;
  profileReviewStatus: EmployeeReviewStatus;
  performanceReviewStatus: EmployeeReviewStatus;
  validationErrors: string[];
  baseValue: Record<string, any>;
  proposedValue: Record<string, any>;
  rejectedReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeDataReviewPage {
  total: number;
  page: number;
  pageSize: number;
  items: EmployeeDataReview[];
}

export interface EmployeeReviewBatchResult {
  succeeded: Array<{ requestId: string; scopes: EmployeeReviewScope[] }>;
  failed: Array<{ requestId: string; reason: string }>;
}

export interface EmployeeRosterImportRow {
  rowNumber: number;
  action: 'create' | 'update' | 'blocked' | 'possible_resignation';
  normalizedValue: {
    name?: string | null;
    employeeNo?: string | null;
    employee?: {
      name?: string | null;
      employeeNo?: string | null;
      companyText?: string | null;
      departmentPath?: string[];
    };
  };
  errors: string[];
  warnings: string[];
}

export interface EmployeeRosterImportBatch {
  id: string;
  status: string;
  rows: EmployeeRosterImportRow[];
}

export interface EmployeeArchive {
  id: string;
  name: string;
  employeeNo: string | null;
  status: 'active' | 'probation' | 'resigned';
  position: string | null;
  entryDate: string | null;
  dept: { id: string; name: string; fullPath: string | null; company: string } | null;
  performanceManager: { id: string; name: string; employeeNo: string | null } | null;
  rosterManager: { id: string; name: string; employeeNo: string | null } | null;
  currentEmployment: { id: string; company: string; directManager?: { id: string; name: string; employeeNo: string | null } | null } | null;
  employeeProfile: {
    phone: string | null;
    gender: string | null;
    birthDate: string | null;
    ethnicity: string | null;
    education: string | null;
    professionalTitle: string | null;
    school: string | null;
    graduationDate: string | null;
    major: string | null;
  } | null;
  employmentHistory: Array<{
    id: string;
    company: string;
    position: string | null;
    jobGrade: string | null;
    jobFamily: string | null;
    workLocation: string | null;
    employeeStatus: 'active' | 'probation' | 'resigned';
    effectiveFrom: string;
    effectiveTo: string | null;
    changeType: string;
    dept: { id: string; name: string; fullPath: string | null } | null;
    directManager: { id: string; name: string; employeeNo: string | null } | null;
  }>;
  employeeContracts: Array<{
    id: string;
    contractType: string;
    name: string | null;
    signingCompany: string | null;
    signedAt: string | null;
    expiresAt: string | null;
    termType: string | null;
    isActive: boolean;
    endedAt: string | null;
  }>;
  dingtalkBindingState: 'unbound' | 'enabled' | 'disabled';
  dingtalkBinding: {
    id: string;
    status: 'enabled' | 'disabled';
    boundAt: string;
    disabledAt: string | null;
    disabledReason: string | null;
    lastLoginAt: string | null;
  } | null;
}

export const employeeArchivesApi = {
  getArchive(userId: string): Promise<EmployeeArchive> {
    return http.get(`/employee-archives/${userId}`) as unknown as Promise<EmployeeArchive>;
  },

  setDingtalkState(userId: string, enabled: boolean, reason?: string): Promise<unknown> {
    return http.patch(`/employee-archives/${userId}/dingtalk-binding`, { enabled, reason }) as unknown as Promise<unknown>;
  },

  previewRoster(file: File, mode: EmployeeRosterImportMode): Promise<EmployeeRosterPreviewResult> {
    const form = new FormData();
    form.append('file', file);
    form.append('mode', mode);
    return http.post('/employee-archives/imports/preview', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60_000,
    }) as unknown as Promise<EmployeeRosterPreviewResult>;
  },

  confirmRoster(batchId: string, file: File): Promise<EmployeeRosterConfirmResult> {
    const form = new FormData();
    form.append('file', file);
    return http.post(`/employee-archives/imports/${batchId}/confirm`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120_000,
    }) as unknown as Promise<EmployeeRosterConfirmResult>;
  },

  getRosterBatch(batchId: string): Promise<EmployeeRosterImportBatch> {
    return http.get(`/employee-archives/imports/${batchId}`) as unknown as Promise<EmployeeRosterImportBatch>;
  },

  listReviews(params: {
    page?: number;
    pageSize?: number;
    status?: 'pending' | 'approved' | 'rejected' | 'all';
    keyword?: string;
  } = {}): Promise<EmployeeDataReviewPage> {
    return http.get('/employee-archives/reviews/list', { params }) as unknown as Promise<EmployeeDataReviewPage>;
  },

  approveReviews(requestIds: string[], scopes: EmployeeReviewScope[]): Promise<EmployeeReviewBatchResult> {
    return http.post('/employee-archives/reviews/approve', { requestIds, scopes }) as unknown as Promise<EmployeeReviewBatchResult>;
  },

  proposePerformanceManager(userId: string, managerId: string | null): Promise<EmployeeDataReview> {
    return http.post(`/employee-archives/${userId}/performance-manager-review`, { managerId }) as unknown as Promise<EmployeeDataReview>;
  },

  setPendingPerformanceManager(requestId: string, managerId: string): Promise<EmployeeDataReview> {
    return http.patch(`/employee-archives/reviews/${requestId}/performance-manager`, { managerId }) as unknown as Promise<EmployeeDataReview>;
  },
};
