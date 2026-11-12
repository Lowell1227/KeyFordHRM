import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { TEST_ACCOUNT_MANIFEST } from '../src/auth/test-accounts';

const marker = 'local_preview_fixture_v1';
const { assertPreviewEnvironment } = require('./preview-guard.cjs');

async function main() {
  assertPreviewEnvironment(process.env);
  const prisma = new PrismaClient();
  try {
    if (await prisma.systemConfig.findUnique({ where: { key: marker } })) {
      console.log('Preview fixtures already initialized; existing edits preserved.');
      return;
    }
    if (await prisma.user.count() || await prisma.department.count() || await prisma.talentCandidate.count()) {
      throw new Error('Preview seed refused: unowned existing business data');
    }
    const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
    await prisma.$transaction(async (tx) => {
      const hrDept = await tx.department.create({ data: { name: '预览人事部', fullPath: '预览人事部', company: 'fuede' } });
      const teamDept = await tx.department.create({ data: { name: '预览业务部', fullPath: '预览业务部', company: 'fuede' } });
      const position = await tx.position.create({ data: { code: 'PREVIEW_STAFF', name: '预览岗位', jobFamily: '预览职族' } });
      const users = new Map<string, string>();
      const from = new Date('2026-01-01T00:00:00+08:00');
      for (const account of TEST_ACCOUNT_MANIFEST) {
        const deptId = ['ADMIN', 'HR001'].includes(account.employeeNo) ? hrDept.id : teamDept.id;
        const user = await tx.user.create({ data: {
          employeeNo: account.employeeNo, name: account.name, sysRole: account.sysRole,
          passwordHash, accountType: account.employeeNo === 'ADMIN' ? 'service' : 'employee',
          status: 'active', deptId, positionId: position.id, position: position.name, entryDate: from,
        } });
        users.set(account.employeeNo, user.id);
        if (account.employeeNo !== 'ADMIN') await tx.employmentRecord.create({ data: {
          userId: user.id, effectiveFrom: from, entryDate: from, company: 'fuede', deptId,
          positionId: position.id, position: position.name, employeeNo: account.employeeNo,
          employeeStatus: 'active', changeType: 'onboarding', sourceType: 'preview_fixture',
        } });
      }
      const managerId = users.get('MGR001')!;
      for (const employeeNo of ['EMP001', 'EMP002', 'EMP003', 'EMP004']) {
        const id = users.get(employeeNo)!;
        await tx.user.update({ where: { id }, data: { directManagerId: managerId } });
        await tx.employmentRecord.updateMany({ where: { userId: id }, data: { directManagerId: managerId } });
      }
      await tx.department.update({ where: { id: hrDept.id }, data: { leaderId: users.get('HR001') } });
      await tx.department.update({ where: { id: teamDept.id }, data: { leaderId: managerId, approverId: users.get('VP001') } });
      await tx.contractSubject.create({ data: { name: '预览签约主体' } });
      await tx.talentCandidate.create({ data: {
        name: '虚构候选人甲', phone: '10000000001', sourceChannel: 'other',
        appliedPosition: '预览岗位', note: '仅限本地验收的虚构数据', createdById: users.get('HR001')!,
      } });
      await tx.systemConfig.create({ data: { key: marker, value: { fictional: true, initializedAt: new Date().toISOString() } } });
    }, { timeout: 30000 });
    console.log('Fictional preview fixtures initialized. No real employee data imported.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => { console.error('Preview fixture initialization refused or failed; no credentials are logged.'); process.exitCode = 1; });
