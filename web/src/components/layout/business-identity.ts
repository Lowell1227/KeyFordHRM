import type { BusinessIdentity } from '@/types/api.types';

export function formatBusinessIdentityLabel(identity: BusinessIdentity): string {
  return `${identity.label} · 负责 ${identity.count} 项`;
}
