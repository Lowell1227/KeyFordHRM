import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PrismaService } from '@/prisma/prisma.service';
import { PersonnelDigestDispatcher } from './personnel-digest-dispatcher';
import type { PersonnelDigestService } from './personnel-digest.service';

jest.mock('node:fs/promises');

function fixture() {
  const settings: Record<string, string> = {
    PERSONNEL_DIGEST_ENABLED: 'true', PERSONNEL_DIGEST_HR_USER_ID: 'hr',
    PERSONNEL_DIGEST_CREDENTIALS_FILE: '/run/secrets/personnel-digest.json',
    PERSONNEL_DIGEST_HRM_ORIGIN: 'https://hrm.example.com',
  };
  const config = { get: (key: string) => settings[key] };
  let claimed = false;
  const auditLog = {
    findUnique: jest.fn().mockResolvedValue(null),
    createMany: jest.fn().mockImplementation(async () => {
      if (claimed) return { count: 0 };
      claimed = true;
      return { count: 1 };
    }),
    update: jest.fn().mockResolvedValue(null),
  };
  const prisma = {
    auditLog,
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'hr', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] }) },
  };
  const digest = { list: jest.fn().mockResolvedValue({ items: [] }) };
  const dispatcher = new PersonnelDigestDispatcher(prisma as unknown as PrismaService, config as ConfigService,
    digest as unknown as PersonnelDigestService);
  return { dispatcher, settings, auditLog, prisma, digest };
}

describe('daily personnel digest delivery', () => {
  const when = new Date('2026-11-28T01:00:00Z');
  const secret = 'SEC-fictional-preview-only';
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(when);
    jest.mocked(readFile).mockResolvedValue(JSON.stringify({
      accessToken: 'fictional-token-012345678901234567890', signingSecret: secret,
    }));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('claims only one send across concurrent invocations and sends a signed Saturday zero summary', async () => {
    const send = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ errcode: 0 }), { status: 200 }));
    const { dispatcher, auditLog } = fixture();
    await Promise.all([dispatcher.sendDaily(), dispatcher.sendDaily()]);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, options] = send.mock.calls[0];
    const sent = new URL(url.toString());
    const timestamp = sent.searchParams.get('timestamp');
    expect(sent.searchParams.get('sign')).toBe(createHmac('sha256', secret).update(timestamp + '\n' + secret).digest('base64'));
    expect(String(options?.body)).toContain('今日暂无待办');
    expect(auditLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: { newValue: { state: 'accepted', day: '2026-11-28', total: 0 } } }));
  });

  it('keeps the claim after an uncertain delivery and skips disabled, unauthorized and out of hour runs', async () => {
    const send = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('test connection failure'));
    const { dispatcher, auditLog, settings, prisma } = fixture();
    await dispatcher.sendDaily(new Date('2026-11-28T00:59:00Z'));
    settings.PERSONNEL_DIGEST_ENABLED = 'false';
    await dispatcher.sendDaily();
    settings.PERSONNEL_DIGEST_ENABLED = 'true';
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'hr', sysRole: 'employee', hrCapabilities: [] });
    await dispatcher.sendDaily();
    expect(auditLog.createMany).not.toHaveBeenCalled();
    await dispatcher.sendDaily();
    await dispatcher.sendDaily();
    expect(send).toHaveBeenCalledTimes(1);
    expect(auditLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: { newValue: { state: 'unknown', day: '2026-11-28', total: 0 } } }));
  });
});
