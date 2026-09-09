import http from "./http";
import type { Paginated, ReviewHistoryRecord, ResultEvidence } from "@/types/api.types";
import type { PerfGrade, TaskStatus } from "@/types/enums";

export type PublicationState =
  | "pending_approval"
  | "pending_confirmation"
  | "ready_to_publish"
  | "published"
  | "confirmed"
  | "appealing"
  | "closed";

export interface PublicationRecord {
  taskId: string;
  cycleId: string;
  cycleName: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string | null;
  deptName: string | null;
  position: string | null;
  status: TaskStatus;
  publicationState: PublicationState;
  canPublish: boolean;
  resultMasked: boolean;
  totalScore: number | null;
  rawGrade: PerfGrade | null;
  calibratedGrade: PerfGrade | null;
  approvedAt: string | null;
  publishedAt: string | null;
  employeeConfirmedAt: string | null;
  updatedAt: string;
}

export interface PublicationRecordDetail extends PublicationRecord {
  resultEvidence?: ResultEvidence;
  managerName: string | null;
  flowRecords: ReviewHistoryRecord[];
}

const apiGet = <T>(url: string, params?: Record<string, unknown>): Promise<T> =>
  http.get(url, { params }) as unknown as Promise<T>;
const apiPost = <T>(url: string, data: unknown): Promise<T> =>
  http.post(url, data) as unknown as Promise<T>;

export const publicationApi = {
  getRecords(
    cycleId: string,
    query: { page: number; pageSize: number },
  ): Promise<Paginated<PublicationRecord>> {
    return apiGet(`/cycles/${cycleId}/publication-records`, query);
  },
  getRecordDetail(
    cycleId: string,
    taskId: string,
  ): Promise<PublicationRecordDetail> {
    return apiGet(`/cycles/${cycleId}/publication-records/${taskId}`);
  },
  publish(
    cycleId: string,
    body: { taskIds: string[]; sendDingtalkNotification: boolean },
  ): Promise<{
    cycleId: string;
    published: number;
    publishedAt: string;
    deadlineAppeal: string;
  }> {
    return apiPost(`/cycles/${cycleId}/publish`, body);
  },
};
