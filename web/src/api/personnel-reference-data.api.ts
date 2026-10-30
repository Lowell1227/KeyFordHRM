import http from './http';

export type PersonnelReferenceKind = 'work_location' | 'job_family';
export interface PersonnelReferenceData {
  id: string;
  kind: PersonnelReferenceKind;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const personnelReferenceDataApi = {
  findAll(kind: PersonnelReferenceKind, includeInactive = false): Promise<PersonnelReferenceData[]> {
    return http.get(`/personnel-reference-data/${kind}`, { params: { includeInactive }, skipErrorMessage: true }) as unknown as Promise<PersonnelReferenceData[]>;
  },
  create(kind: PersonnelReferenceKind, body: { name: string }): Promise<PersonnelReferenceData> {
    return http.post(`/personnel-reference-data/${kind}`, body, { skipErrorMessage: true }) as unknown as Promise<PersonnelReferenceData>;
  },
  update(kind: PersonnelReferenceKind, id: string, body: { name?: string; isActive?: boolean }): Promise<PersonnelReferenceData> {
    return http.patch(`/personnel-reference-data/${kind}/${id}`, body, { skipErrorMessage: true }) as unknown as Promise<PersonnelReferenceData>;
  },
};
