import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Notification inbox schema contract', () => {
  const apiRoot = resolve(__dirname, '../..');

  it('keeps the applied read-state migration immutable and adds ordered inbox indexes in a new migration', () => {
    const firstMigration = readFileSync(
      resolve(apiRoot, 'prisma/migrations/20260809000001_add_notification_read_state/migration.sql'),
      'utf8',
    );
    const secondMigration = readFileSync(
      resolve(apiRoot, 'prisma/migrations/20260809000002_add_notification_inbox_indexes/migration.sql'),
      'utf8',
    );
    const schema = readFileSync(resolve(apiRoot, 'prisma/schema.prisma'), 'utf8');

    expect(firstMigration).toContain('ADD COLUMN "is_read" BOOLEAN NOT NULL DEFAULT false');
    expect(firstMigration).toContain('UPDATE "notification_logs"');
    expect(secondMigration).toContain('notification_logs_inbox_recent_idx');
    expect(secondMigration).toContain('("user_id", "created_at" DESC, "id" DESC)');
    expect(secondMigration).toContain('notification_logs_inbox_unread_idx');
    expect(secondMigration).toContain('("user_id", "is_read", "created_at" DESC, "id" DESC)');
    expect(schema).toContain(
      '@@index([userId, createdAt(sort: Desc), id(sort: Desc)], map: "notification_logs_inbox_recent_idx")',
    );
    expect(schema).toContain(
      '@@index([userId, isRead, createdAt(sort: Desc), id(sort: Desc)], map: "notification_logs_inbox_unread_idx")',
    );
  });
});
