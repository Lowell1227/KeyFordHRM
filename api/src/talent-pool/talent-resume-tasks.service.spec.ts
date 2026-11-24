import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '@/common/types/auth.types';
import { TalentResumeTasksService } from './talent-resume-tasks.service';

const hr = { id: '11111111-1111-4111-8111-111111111111', sysRole: 'hr' } as AuthUser;
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082', 'hex');
const file = { buffer: png, size: png.length, originalname: 'synthetic-resume.png', mimetype: 'image/png' } as Express.Multer.File;
const fields = { fields: { name: 'Synthetic Candidate' }, reviewItems: [], source: { fileName: file.originalname } };
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup() {
  const rows = new Map<string, any>();
  const matches = (row: any, where: any = {}) => Object.entries(where).every(([key, value]: [string, any]) => {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('gt' in value) return row[key] > value.gt;
      if ('gte' in value) return row[key] >= value.gte;
      if ('lte' in value) return row[key] <= value.lte;
    }
    return row[key] === value;
  });
  const table = {
    findFirst: jest.fn(async ({ where, orderBy }: any) => [...rows.values()].filter(row => matches(row, where))
      .sort((a, b) => { const key = orderBy ? Object.keys(Array.isArray(orderBy) ? orderBy[0] : orderBy)[0] : 'createdAt';
        return b[key].getTime() - a[key].getTime(); })[0] ?? null),
    findMany: jest.fn(async ({ where }: any) => [...rows.values()].filter(row => matches(row, where))),
    count: jest.fn(async ({ where }: any) => [...rows.values()].filter(row => matches(row, where)).length),
    create: jest.fn(async ({ data }: any) => { rows.set(data.id, { ...data }); return rows.get(data.id); }),
    updateMany: jest.fn(async ({ where, data }: any) => { let count = 0; for (const row of rows.values()) if (matches(row, where)) { Object.assign(row, data); count++; } return { count }; }),
    deleteMany: jest.fn(async ({ where }: any) => { let count = 0; for (const [id, row] of rows) if (matches(row, where)) { rows.delete(id); count++; } return { count }; }),
  };
  const db = { user: { findUnique: jest.fn(async ({ where }) => ({ ...hr, id: where.id, status: 'active' })) },
    talentResumeTask: table, $executeRaw: jest.fn(), $transaction: async (work: any) => work(db) };
  const parser = { getStatus: jest.fn(async () => ({ enabled: true, configured: true })), parse: jest.fn(async () => fields) };
  const config = new ConfigService({ AI_PROVIDER_ENCRYPTION_KEY: Buffer.alloc(32, 27).toString('base64') });
  const service = new TalentResumeTasksService(db as never, config, parser as never);
  return { service, parser, db, table, rows, config };
}

describe('Resume tasks: encrypted temporary state and explicit recovery', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects unauthorized actors before reading task data', async () => {
    const { service, table } = setup();
    await expect(service.current('new', { ...hr, sysRole: 'employee' })).rejects.toThrow('权限');
    expect(table.findFirst).not.toHaveBeenCalled();
  });

  it('starts once, returns the same active task for duplicate uploads, and stores no plaintext resume', async () => {
    const { service, parser, rows } = setup();
    let resolve: (value: any) => void;
    parser.parse.mockImplementation(() => new Promise(r => { resolve = r; }));
    const task = await service.start(file, 'new', hr);
    await flush();
    const duplicate = await service.start(file, 'new', hr);
    expect(duplicate.id).toBe(task.id);
    expect(parser.parse).toHaveBeenCalledTimes(1);
    const stored = [...rows.values()][0];
    expect(JSON.stringify(stored)).not.toContain(file.originalname);
    expect(Buffer.from(stored.fileEncrypted).includes(png)).toBe(false);
    resolve!(fields); await flush();
    expect(await service.get(task.id, hr)).toMatchObject({ status: 'succeeded', result: fields });
  });

  it('recovers a completed result and its original file in a new service instance, only for its owner', async () => {
    const { service, db, config, parser } = setup();
    const task = await service.start(file, 'new', hr); await flush();
    const restored = new TalentResumeTasksService(db as never, config, parser as never);
    expect(await restored.current('new', hr)).toMatchObject({ id: task.id, status: 'succeeded', result: fields });
    expect((await restored.file(task.id, hr)).buffer).toEqual(png);
    await expect(restored.get(task.id, { ...hr, id: '22222222-2222-4222-8222-222222222222' })).rejects.toThrow('不存在');
    await expect(restored.file(task.id, { ...hr, id: '22222222-2222-4222-8222-222222222222' })).rejects.toThrow('不存在');
    expect(await restored.current('another-context', hr)).toBeNull();
  });

  it('recovers with parsing switched off, never extends retention and rejects tampered encrypted content', async () => {
    const { service, parser, rows } = setup();
    const task = await service.start(file, 'new', hr); await flush();
    expect(new Date(task.expiresAt).getTime() - new Date(task.createdAt).getTime()).toBe(1800000);
    parser.getStatus.mockResolvedValue({ enabled: false, configured: true });
    expect(await service.current('new', hr)).toMatchObject({ id: task.id, status: 'succeeded', expiresAt: task.expiresAt });
    const row = rows.get(task.id), encrypted = Buffer.from(row.fileEncrypted);
    encrypted[encrypted.length - 1] ^= 1; row.fileEncrypted = encrypted;
    await expect(service.file(task.id, hr)).rejects.toThrow('不可读取');
  });

  it('caps waiting at 150 seconds, preserves source for explicit retry, and ignores late old results', async () => {
    const { service, parser } = setup();
    const now = jest.spyOn(Date, 'now').mockReturnValue(2_000_000);
    let finish: (value: any) => void;
    parser.parse.mockImplementationOnce(() => new Promise(r => { finish = r; }));
    const first = await service.start(file, 'new', hr); await flush();
    expect(new Date(first.deadlineAt).getTime() - new Date(first.createdAt).getTime()).toBe(150000);
    now.mockReturnValue(2_150_001);
    expect(await service.get(first.id, hr)).toMatchObject({ status: 'timed_out' });
    const next = await service.retry(first.id, hr); await flush();
    expect(next.id).not.toBe(first.id);
    finish!({ ...fields, fields: { name: 'Old late result' } }); await flush();
    expect(await service.get(first.id, hr)).toMatchObject({ status: 'timed_out' });
    expect(await service.current('new', hr)).toMatchObject({ id: next.id, status: 'succeeded', result: fields });
  });

  it('never retries on its own and clears source/result on expiration or explicit deletion', async () => {
    const { service, parser, rows } = setup();
    const now = jest.spyOn(Date, 'now').mockReturnValue(3_000_000);
    parser.parse.mockRejectedValueOnce(new Error('private provider failure'));
    const first = await service.start(file, 'new', hr); await flush();
    expect(await service.get(first.id, hr)).toMatchObject({ status: 'failed' });
    expect(parser.parse).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await service.get(first.id, hr))).not.toContain('private provider failure');
    const retry = await service.retry(first.id, hr); await flush();
    await service.clear(retry.id, hr);
    await expect(service.get(retry.id, hr)).rejects.toThrow('不存在');
    now.mockReturnValue(4_800_001);
    await expect(service.get(first.id, hr)).rejects.toThrow('不存在');
    await service.cleanup();
    expect(rows.size).toBe(0);
  });

  it('clears all attempts in the current context so refresh cannot resurrect failed source files', async () => {
    const { service, parser } = setup();
    parser.parse.mockRejectedValueOnce(new Error('synthetic failure'));
    const first = await service.start(file, 'new', hr); await flush();
    const retry = await service.retry(first.id, hr); await flush();
    await service.clear(retry.id, hr);
    expect(await service.current('new', hr)).toBeNull();
    await expect(service.file(first.id, hr)).rejects.toThrow('不存在');
  });

  it('reuses an older matching success and makes it current without another billable call', async () => {
    const { service, parser } = setup();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(6_000_000);
    const first = await service.start(file, 'new', hr); await flush();
    clock.mockReturnValue(6_001_000);
    await service.start({ ...file, originalname: 'other.png' }, 'new', hr); await flush();
    clock.mockReturnValue(6_002_000);
    expect(await service.start(file, 'new', hr)).toMatchObject({ id: first.id, expiresAt: first.expiresAt });
    expect(await service.current('new', hr)).toMatchObject({ id: first.id });
    expect(parser.parse).toHaveBeenCalledTimes(2);
  });

  it('rechecks a retry source inside admission after a concurrent clear', async () => {
    const { service, parser, db } = setup();
    parser.parse.mockRejectedValueOnce(new Error('synthetic failure'));
    const first = await service.start(file, 'new', hr); await flush();
    const transact = db.$transaction.bind(db);
    jest.spyOn(db, '$transaction').mockImplementationOnce(async (work: any) => {
      await service.clear(first.id, hr);
      return transact(work);
    });
    await expect(service.retry(first.id, hr)).rejects.toThrow('不存在');
    expect(await service.current('new', hr)).toBeNull();
    expect(parser.parse).toHaveBeenCalledTimes(1);
  });

  it('rejects cleanup from a stale tab without deleting its newer active task', async () => {
    const { service, parser } = setup();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(7_000_000);
    const first = await service.start(file, 'new', hr); await flush();
    clock.mockReturnValue(7_001_000);
    let finish: (value: any) => void;
    parser.parse.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const second = await service.start({ ...file, originalname: 'newer.png' }, 'new', hr); await flush();
    try {
      await expect(service.clear(first.id, hr)).rejects.toThrow('已更新');
      expect(await service.current('new', hr)).toMatchObject({ id: second.id, status: 'processing' });
      expect((await service.file(second.id, hr)).buffer).toEqual(png);
    } finally { finish!(fields); await flush(); }
    expect(await service.current('new', hr)).toMatchObject({ id: second.id, status: 'succeeded' });
  });

  it('rejects invalid context/file and a disabled provider without creating temporary records', async () => {
    const { service, parser, rows } = setup();
    await expect(service.start(file, '../wrong', hr)).rejects.toThrow();
    await expect(service.start({ ...file, buffer: Buffer.from('forged') }, 'new', hr)).rejects.toThrow();
    parser.getStatus.mockResolvedValue({ enabled: false, configured: true });
    await expect(service.start(file, 'new', hr)).rejects.toThrow('未启用');
    expect(rows.size).toBe(0);
  });
});
