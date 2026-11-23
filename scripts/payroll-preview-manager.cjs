'use strict';

async function ensureFictionalPayrollManager(db, actors, submitters = ['HR001']) {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db,current_user AS role');
  if (identity.db !== 'hrm_preview' || identity.role !== 'hrm_preview' || process.env.PAYROLL_FORMAL_ENABLED === 'true') throw new Error('preview_manager_guard');
  const fixture = (await db.systemConfig.findUnique({ where: { key: 'payroll_preview_fixture_v1' } }))?.value;
  if (fixture?.fictional !== true || !fixture.subjectIds?.[0] || fixture.actors?.HR001 !== actors.HR001) throw new Error('preview_manager_fixture');
  for (const actor of submitters) {
    const users = await db.user.findMany({ where: { id: { in: [actors[actor], actors.MGR001] } },
      select: { id: true, name: true, directManagerId: true, dingtalkId: true, dingtalkUnionId: true } });
    const hr = users.find(row => row.id === actors[actor]);
    if (users.length !== 2 || users.some(row => !row.name.startsWith('测试') || row.dingtalkId || row.dingtalkUnionId)
      || hr.directManagerId && hr.directManagerId !== actors.MGR001) throw new Error('preview_manager_not_owned');
    if (!hr.directManagerId) await db.$transaction(async tx => {
      const result = await tx.user.updateMany({ where: { id: hr.id, directManagerId: null }, data: { directManagerId: actors.MGR001 } });
      if (result.count !== 1) throw new Error('preview_manager_conflict');
      await tx.payrollEvent.create({ data: { subjectId: fixture.subjectIds[0], actorId: actors.ADMIN, action: 'fictional_parameter_manager_prepared',
        metadata: { fictional: true, submitterId: hr.id, reviewerId: actors.MGR001 } } });
    });
  }
}
module.exports = { ensureFictionalPayrollManager };
