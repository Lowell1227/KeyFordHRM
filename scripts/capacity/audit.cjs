const { PrismaClient } = require('/app/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: [] });
async function main() {
  if (!/^CAP_[a-f0-9]{12}$/.test(process.env.CAPACITY_RUN_ID || '') || !process.env.DATABASE_URL?.includes('@pg:5432/hrm_capacity_')) throw new Error('audit-target-refused');
  const users = await prisma.user.count();
  const tasks = await prisma.assessmentTask.groupBy({ by: ['status'], _count: true });
  const flows = await prisma.flowRecord.groupBy({ by: ['action', 'nodeType'], _count: true });
  const duplicateTasks = await prisma.$queryRaw`SELECT count(*)::int AS count FROM (SELECT cycle_id,employee_id FROM assessment_tasks GROUP BY cycle_id,employee_id HAVING count(*)>1) d`;
  const activeVersions = await prisma.indicatorVersion.count({ where: { status: 'active' } });
  const employmentCount = await prisma.employmentRecord.count();
  console.log(JSON.stringify({ users, employmentCount, tasks, flows, activeVersions, duplicateTaskGroups: duplicateTasks[0].count }));
}
main().catch(() => { console.error('capacity-audit-failed'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
