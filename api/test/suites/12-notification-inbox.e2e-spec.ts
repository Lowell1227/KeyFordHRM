import { SysRole } from '@prisma/client';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { authHeader, login } from '../helpers/auth-helper';
import { buildTestApp, closeTestApp, TestApp } from '../test-app';

describe('Notification inbox', () => {
  let app: TestApp;
  let factory: FixtureFactory;

  beforeAll(async () => {
    app = await buildTestApp();
    factory = new FixtureFactory(app.prisma);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await factory.resetDataTables();
  });

  it('keeps delivery status independent while closing the authenticated read workflow', async () => {
    const dept = await factory.createDept({ name: 'Notification Inbox Dept' });
    const owner = await factory.createUser({
      employeeNo: 'NOTIFY-OWNER',
      name: 'Notification Owner',
      sysRole: SysRole.manager,
      deptId: dept.id,
    });
    const foreign = await factory.createUser({
      employeeNo: 'NOTIFY-FOREIGN',
      name: 'Notification Foreign',
      sysRole: SysRole.manager,
      deptId: dept.id,
    });
    const [ownerToken, foreignToken] = await Promise.all([
      login(app.http, { employeeNo: owner.employeeNo!, password: 'test123' }),
      login(app.http, { employeeNo: foreign.employeeNo!, password: 'test123' }),
    ]);

    const older = await app.prisma.notificationLog.create({
      data: {
        userId: owner.id,
        type: 'indicator_setting_notice',
        title: 'Older owner notification',
        content: 'Review objectives',
        channel: 'dingtalk',
        status: 'sent',
        sentAt: new Date('2026-08-09T08:00:00.000Z'),
        createdAt: new Date('2026-08-09T08:00:00.000Z'),
      },
    });
    const newer = await app.prisma.notificationLog.create({
      data: {
        userId: owner.id,
        type: 'self_eval_submitted',
        title: 'Newer owner notification',
        content: 'Score employee',
        channel: 'system',
        status: 'sent',
        sentAt: new Date('2026-08-09T09:00:00.000Z'),
        createdAt: new Date('2026-08-09T09:00:00.000Z'),
      },
    });
    const foreignNotification = await app.prisma.notificationLog.create({
      data: {
        userId: foreign.id,
        type: 'task_reminder',
        title: 'Foreign notification',
        content: 'Private',
        channel: 'test',
        status: 'sent',
        sentAt: new Date('2026-08-09T10:00:00.000Z'),
        createdAt: new Date('2026-08-09T10:00:00.000Z'),
      },
    });

    const paged = await app.http
      .get(`/api/v1/notifications?page=1&pageSize=1&userId=${foreign.id}`)
      .set(authHeader(ownerToken))
      .expect(200);
    expect(paged.body.data).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(paged.body.data.items).toEqual([
      expect.objectContaining({
        id: newer.id,
        userId: owner.id,
        type: 'self_eval_submitted',
        channel: 'system',
        status: 'sent',
        isRead: false,
        readAt: null,
      }),
    ]);
    expect(paged.body.data.items[0]).not.toHaveProperty('errorMsg');
    expect(paged.body.data.items[0]).not.toHaveProperty('extraData');

    const initialUnread = await app.http
      .get('/api/v1/notifications/unread-count')
      .set(authHeader(ownerToken))
      .expect(200);
    expect(initialUnread.body.data).toEqual({ count: 2 });

    const explicitFalse = await app.http
      .get('/api/v1/notifications?unreadOnly=false&page=1&pageSize=10')
      .set(authHeader(ownerToken))
      .expect(200);
    expect(explicitFalse.body.data.total).toBe(2);
    await app.http
      .get('/api/v1/notifications?unreadOnly=garbage&page=1&pageSize=10')
      .set(authHeader(ownerToken))
      .expect(400);

    const firstRead = await app.http
      .patch(`/api/v1/notifications/${newer.id}/read`)
      .set(authHeader(ownerToken))
      .expect(200);
    expect(firstRead.body.data).toMatchObject({
      id: newer.id,
      status: 'sent',
      isRead: true,
      unreadCount: 1,
    });
    expect(firstRead.body.data.readAt).toEqual(expect.any(String));
    const firstReadAt = firstRead.body.data.readAt;

    const repeatedRead = await app.http
      .patch(`/api/v1/notifications/${newer.id}/read`)
      .set(authHeader(ownerToken))
      .expect(200);
    expect(repeatedRead.body.data).toMatchObject({
      id: newer.id,
      status: 'sent',
      isRead: true,
      readAt: firstReadAt,
      unreadCount: 1,
    });

    const ownerCannotReadForeign = await app.http
      .patch(`/api/v1/notifications/${foreignNotification.id}/read`)
      .set(authHeader(ownerToken))
      .expect(404);
    expect(ownerCannotReadForeign.body.code).toBe(4004);

    const unreadOnly = await app.http
      .get('/api/v1/notifications?unreadOnly=true&page=1&pageSize=10')
      .set(authHeader(ownerToken))
      .expect(200);
    expect(unreadOnly.body.data.items.map((item: { id: string }) => item.id)).toEqual([older.id]);

    const markedAll = await app.http.post('/api/v1/notifications/read-all').set(authHeader(ownerToken)).expect(201);
    expect(markedAll.body.data).toEqual({
      marked: 1,
      readAt: expect.any(String),
      unreadCount: 0,
    });
    const repeatedAll = await app.http.post('/api/v1/notifications/read-all').set(authHeader(ownerToken)).expect(201);
    expect(repeatedAll.body.data).toEqual({
      marked: 0,
      readAt: expect.any(String),
      unreadCount: 0,
    });

    const finalUnread = await app.http
      .get('/api/v1/notifications/unread-count')
      .set(authHeader(ownerToken))
      .expect(200);
    expect(finalUnread.body.data).toEqual({ count: 0 });
    const foreignUnread = await app.http
      .get('/api/v1/notifications/unread-count')
      .set(authHeader(foreignToken))
      .expect(200);
    expect(foreignUnread.body.data).toEqual({ count: 1 });

    const rows = await app.prisma.notificationLog.findMany({
      where: { id: { in: [older.id, newer.id, foreignNotification.id] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((row) => row.status)).toEqual(['sent', 'sent', 'sent']);
    expect(rows[0].isRead).toBe(true);
    expect(rows[1].isRead).toBe(true);
    expect(rows[2].isRead).toBe(false);

    const indexes = await app.prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'notification_logs'
        AND indexname IN (
          'notification_logs_inbox_recent_idx',
          'notification_logs_inbox_unread_idx'
        )
      ORDER BY indexname
    `;
    expect(indexes).toEqual([
      expect.objectContaining({
        indexname: 'notification_logs_inbox_recent_idx',
        indexdef: expect.stringMatching(/\(user_id, created_at DESC, id DESC\)/),
      }),
      expect.objectContaining({
        indexname: 'notification_logs_inbox_unread_idx',
        indexdef: expect.stringMatching(/\(user_id, is_read, created_at DESC, id DESC\)/),
      }),
    ]);

    await app.prisma.notificationLog.createMany({
      data: Array.from({ length: 64 }, (_, index) => ({
        userId: owner.id,
        type: 'read_history',
        title: `Read history ${index}`,
        channel: 'system',
        status: 'sent',
        isRead: true,
        readAt: new Date('2026-08-09T14:00:00.000Z'),
        createdAt: new Date(2026, 7, 9, 14, 0, index),
      })),
    });
    await app.prisma.$executeRawUnsafe('ANALYZE "notification_logs"');

    const plans = await app.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      const recent = await tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
        `EXPLAIN (COSTS OFF) SELECT id FROM notification_logs WHERE user_id = '${owner.id}' ORDER BY created_at DESC, id DESC LIMIT 10`,
      );
      const unread = await tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
        `EXPLAIN (COSTS OFF) SELECT id FROM notification_logs WHERE user_id = '${owner.id}' AND is_read = false ORDER BY created_at DESC, id DESC LIMIT 10`,
      );
      return { recent, unread };
    });
    expect(plans.recent.map((row) => row['QUERY PLAN']).join('\n')).toContain('notification_logs_inbox_recent_idx');
    expect(plans.unread.map((row) => row['QUERY PLAN']).join('\n')).toContain('notification_logs_inbox_unread_idx');
  });
});
