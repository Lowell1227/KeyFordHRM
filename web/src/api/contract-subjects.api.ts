import http from './http';
import type { CompanyCode } from '@/types/enums';

export interface ContractSubject {
  id: string;
  name: string;
  internalCompany: CompanyCode | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
export const contractSubjectsApi = {
  findAll(includeInactive = false): Promise<ContractSubject[]> { return http.get('/contract-subjects', { params: { includeInactive } }) as unknown as Promise<ContractSubject[]>; },
  create(body: { name: string; internalCompany?: CompanyCode | null }): Promise<ContractSubject> { return http.post('/contract-subjects', body) as unknown as Promise<ContractSubject>; },
  update(id: string, body: { name?: string; isActive?: boolean; internalCompany?: CompanyCode | null }): Promise<ContractSubject> { return http.patch(`/contract-subjects/${id}`, body) as unknown as Promise<ContractSubject>; },
};
