import { expect, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const previewOrigin = 'http://localhost:5173';

type Person = { id: string; name: string; employeeNo: string };
type Subject = { id: string; name: string };
export type ContractFixture = {
  prefix: string;
  employee: Person;
  operator: Person;
  subjects: [Subject, Subject];
  token: string;
  uploads: Array<{ name: string; url: string }>;
};
export type ContractState = {
  contracts: Array<{
    id: string; name: string; contractType: string; isActive: boolean;
    signedAt: string | null; effectiveFrom: string | null; expiresAt: string | null;
    signingCompany: string | null; originalCompany: string | null; newCompany: string | null;
    attachments: Array<{ name: string; url: string; size: number; mimeType: string }>;
  }>;
  appliedRequests: number;
};

function fixtureQuery<T>(source: string): T {
  return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 30_000,
    input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();
      (async () => {
        if (!await prisma.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Uninitialized preview');
        ${source}
      })().finally(() => prisma.$disconnect()).catch(() => {
        console.error('Isolated contract fixture operation failed'); process.exitCode = 1;
      });`,
  })) as T;
}

export function assertContractPreview(info: TestInfo) {
  expect(info.config.globalSetup, 'Do not run the ordinary data-preparing global setup').toBeNull();
  expect(info.project.use.baseURL).toBe(previewOrigin);
  expect(info.project.use.trace, 'Do not record preview credentials in traces').toBe('off');
  const [api, web] = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1', 'hrm-web-1'], {
    encoding: 'utf8', timeout: 15_000,
  }));
  for (const container of [api, web]) {
    expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
    expect(container.State.Running).toBe(true);
  }
  expect(api.Config.Labels['com.docker.compose.service']).toBe('api');
  expect(web.Config.Labels['com.docker.compose.service']).toBe('web');
  expect(Object.keys(api.NetworkSettings.Networks)).toEqual(['hrm_internal']);
  expect(Object.values(api.NetworkSettings.Ports ?? {}).every(value => value === null)).toBe(true);
  const webEnv = Object.fromEntries(web.Config.Env.map((line: string) => {
    const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
  }));
  expect(webEnv.VITE_PREVIEW_MODE).toBe('true');
  expect(webEnv.VITE_DEV_PROXY_TARGET).toBe('http://api:3000');
  expect(web.NetworkSettings.Ports['5173/tcp']).toEqual([{ HostIp: '127.0.0.1', HostPort: '5173' }]);
  execFileSync('docker', ['exec', 'hrm-api-1', 'node', 'prisma/preview-guard.cjs'], {
    stdio: 'pipe', timeout: 15_000,
  });
}

export function createContractFixture(): ContractFixture {
  const prefix = `CM_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  return fixtureQuery<ContractFixture>(`
    const dept = await prisma.department.findFirstOrThrow({ where: { name: '预览业务部' } });
    const position = await prisma.position.findFirstOrThrow({ where: { code: 'PREVIEW_STAFF' } });
    const result = await prisma.$transaction(async tx => {
      const subjects = [];
      for (const suffix of ['虚构原主体', '虚构转签主体']) {
        subjects.push(await tx.contractSubject.create({ data: {
          name: '${prefix}_' + suffix, internalCompany: 'fuede',
        }, select: { id: true, name: true } }));
      }
      const employment = {
        effectiveFrom: new Date('2020-01-01T00:00:00Z'), entryDate: new Date('2020-01-01T00:00:00Z'),
        company: 'fuede', companyText: subjects[0].name, contractSubjectId: subjects[0].id,
        deptId: dept.id, positionId: position.id, position: position.name,
        employeeStatus: 'active', changeType: 'onboarding', sourceType: 'preview_fixture',
      };
      const operator = await tx.user.create({ data: {
        name: '${prefix}_虚构合同HR', employeeNo: '${prefix}_HR', status: 'active', sysRole: 'hr_user',
        hrCapabilities: ['employee_archive_edit'], deptId: dept.id,
        employmentHistory: { create: { ...employment, employeeNo: '${prefix}_HR' } },
      }, select: { id: true, name: true, employeeNo: true } });
      const employee = await tx.user.create({ data: {
        name: '${prefix}_虚构合同员工', employeeNo: '${prefix}_EMP', status: 'active', sysRole: 'employee',
        deptId: dept.id, positionId: position.id, position: position.name, entryDate: employment.entryDate,
        employmentHistory: { create: { ...employment, employeeNo: '${prefix}_EMP' } },
      }, select: { id: true, name: true, employeeNo: true } });
      return { prefix: '${prefix}', subjects, operator, employee };
    });
    const { JwtService } = require('@nestjs/jwt');
    const token = new JwtService({ secret: process.env.JWT_SECRET }).sign({
      sub: result.operator.id, employeeNo: result.operator.employeeNo,
    }, { expiresIn: '20m' });
    console.log(JSON.stringify({ ...result, token, uploads: [] }));
  `);
}

export function readContractState(f: ContractFixture): ContractState {
  return fixtureQuery<ContractState>(`
    await prisma.user.findFirstOrThrow({ where: ${JSON.stringify({ id: f.employee.id, employeeNo: f.employee.employeeNo })} });
    const contracts = await prisma.employeeContract.findMany({ where: { userId: '${f.employee.id}' },
      orderBy: { createdAt: 'asc' }, select: { id: true, name: true, contractType: true, isActive: true,
        signedAt: true, effectiveFrom: true, expiresAt: true, signingCompany: true,
        originalCompany: true, newCompany: true, attachments: true } });
    const appliedRequests = await prisma.employeeDataChangeRequest.count({ where: {
      userId: '${f.employee.id}', createdById: '${f.operator.id}', appliedAt: { not: null },
    } });
    console.log(JSON.stringify({ contracts, appliedRequests }));
  `);
}

export function seedLegacyContractDates(f: ContractFixture) {
  // Invalid historical data cannot be created through the corrected form; only this fixture is DB-authored.
  fixtureQuery(`
    await prisma.user.findFirstOrThrow({ where: ${JSON.stringify({ id: f.employee.id, employeeNo: f.employee.employeeNo })} });
    if (await prisma.employeeContract.count({ where: { userId: '${f.employee.id}' } })) throw new Error('Expected empty fixture');
    const row = await prisma.employeeContract.create({ data: {
      userId: '${f.employee.id}', contractType: 'contract', sequence: 0, name: '${f.prefix}_虚构旧日期错误合同',
      contractSubjectId: '${f.subjects[0].id}', signingCompany: ${JSON.stringify(f.subjects[0].name)},
      signedAt: new Date('2021-01-01T00:00:00Z'), effectiveFrom: new Date('2021-01-01T00:00:00Z'),
      expiresAt: new Date('2020-12-31T00:00:00Z'),
    } });
    console.log(JSON.stringify({ id: row.id }));
  `);
}

export function removeContractFixture(f: ContractFixture) {
  fixtureQuery(`
    const ids = ${JSON.stringify([f.operator.id, f.employee.id])};
    const subjectIds = ${JSON.stringify(f.subjects.map(subject => subject.id))};
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { employeeNo: true } });
    const subjects = await prisma.contractSubject.findMany({ where: { id: { in: subjectIds } }, select: { name: true } });
    if (users.length !== 2 || users.some(u => !u.employeeNo.startsWith('${f.prefix}_'))
      || subjects.length !== 2 || subjects.some(s => !s.name.startsWith('${f.prefix}_'))) throw new Error('Fixture ownership mismatch');
    const uploads = ${JSON.stringify(f.uploads)};
    const keys = uploads.map(file => {
      const url = new URL(file.url, 'http://localhost:5173'); const key = url.searchParams.get('key');
      if (url.origin !== 'http://localhost:5173' || url.pathname !== '/storage/download'
        || !file.name.startsWith('${f.prefix}_') || !key?.startsWith('employee-contracts/attachments/')
        || !key.endsWith('-' + file.name)) throw new Error('Attachment ownership mismatch');
      return key;
    });
    const requests = await prisma.employeeDataChangeRequest.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    await prisma.$transaction(async tx => {
      await tx.notificationLog.deleteMany({ where: { userId: { in: ids } } });
      await tx.auditLog.deleteMany({ where: { OR: [{ userId: { in: ids } },
        { entityId: { in: [...ids, ...requests.map(r => r.id)] } }] } });
      await tx.employeeContract.deleteMany({ where: { userId: { in: ids } } });
      await tx.employmentRecord.deleteMany({ where: { userId: { in: ids } } });
      await tx.employeeNumberAssignment.deleteMany({ where: { userId: { in: ids } } });
      await tx.employeeDataChangeRequest.deleteMany({ where: { id: { in: requests.map(r => r.id) } } });
      await tx.employeeProfile.deleteMany({ where: { userId: { in: ids } } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
      await tx.contractSubject.deleteMany({ where: { id: { in: subjectIds } } });
    });
    if (keys.length) {
      const { Client } = require('minio');
      const client = new Client({ endPoint: process.env.MINIO_ENDPOINT, port: Number(process.env.MINIO_PORT), useSSL: false,
        accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY });
      for (const key of new Set(keys)) await client.removeObject(process.env.MINIO_BUCKET, key);
    }
    console.log(JSON.stringify({ removedOwnContractFixture: true }));
  `);
}
