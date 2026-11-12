import http from './http';
import type { AxiosResponse } from 'axios';
import type { Paginated } from '@/types/api.types';
import type {
  BindTalentFileBody,
  CreateFollowUpBody,
  CreateShareBody,
  CreateShareResult,
  ShareView,
  TalentCandidateDetail,
  TalentCandidateInput,
  TalentCandidateListItem,
  TalentFollowUp,
  TalentPhoneCheckResult,
  TalentQuery,
  TalentDeleteImpact,
  TalentInterviewInput,
  TalentInterviewView,
} from '@/types/talent.types';

/**
 * 人才库 API（需求 v2）。候选人不是员工：独立表、独立接口。
 * 除 viewShare / downloadShareFile 外，全部要求人才库权限（后端强制）。
 */
export const talentPoolApi = {
  /** GET /talents 列表。 */
  list(query: TalentQuery): Promise<Paginated<TalentCandidateListItem>> {
    return http.get('/talents', { params: query }) as unknown as Promise<Paginated<TalentCandidateListItem>>;
  },

  /** GET /talents/:id 详情（含简历、跟进、分享记录）。 */
  detail(id: string): Promise<TalentCandidateDetail> {
    return http.get(`/talents/${id}`) as unknown as Promise<TalentCandidateDetail>;
  },

  /** POST /talents 新增；手机号重复返回 409（data.reason = TALENT_PHONE_EXISTS）。 */
  create(body: TalentCandidateInput): Promise<TalentCandidateDetail> {
    return http.post('/talents', body) as unknown as Promise<TalentCandidateDetail>;
  },

  /** PATCH /talents/:id 编辑；标记已入职需带 userId。 */
  update(id: string, body: TalentCandidateInput): Promise<TalentCandidateDetail> {
    return http.patch(`/talents/${id}`, body) as unknown as Promise<TalentCandidateDetail>;
  },

  /** DELETE /talents/:id 软删除。 */
  remove(id: string, body: { impactVersion: string; force: boolean }): Promise<{ id: string; deleted: boolean }> {
    return http.delete(`/talents/${id}`, { data: body }) as unknown as Promise<{ id: string; deleted: boolean }>;
  },

  deleteImpact(id: string): Promise<TalentDeleteImpact> {
    return http.get(`/talents/${id}/delete-impact`) as unknown as Promise<TalentDeleteImpact>;
  },

  /** GET /talents/check-phone 手机号查重。 */
  checkPhone(phone: string): Promise<TalentPhoneCheckResult> {
    return http.get('/talents/check-phone', { params: { phone } }) as unknown as Promise<TalentPhoneCheckResult>;
  },

  /** POST /talents/:id/files 绑定已上传文件（先走 uploadApi.upload(file, 'talent-resume')）。 */
  bindFile(id: string, body: BindTalentFileBody) {
    return http.post(`/talents/${id}/files`, body);
  },

  /** DELETE /talents/:id/files/:fileId 移除附件记录（对象存储不删）。 */
  unbindFile(id: string, fileId: string) {
    return http.delete(`/talents/${id}/files/${fileId}`);
  },

  /** POST /talents/:id/follow-ups 新增跟进。 */
  addFollowUp(id: string, body: CreateFollowUpBody): Promise<TalentFollowUp> {
    return http.post(`/talents/${id}/follow-ups`, body) as unknown as Promise<TalentFollowUp>;
  },

  /** GET /talents/:id/follow-ups 跟进列表（倒序，附记录人姓名）。 */
  listFollowUps(id: string): Promise<TalentFollowUp[]> {
    return http.get(`/talents/${id}/follow-ups`) as unknown as Promise<TalentFollowUp[]>;
  },

  /** POST /talents/:id/shares 创建单条只读分享。 */
  createShare(id: string, body: CreateShareBody): Promise<CreateShareResult> {
    return http.post(`/talents/${id}/shares`, body) as unknown as Promise<CreateShareResult>;
  },

  /** DELETE /talents/shares/:shareId 撤销分享。 */
  revokeShare(shareId: string): Promise<{ id: string; revoked: boolean }> {
    return http.delete(`/talents/shares/${shareId}`) as unknown as Promise<{ id: string; revoked: boolean }>;
  },

  /**
   * GET /talents/shares/:token 被分享人脱敏视图。
   * 仅要求登录 + 白名单 + 未过期 + 未撤销；失败统一 403「链接已失效或无权查看」。
   */
  viewShare(token: string): Promise<ShareView> {
    return http.get(`/talents/shares/${token}`) as unknown as Promise<ShareView>;
  },

  /** GET /talents/shares/:token/file/:fileId 被分享人下载简历（仅 includeResume=true）。 */
  async downloadShareFile(token: string, fileId: string): Promise<Blob> {
    const response = await http.get(`/talents/shares/${token}/file/${fileId}`, {
      responseType: 'blob',
    }) as unknown as AxiosResponse<Blob>;
    return response.data;
  },
};

export const talentInterviewsApi = {
  list(query: { scope?: 'mine' | 'created'; candidateId?: string }): Promise<TalentInterviewView[]> {
    return http.get('/talent-interviews', { params: query }) as unknown as Promise<TalentInterviewView[]>;
  },
  detail(id: string): Promise<TalentInterviewView> {
    return http.get(`/talent-interviews/${id}`) as unknown as Promise<TalentInterviewView>;
  },
  create(body: TalentInterviewInput): Promise<TalentInterviewView> {
    return http.post('/talent-interviews', body) as unknown as Promise<TalentInterviewView>;
  },
  update(id: string, body: Partial<Omit<TalentInterviewInput, 'candidateId' | 'requestId'>> & { version: number }): Promise<TalentInterviewView> {
    return http.patch(`/talent-interviews/${id}`, body) as unknown as Promise<TalentInterviewView>;
  },
  action(id: string, action: 'cancel' | 'complete' | 'retry-sync', version: number): Promise<TalentInterviewView> {
    return http.post(`/talent-interviews/${id}/${action}`, { version }) as unknown as Promise<TalentInterviewView>;
  },
  reconcileCalendar(id: string, version: number): Promise<{ status: 'pending' | 'unconfigured' | 'uncertain'; version: number; reason?: string }> {
    return http.post(`/talent-interviews/${id}/reconcile-calendar`, { version }) as unknown as Promise<{
      status: 'pending' | 'unconfigured' | 'uncertain'; version: number; reason?: string;
    }>;
  },
};
