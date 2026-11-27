import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, type TestInfo } from '@playwright/test';

export const handoffOrigin = 'http://localhost:5173';
type Actor = { id: string; name: string; token: string };
export type HandoffFixture = {
  prefix: string;
  personnel: Actor;
  owner: Actor;
  reviewer: Actor;
  positionName: string;
  candidates: Array<{ id: string; name: string; applicationId: string }>;
  pendingIds: string[];
  returnedIds: string[];
  selfDemandId: string;
  originalRequestId: string;
};

function fixtureCommand<T>(body: string): T {
  const source = `
    require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    let stage = 'guard';
    (async () => {
      const [target] = await prisma.$queryRawUnsafe('SELECT current_database() AS name, current_user AS role');
      const marker = await prisma.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } });
      if (target.name !== 'hrm_preview' || target.role !== 'hrm_preview' || marker?.value?.fictional !== true)
        throw Error('Refusing non-fictional database');
      ${body}
    })().finally(() => prisma.$disconnect()).catch(error => {
      console.error(JSON.stringify({ category: error.name, code: error.code, stage,
        field: /^[A-Za-z_]+$/.test(error.meta?.field_name ?? '') ? error.meta.field_name : undefined })); process.exitCode = 1;
    });`;
  try {
    return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
      input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 45000,
    })) as T;
  } catch (error) {
    // Subprocess output can contain an in-memory session. Never include it in a test failure.
    const raw = String((error as { stderr?: unknown }).stderr ?? '').trim();
    const safe = /^\{"category":"[A-Za-z]+"(?:,"(?:code|field|stage)":"[A-Za-z_0-9]+")*\}$/.test(raw) ? raw : 'details withheld';
    throw new Error(`Guarded fictional handoff fixture operation failed: ${safe}`);
  }
}

export function assertHandoffPreview(info: TestInfo) {
  expect(info.project.use.baseURL).toBe(handoffOrigin);
  expect(info.config.globalSetup).toBeNull();
  expect(info.project.use.trace).toBe('off');
  expect(info.project.use.video).toBe('off');
  const containers = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1', 'hrm-web-1'], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000,
  }));
  for (const container of containers) {
    expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
    expect(container.State.Running).toBe(true);
  }
  expect(Object.keys(containers[0].NetworkSettings.Networks)).toEqual(['hrm_internal']);
  expect(Object.values(containers[0].NetworkSettings.Ports ?? {}).every(value => value === null)).toBe(true);
  expect(containers[1].NetworkSettings.Ports['5173/tcp']).toEqual([{ HostIp: '127.0.0.1', HostPort: '5173' }]);
}

export function createHandoffFixture(): HandoffFixture {
  const prefix = `WH_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  return fixtureCommand<HandoffFixture>(`
    const { createHash, randomUUID } = require('node:crypto');
    const result = await prisma.$transaction(async tx => {
      const prefix = ${JSON.stringify(prefix)};
      const department = await tx.department.create({ data: { name: prefix + '_fictional_department', company: 'fuede' } });
      const position = await tx.position.create({ data: { code: prefix, name: prefix + '_fictional_position' } });
      const actors = {};
      for (const [key, capability] of [['personnel', 'employee_archive_edit'], ['owner', 'recruitment_edit'], ['reviewer', 'recruitment_demand_review']]) {
        actors[key] = await tx.user.create({ data: { name: prefix + '_' + key, employeeNo: prefix + '_' + key,
          status: 'active', sysRole: 'hr_user', accountType: 'test', hrCapabilities: [capability],
          deptId: department.id, mustChangePassword: false }, select: { id: true, name: true, employeeNo: true } });
      }
      const candidates = [];
      for (let i = 0; i < 22; i++) {
        const candidate = await tx.talentCandidate.create({ data: { name: prefix + '_candidate_' + String(i).padStart(2, '0'),
          phone: '000' + randomUUID().replace(/[^0-9]/g, '').padEnd(8, '0').slice(0, 8),
          sourceChannel: 'other', ownerId: actors.owner.id, createdById: actors.owner.id } });
        const application = await tx.talentApplication.create({ data: { candidateId: candidate.id, positionName: position.name,
          deptId: department.id, departmentNameSnapshot: department.name, stage: 'accepted', revision: 1,
          ownerId: actors.owner.id, createdById: actors.owner.id, expectedEntryDate: new Date('2001-01-' + String(i + 2).padStart(2, '0')),
          events: { create: { actorId: actors.owner.id, action: 'accept_offer', fromStage: 'offered', toStage: 'accepted', version: 1,
            note: prefix + '_fictional_acceptance' } } } });
        candidates.push({ id: candidate.id, name: candidate.name, applicationId: application.id });
      }
      const originalCandidate = await tx.talentCandidate.create({ data: { name: prefix + '_original_intake',
        phone: '000' + randomUUID().replace(/[^0-9]/g, '').padEnd(8, '0').slice(0, 8),
        sourceChannel: 'other', ownerId: actors.owner.id, createdById: actors.owner.id } });
      const originalApplication = await tx.talentApplication.create({ data: { candidateId: originalCandidate.id,
        positionName: position.name, stage: 'onboarding', ownerId: actors.owner.id, createdById: actors.owner.id,
        expectedEntryDate: new Date('2000-01-01') } });
      const original = await tx.employeeDataChangeRequest.create({ data: { employeeName: originalCandidate.name,
        sourceType: 'manual_employee_create', intakeType: 'new_hire', onboardingStatus: 'draft', recordStatus: 'draft',
        createdById: actors.personnel.id, talentCandidateId: originalCandidate.id, talentApplicationId: originalApplication.id,
        proposedValue: { employee: { name: originalCandidate.name, effectiveFrom: '2000-01-01', entryDate: '2000-01-01' } } } });
      const pendingIds = [], returnedIds = [];
      for (const state of ['pending', 'rejected', 'self']) {
        for (let i = 0; i < (state === 'self' ? 1 : 22); i++) {
          const submitter = state === 'self' ? actors.reviewer : actors.owner;
          const reason = prefix + '_' + state + '_' + i;
          const fingerprint = createHash('sha256').update(JSON.stringify([department.id, position.id, 2, reason])).digest('hex');
          const row = await tx.recruitmentDemand.create({ data: { sourceKind: 'local', localRequestId: randomUUID(),
            sourceState: state === 'rejected' ? 'rejected' : 'pending', deptId: department.id, positionId: position.id,
            sourceFingerprint: fingerprint, localCreationFingerprint: fingerprint, requestedHeadcount: 2,
            requestReason: reason, createdById: submitter.id, submittedById: submitter.id,
            revision: state === 'rejected' ? 3 : 2,
            updatedAt: new Date((state === 'rejected' ? '2099' : '2001') + '-01-' + String(i + 1).padStart(2, '0')),
            events: { create: { actorId: submitter.id, action: state === 'rejected' ? 'local_return' : 'local_submit',
              revision: state === 'rejected' ? 3 : 2, snapshot: { fictional: true }, reason } } } });
          if (state === 'pending') pendingIds.push(row.id);
          else if (state === 'rejected') returnedIds.push(row.id);
          else actors.selfDemandId = row.id;
        }
      }
      return { prefix, ...actors, positionName: position.name, candidates, pendingIds, returnedIds,
        originalRequestId: original.id, originalCandidateId: originalCandidate.id, originalApplicationId: originalApplication.id,
        departmentId: department.id, positionId: position.id };
    }, { timeout: 30000 });
    const { JwtService } = require('@nestjs/jwt');
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    for (const key of ['personnel', 'owner', 'reviewer']) result[key].token = jwt.sign({ sub: result[key].id,
      employeeNo: result[key].employeeNo }, { expiresIn: '20m' });
    process.stdout.write(JSON.stringify(result));
  `);
}

export function removeHandoffFixture(f: HandoffFixture) {
  fixtureCommand(`
    const prefix = ${JSON.stringify(f.prefix)};
    if (!/^WH_[a-f0-9]{10}$/.test(prefix)) throw Error('Invalid fixture prefix');
    const users = await prisma.user.findMany({ where: { employeeNo: { startsWith: prefix + '_' } }, select: { id: true } });
    if (users.length !== 3) throw Error('Fixture ownership mismatch');
    const actorIds = users.map(row => row.id);
    const candidates = await prisma.talentCandidate.findMany({ where: { name: { startsWith: prefix + '_' }, createdById: { in: actorIds } }, select: { id: true } });
    const candidateIds = candidates.map(row => row.id);
    const applications = await prisma.talentApplication.findMany({ where: { candidateId: { in: candidateIds } }, select: { id: true } });
    const applicationIds = applications.map(row => row.id);
    const demands = await prisma.recruitmentDemand.findMany({ where: { createdById: { in: actorIds }, requestReason: { startsWith: prefix + '_' } }, select: { id: true } });
    const demandIds = demands.map(row => row.id);
    await prisma.$transaction(async tx => {
      stage = 'requests';
      const requests = await tx.employeeDataChangeRequest.findMany({ where: { talentCandidateId: { in: candidateIds }, createdById: { in: actorIds } }, select: { id: true, userId: true } });
      if (requests.some(row => row.userId)) throw Error('Unexpected submitted fixture; preserve for diagnosis');
      const requestIds = requests.map(row => row.id);
      stage = 'audit';
      await tx.auditLog.deleteMany({ where: { userId: { in: actorIds } } });
      stage = 'notifications';
      await tx.notificationLog.deleteMany({ where: { userId: { in: actorIds } } });
      stage = 'requests_delete';
      await tx.employeeDataChangeRequest.deleteMany({ where: { id: { in: requestIds } } });
      stage = 'application_events';
      await tx.talentApplicationEvent.deleteMany({ where: { applicationId: { in: applicationIds } } });
      stage = 'applications';
      await tx.talentApplication.deleteMany({ where: { id: { in: applicationIds } } });
      await tx.talentCandidate.deleteMany({ where: { id: { in: candidateIds } } });
      // Demand events are append-only. Retire only owned fixtures without disabling shared DB guards.
      stage = 'demands';
      await tx.recruitmentDemand.updateMany({ where: { id: { in: demandIds }, sourceState: { in: ['pending', 'rejected'] } },
        data: { sourceState: 'withdrawn', revision: { increment: 1 } } });
      await tx.user.updateMany({ where: { id: { in: actorIds } }, data: { archivedAt: new Date() } });
      await tx.position.updateMany({ where: { code: prefix }, data: { isActive: false } });
      await tx.department.updateMany({ where: { name: prefix + '_fictional_department' }, data: { isActive: false } });
    });
    process.stdout.write(JSON.stringify({ removedOwnedFixture: true }));
  `);
}
