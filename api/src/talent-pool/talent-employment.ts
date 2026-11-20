export type TalentEmploymentStatus = 'active' | 'probation' | 'resigned' | 'pending_entry' | 'unknown';

export interface TalentLinkedEmployee {
  id: string;
  status: string;
  deletedAt: Date | null;
  archivedAt: Date | null;
}

export function talentEmploymentStatus(
  convertedUserId: string | null | undefined,
  user: TalentLinkedEmployee | null | undefined,
): TalentEmploymentStatus | null {
  if (!convertedUserId) return null;
  if (!user || user.id !== convertedUserId || user.deletedAt || (user.archivedAt && user.status !== 'resigned')) return 'unknown';
  switch (user.status) {
    case 'active': case 'probation': case 'resigned': case 'pending_entry': return user.status;
    default: return 'unknown';
  }
}
