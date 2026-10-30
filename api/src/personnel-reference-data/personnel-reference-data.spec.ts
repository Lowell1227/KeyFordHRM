import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthUser } from '@/common/types/auth.types';
import { PersonnelReferenceDataService } from './personnel-reference-data.service';
import { PersonnelReferenceDataGuard } from './personnel-reference-data.guard';
import {
  CreatePersonnelReferenceDataDto,
  PersonnelReferenceDataQueryDto,
  UpdatePersonnelReferenceDataDto,
} from './personnel-reference-data.dto';

const id = '11111111-1111-4111-8111-111111111111';
const actor = (sysRole = 'hr', hrCapabilities: string[] = []) =>
  ({ id, sysRole, hrCapabilities }) as AuthUser;
const transform = <T>(dto: new () => T, input: object) =>
  plainToInstance(dto, input, { enableImplicitConversion: true });

describe('personnel reference data validation', () => {
  it.each(['', '  ', '甲'.repeat(101), null, 123, true])(
    'rejects invalid create name %p',
    async (name) => {
      expect(
        (
          await validate(
            transform(CreatePersonnelReferenceDataDto, { name }) as object,
          )
        ).map((error) => error.property),
      ).toContain('name');
    },
  );
  it('trims names and accepts the 100 character boundary', async () => {
    const input = transform(CreatePersonnelReferenceDataDto, {
      name: `  ${'甲'.repeat(100)}  `,
    });
    expect(input.name).toBe('甲'.repeat(100));
    expect(await validate(input)).toEqual([]);
  });
  it.each(['', ' ', '甲'.repeat(101), null, 123])(
    'rejects invalid update name %p',
    async (name) => {
      expect(
        (
          await validate(transform(UpdatePersonnelReferenceDataDto, { name }))
        ).map((error) => error.property),
      ).toContain('name');
    },
  );
  it.each(['false', 'true', 0, 1, null])(
    'rejects non-boolean status %p despite implicit conversion',
    async (isActive) => {
      expect(
        (
          await validate(
            transform(UpdatePersonnelReferenceDataDto, { isActive }),
          )
        ).map((error) => error.property),
      ).toContain('isActive');
    },
  );
  it.each([true, false])('accepts actual JSON boolean %p', async (isActive) => {
    const input = transform(UpdatePersonnelReferenceDataDto, { isActive });
    expect(input.isActive).toBe(isActive);
    expect(await validate(input)).toEqual([]);
  });
  it.each(['true', 'false'])('strictly parses query %s', async (value) => {
    const input = transform(PersonnelReferenceDataQueryDto, {
      includeInactive: value,
    });
    expect(input.includeInactive).toBe(value === 'true');
    expect(await validate(input)).toEqual([]);
  });
  it.each(['invalid', '1', '0', '', null, ['true', 'false']])(
    'rejects malformed query %p',
    async (value) => {
      expect(
        (
          await validate(
            transform(PersonnelReferenceDataQueryDto, {
              includeInactive: value,
            }),
          )
        ).map((error) => error.property),
      ).toContain('includeInactive');
    },
  );
});

describe('personnel reference data scope in guard and service', () => {
  const permissions = [
    ['hr', [], true, true, true],
    ['system_admin', [], true, true, true],
    ['hr_user', ['employee_archive_edit'], true, true, true],
    ['hr_user', ['employee_archive_review'], true, true, false],
    ['hr_user', ['organization_edit'], false, true, false],
    ['hr_user', [], false, false, false],
    [
      'employee',
      ['employee_archive_edit', 'employee_archive_review', 'organization_edit'],
      false,
      false,
      false,
    ],
  ] as const;
  it.each(permissions)(
    'checks %s %j for each kind and action',
    async (role, capabilities, workRead, jobRead, write) => {
      const user = actor(role, [...capabilities]);
      const guard = new PersonnelReferenceDataGuard();
      for (const [kind, readable] of [
        ['work_location', workRead],
        ['job_family', jobRead],
      ] as const) {
        const service = new PersonnelReferenceDataService({
          personnelReferenceData: { findMany: async () => [] },
          $transaction: async (run: any) =>
            run({
              $queryRaw: async () => [
                { id, kind, name: '原名', isActive: true },
              ],
              personnelReferenceData: {
                create: async ({ data }: any) => ({
                  id,
                  ...data,
                  isActive: true,
                }),
                update: async ({ data }: any) => ({
                  id,
                  kind,
                  name: '原名',
                  isActive: true,
                  ...data,
                }),
              },
              auditLog: { create: async () => ({}) },
            }),
        } as any);
        for (const [method, permitted] of [
          ['GET', readable],
          ['POST', write],
          ['PATCH', write],
        ] as const) {
          const context = {
            switchToHttp: () => ({
              getRequest: () => ({ method, params: { kind }, user }),
            }),
          };
          if (permitted) expect(guard.canActivate(context as any)).toBe(true);
          else
            expect(() => guard.canActivate(context as any)).toThrow(
              ForbiddenException,
            );
          const run = async (): Promise<unknown> =>
            method === 'GET'
              ? service.findAll(kind, {}, user)
              : method === 'POST'
                ? service.create(kind, { name: '新名' }, user)
                : service.update(kind, id, { isActive: false }, user);
          if (permitted)
            await expect(Promise.resolve().then(run)).resolves.toBeDefined();
          else
            await expect(Promise.resolve().then(run)).rejects.toThrow(
              ForbiddenException,
            );
        }
      }
    },
  );
});

describe('personnel reference data writes', () => {
  const before = { id, kind: 'work_location', name: '原名', isActive: true };
  let rows: any[];
  let audits: any[];
  let service: PersonnelReferenceDataService;
  let failAudit: boolean;
  let failWrite: object | null;
  beforeEach(() => {
    rows = [];
    audits = [];
    failAudit = false;
    failWrite = null;
    service = new PersonnelReferenceDataService({
      personnelReferenceData: {
        findMany: async ({ where }: any) =>
          rows.filter(
            (row) =>
              row.kind === where.kind &&
              (where.isActive === undefined || row.isActive === where.isActive),
          ),
      },
      $transaction: async (run: any) => {
        const draftRows = rows.map((row) => ({ ...row }));
        const draftAudits = [...audits];
        const result = await run({
          $queryRaw: async (
            _query: TemplateStringsArray,
            queryId: string,
            queryKind: string,
          ) =>
            draftRows.filter(
              (row) => row.id === queryId && row.kind === queryKind,
            ),
          personnelReferenceData: {
            create: async ({ data }: any) => {
              if (failWrite) throw failWrite;
              const row = { id, isActive: true, ...data };
              draftRows.push(row);
              return row;
            },
            update: async ({ where, data }: any) => {
              if (failWrite) throw failWrite;
              const index = draftRows.findIndex((row) => row.id === where.id);
              draftRows[index] = { ...draftRows[index], ...data };
              return draftRows[index];
            },
          },
          auditLog: {
            create: async ({ data }: any) => {
              if (failAudit) throw new Error('audit unavailable');
              draftAudits.push(data);
            },
          },
        });
        rows = draftRows;
        audits = draftAudits;
        return result;
      },
    } as any);
  });
  it('creates a trimmed name with a transactional audit', async () => {
    expect(
      await service.create('work_location', { name: '  新地点  ' }, actor()),
    ).toMatchObject({
      id,
      kind: 'work_location',
      name: '新地点',
      isActive: true,
    });
    expect(audits).toEqual([
      expect.objectContaining({
        userId: id,
        action: 'create_personnel_reference_data',
        entityType: 'personnel_reference_data',
        entityId: id,
        newValue: { kind: 'work_location', name: '新地点', isActive: true },
      }),
    ]);
  });
  it('updates the requested kind and records before and after snapshots', async () => {
    rows = [before];
    expect(
      await service.update(
        'work_location',
        id,
        { name: '  新名  ', isActive: false },
        actor(),
      ),
    ).toMatchObject({ name: '新名', isActive: false });
    expect(audits[0]).toMatchObject({
      action: 'update_personnel_reference_data',
      oldValue: { kind: 'work_location', name: '原名', isActive: true },
      newValue: { kind: 'work_location', name: '新名', isActive: false },
    });
    expect(await service.findAll('work_location', {}, actor())).toEqual([]);
    expect(
      await service.findAll(
        'work_location',
        { includeInactive: true },
        actor(),
      ),
    ).toHaveLength(1);
    expect(
      await service.findAll('job_family', { includeInactive: true }, actor()),
    ).toEqual([]);
  });
  it('rejects absent IDs and IDs belonging to another kind without auditing', async () => {
    await expect(
      service.update('work_location', id, { name: '新名' }, actor()),
    ).rejects.toThrow(NotFoundException);
    rows = [before];
    await expect(
      service.update('job_family', id, { name: '新名' }, actor()),
    ).rejects.toThrow(NotFoundException);
    expect(rows).toEqual([before]);
    expect(audits).toEqual([]);
  });
  it('maps unique constraint conflicts into 409', async () => {
    failWrite = { code: 'P2002' };
    await expect(
      service.create('work_location', { name: '重复' }, actor()),
    ).rejects.toThrow(ConflictException);
    rows = [before];
    await expect(
      service.update('work_location', id, { name: '重复' }, actor()),
    ).rejects.toThrow(ConflictException);
    expect(audits).toEqual([]);
  });
  it('rolls back both creates and updates when audit persistence fails', async () => {
    failAudit = true;
    await expect(
      service.create('work_location', { name: '新名' }, actor()),
    ).rejects.toThrow('audit unavailable');
    expect(rows).toEqual([]);
    rows = [before];
    await expect(
      service.update('work_location', id, { isActive: false }, actor()),
    ).rejects.toThrow('audit unavailable');
    expect(rows).toEqual([before]);
    expect(audits).toEqual([]);
  });
  it('validates kind and direct service inputs before database access', async () => {
    await expect(service.findAll('unknown', {}, actor())).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.findAll(
        'work_location',
        { includeInactive: 'false' } as any,
        actor(),
      ),
    ).rejects.toThrow(BadRequestException);
    for (const name of ['', ' ', '甲'.repeat(101), null, 42]) {
      await expect(
        service.create('work_location', { name } as any, actor()),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.update('work_location', id, { name } as any, actor()),
      ).rejects.toThrow(BadRequestException);
    }
    for (const isActive of ['false', 0, null])
      await expect(
        service.update('work_location', id, { isActive } as any, actor()),
      ).rejects.toThrow(BadRequestException);
    await expect(
      service.update('work_location', 'bad-id', { name: '新名' }, actor()),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.update('work_location', id, {}, actor()),
    ).rejects.toThrow(BadRequestException);
    expect(rows).toEqual([]);
    expect(audits).toEqual([]);
  });
});
