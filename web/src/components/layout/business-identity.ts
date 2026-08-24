import type { BusinessIdentity } from '@/types/api.types';

export function formatBusinessIdentityLabel(identity: BusinessIdentity): string {
  return `${identity.label} · ${identity.count} 项`;
}
