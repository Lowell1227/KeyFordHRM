import type { Prisma } from '@prisma/client';
import { approvedEmploymentSourceWhere, shanghaiBusinessDate } from '@/employee-archives/employment-timeline';

/** Select each person's current formal employment before comparing company identities. */
export async function findCurrentEmploymentCompanies(
  client: Pick<Prisma.TransactionClient, 'employmentRecord'>,
  userIds?: readonly string[],
  at = new Date(),
): Promise<Map<string, string | null>> {
  if (userIds?.length === 0) return new Map();
  const date = shanghaiBusinessDate(at);
  const records = await client.employmentRecord.findMany({
    where: {
      ...(userIds ? { userId: { in: [...new Set(userIds)] } } : {}),
      AND: [approvedEmploymentSourceWhere, {
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      }],
    },
    orderBy: [{ userId: 'asc' }, { effectiveFrom: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    select: { userId: true, contractSubjectId: true },
  });
  const companies = new Map<string, string | null>();
  for (const record of records) {
    // A current null company must also win over any older overlapping association.
    if (!companies.has(record.userId)) companies.set(record.userId, record.contractSubjectId);
  }
  return companies;
}
