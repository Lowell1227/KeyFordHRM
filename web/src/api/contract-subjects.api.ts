import http from './http';
export interface ContractSubject { id: string; name: string; isActive: boolean; createdAt: string; updatedAt: string }
export const contractSubjectsApi = {
  findAll(includeInactive = false): Promise<ContractSubject[]> { return http.get('/contract-subjects', { params: { includeInactive } }) as unknown as Promise<ContractSubject[]>; },
  create(body: { name: string }): Promise<ContractSubject> { return http.post('/contract-subjects', body) as unknown as Promise<ContractSubject>; },
  update(id: string, body: { name?: string; isActive?: boolean }): Promise<ContractSubject> { return http.patch(`/contract-subjects/${id}`, body) as unknown as Promise<ContractSubject>; },
};
