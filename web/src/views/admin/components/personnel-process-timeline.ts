export type PersonnelProcessTone = 'success' | 'current' | 'danger' | 'waiting' | 'neutral';

export interface PersonnelProcessDetail {
  key: string;
  title: string;
  status: string;
  tone: PersonnelProcessTone;
  actor?: string;
  time?: string;
}

export interface PersonnelProcessStep {
  key: string;
  title: string;
  status: string;
  tone: PersonnelProcessTone;
  current?: boolean;
  actor?: string;
  time?: string;
  note?: string;
  details?: PersonnelProcessDetail[];
}
