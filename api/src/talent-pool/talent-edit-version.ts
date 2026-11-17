import { Prisma, type TalentCandidate } from '@prisma/client';
import { createHash } from 'node:crypto';

export function talentEditVersion(candidate: Partial<TalentCandidate>): string {
  const snapshot = Object.values(Prisma.TalentCandidateScalarFieldEnum).sort()
    .map(field => [field, candidate[field] ?? null]);
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
