import http from './http';
import type { Paginated } from '@/types/api.types';
import type { IntakeConfirm, IntakeCreate, IntakeQuery, IntakeUpdate, MailboxStatus, MailboxSyncResult, RecruitmentIntake } from '@/types/recruitment-intake.types';
const base = '/recruitment-intakes', silent = { skipErrorMessage: true };
export const recruitmentIntakesApi = {
  list(query: IntakeQuery): Promise<Paginated<RecruitmentIntake>> { return http.get(base, { params: query, ...silent }) as unknown as Promise<Paginated<RecruitmentIntake>>; },
  detail(id: string): Promise<RecruitmentIntake> { return http.get(`${base}/${encodeURIComponent(id)}`, silent) as unknown as Promise<RecruitmentIntake>; },
  create(body: IntakeCreate): Promise<RecruitmentIntake> { return http.post(base, body, silent) as unknown as Promise<RecruitmentIntake>; },
  update(id: string, body: IntakeUpdate): Promise<RecruitmentIntake> { return http.patch(`${base}/${encodeURIComponent(id)}`, body, silent) as unknown as Promise<RecruitmentIntake>; },
  upload(id: string, expectedRevision: number, file: File): Promise<RecruitmentIntake> {
    const body = new FormData(); body.append('file', file); body.append('expectedRevision', String(expectedRevision));
    return http.post(`${base}/${encodeURIComponent(id)}/files`, body, { ...silent, timeout: 60000 }) as unknown as Promise<RecruitmentIntake>;
  },
  async file(id: string, fileId: string): Promise<Blob> {
    const result = await http.get(`${base}/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`, { ...silent, responseType: 'blob' }) as unknown as { data: Blob };
    return result.data;
  },
  parse(id: string, expectedRevision: number, fileId?: string): Promise<RecruitmentIntake> { return http.post(`${base}/${encodeURIComponent(id)}/parse`, { expectedRevision, ...(fileId ? { fileId } : {}) }, silent) as unknown as Promise<RecruitmentIntake>; },
  confirm(id: string, body: IntakeConfirm): Promise<RecruitmentIntake> { return http.post(`${base}/${encodeURIComponent(id)}/confirm`, body, silent) as unknown as Promise<RecruitmentIntake>; },
  close(id: string, body: { expectedRevision: number; reason: string }): Promise<RecruitmentIntake> { return http.post(`${base}/${encodeURIComponent(id)}/close`, body, silent) as unknown as Promise<RecruitmentIntake>; },
  associate(id: string, body: { expectedRevision: number; targetIntakeId: string; expectedTargetRevision: number }): Promise<RecruitmentIntake> { return http.post(`${base}/${encodeURIComponent(id)}/associate`, body, silent) as unknown as Promise<RecruitmentIntake>; },
  mailStatus(): Promise<MailboxStatus> { return http.get(`${base}/mailbox/status`, silent) as unknown as Promise<MailboxStatus>; },
  syncMail(limit = 10): Promise<MailboxSyncResult> { return http.post(`${base}/mailbox/sync`, { limit }, { ...silent, timeout: 60000 }) as unknown as Promise<MailboxSyncResult>; },
};
