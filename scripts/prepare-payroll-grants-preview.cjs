'use strict';
const { execFileSync } = require('node:child_process');
async function prepare(scope) {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const { PrismaClient } = require('@prisma/client'), { randomUUID } = require('node:crypto');
  const db = new PrismaClient({ log: [], errorFormat: 'minimal' });
  try {
    const [identity] = await db.$queryRaw`SELECT current_database() AS db, current_user AS role`;
    if (identity.db !== 'hrm_preview' || identity.role !== 'hrm_preview' || process.env.PAYROLL_FORMAL_ENABLED === 'true') throw new Error('preview_guard');
    const marker = await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } });
    const employee = await db.user.findFirst({ where: { employeeNo: 'EMP001', status: { in: ['active', 'probation'] }, archivedAt: null, deletedAt: null, isAssessorOnly: false }, select: { id: true, name: true, employeeNo: true, dingtalkId: true, dingtalkUnionId: true } });
    if (marker?.value?.fictional !== true || !employee || employee.dingtalkId || employee.dingtalkUnionId) throw new Error('fictional_guard');
    const suffix = randomUUID().slice(0, 8), name = `虚构授权验收-${scope}-${suffix}`;
    const subject = await db.contractSubject.create({ data: { name, isActive: true } });
    await db.systemConfig.create({ data: { key: `payroll_grants_preview_${subject.id}`, value: { fictional: true, subjectId: subject.id, scope, state: 'ready' } } });
    return { subjectId: subject.id, subjectName: name, userId: employee.id, userName: employee.name, employeeNo: employee.employeeNo };
  } finally { await db.$disconnect(); }
}
if (require.main === module) {
  const scope = process.argv[2];
  if (!['desktop', 'mobile'].includes(scope)) throw new Error('scope_guard');
  try {
    const container = process.env.PAYROLL_VERIFY_CONTAINER ?? 'hrm-api-1';
    if (!['hrm-api-1', 'hrm-payroll-verify-payrollverifyapi-1'].includes(container)) throw new Error('container_guard');
    const script = `(${prepare.toString()})(${JSON.stringify(scope)}).then(value=>console.log(JSON.stringify(value))).catch(()=>{console.error('grant_preview_preparation_failed');process.exitCode=1;});`;
    process.stdout.write(execFileSync('docker', ['exec', '-i', '-w', '/app', container, 'node'], { input: script, encoding: 'utf8', timeout: 30000 }));
  } catch { console.error('grant_preview_preparation_failed'); process.exitCode = 1; }
}
