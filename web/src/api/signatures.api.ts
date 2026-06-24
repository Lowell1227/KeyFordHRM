import http from './http';
import type { Signature, SignatureQuery, CreateSignatureBody } from '@/types/api.types';

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

function apiPost<T>(url: string, data?: unknown): Promise<T> {
  return http.post(url, data) as unknown as Promise<T>;
}

export const signaturesApi = {
  /** GET /signatures — 查询业务记录的三方签字状态。 */
  findAll(query: SignatureQuery): Promise<Signature[]> {
    return apiGet('/signatures', query as unknown as Record<string, unknown>);
  },

  /** POST /signatures — 当前用户以指定角色签字。 */
  sign(body: CreateSignatureBody): Promise<Signature> {
    return apiPost('/signatures', body);
  },
};
