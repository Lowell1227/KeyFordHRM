/**
 * 开发环境「快速登录」账号种子。
 *
 * 特点：幂等、无副作用（只 upsert 这几个用户，不创建周期/任务等其它数据），
 * 且 update 分支会强制刷新 passwordHash + status，
 * 因此任何时候重跑都能把这些账号的密码恢复成确定值，解决密码漂移问题。
 *
 * 运行：从 api 目录执行 `npm run db:seed:dev`
 *      （容器内：docker exec hrm-api-1 npm run db:seed:dev）
 *
 * ⚠️ 仅供本地开发 / 演示。密码极弱，切勿用于生产。
 */
import { PrismaClient, SysRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/** 与登录页「快速登录」按钮一一对应。密码统一为 000000。 */
const DEV_USERS: Array<{
  employeeNo: string;
  name: string;
  sysRole: SysRole;
  canViewAll?: boolean;
}> = [
  { employeeNo: 'ADMIN', name: '系统管理员', sysRole: SysRole.system_admin, canViewAll: true },
  { employeeNo: 'HR001', name: '测试HR', sysRole: SysRole.hr, canViewAll: true },
  { employeeNo: 'MGR001', name: '测试主管', sysRole: SysRole.employee },
  { employeeNo: 'EMP001', name: '测试员工甲', sysRole: SysRole.employee },
  { employeeNo: 'VP001', name: '测试VP', sysRole: SysRole.employee },
];

const DEV_PASSWORD = '000000';

async function main() {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  for (const u of DEV_USERS) {
    const data = {
      name: u.name,
      passwordHash,
      sysRole: u.sysRole,
      canViewAll: u.canViewAll ?? false,
      status: 'active' as const,
      deletedAt: null,
    };
    await prisma.user.upsert({
      where: { employeeNo: u.employeeNo },
      update: data, // 关键：每次重跑都刷新密码与状态
      create: { employeeNo: u.employeeNo, ...data },
    });
    console.log(`  ✓ ${u.employeeNo.padEnd(7)} ${u.name.padEnd(8)} (${u.sysRole})`);
  }

  console.log(`\n▶ 已就绪 ${DEV_USERS.length} 个快速登录账号，密码统一为 ${DEV_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error('seed-dev-users 失败：', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
