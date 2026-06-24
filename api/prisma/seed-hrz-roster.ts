/**
 * 真实花名册导入（容器内运行）。读取 scripts/hrz-roster.json，
 * 幂等写入 departments + users（含上下级链）。所有导入用户密码统一为 000000。
 *
 * 运行：docker exec hrm-api-1 npx ts-node prisma/seed-hrz-roster.ts
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const DEFAULT_PWD = '000000';

interface DeptIn { key: string; name: string; parentKey: string | null; company: string }
interface UserIn {
  employeeNo: string; name: string; position: string | null; jobLevel: string | null;
  company: string; deptKey: string | null; managerName: string | null;
  entryDate: string | null; workLocation: string | null; employmentType: string;
  status: string; plannedRegularDate: string | null; actualRegularDate: string | null;
  sysRole: string; canViewAll: boolean;
}

const d = (s: string | null) => (s ? new Date(s) : null);

async function main() {
  const file = path.join(__dirname, '../scripts/hrz-roster.json');
  const { departments, users } = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    departments: DeptIn[]; users: UserIn[];
  };
  console.log(`读取：${departments.length} 部门，${users.length} 用户`);

  // —— 1) 部门：按层级深度排序，父先子后；以 (name, parentId) 匹配做幂等 ——
  const deptId = new Map<string, string>(); // key -> id
  const sorted = [...departments].sort(
    (a, b) => a.key.split(' / ').length - b.key.split(' / ').length,
  );
  for (const dep of sorted) {
    const parentId = dep.parentKey ? deptId.get(dep.parentKey) ?? null : null;
    const existing = await prisma.department.findFirst({
      where: { name: dep.name, parentId: parentId ?? null },
      select: { id: true },
    });
    let id: string;
    if (existing) {
      id = existing.id;
      await prisma.department.update({
        where: { id },
        data: { company: dep.company as any, isActive: true },
      });
    } else {
      const created = await prisma.department.create({
        data: {
          name: dep.name,
          parentId: parentId ?? undefined,
          company: dep.company as any,
          fullPath: dep.key,
        },
        select: { id: true },
      });
      id = created.id;
    }
    deptId.set(dep.key, id);
  }
  console.log(`✓ 部门就绪 ${deptId.size}`);

  // —— 2) 用户：第一遍 upsert（不含上级），记录 name -> id ——
  const passwordHash = await bcrypt.hash(DEFAULT_PWD, 10);
  const userIdByName = new Map<string, string>();
  const userIdByNo = new Map<string, string>();
  for (const u of users) {
    const base = {
      name: u.name,
      position: u.position ?? undefined,
      deptId: u.deptKey ? deptId.get(u.deptKey) ?? null : null,
      entryDate: d(u.entryDate),
      plannedRegularDate: d(u.plannedRegularDate),
      actualRegularDate: d(u.actualRegularDate),
      employmentType: u.employmentType as any,
      status: u.status as any,
      sysRole: u.sysRole as any,
      canViewAll: u.canViewAll,
      passwordHash,
      deletedAt: null,
    } satisfies Prisma.UserUncheckedUpdateInput;

    const rec = await prisma.user.upsert({
      where: { employeeNo: u.employeeNo },
      update: base,
      create: { employeeNo: u.employeeNo, ...base } as Prisma.UserUncheckedCreateInput,
      select: { id: true },
    });
    userIdByName.set(u.name, rec.id);
    userIdByNo.set(u.employeeNo, rec.id);
  }
  console.log(`✓ 用户就绪 ${userIdByNo.size}`);

  // —— 3) 第二遍：连直属上级 ——
  let linked = 0;
  for (const u of users) {
    if (!u.managerName) continue;
    const mgrId = userIdByName.get(u.managerName);
    const selfId = userIdByNo.get(u.employeeNo);
    if (mgrId && selfId && mgrId !== selfId) {
      await prisma.user.update({ where: { id: selfId }, data: { directManagerId: mgrId } });
      linked++;
    }
  }
  console.log(`✓ 直属上级已连 ${linked}`);

  // —— 4) 部门负责人：把部门内最高角色者设为 leader（粗略，便于演示）——
  const rolePri: Record<string, number> = {
    chairman: 6, vp: 5, dept_head: 4, hr: 3, manager: 2, employee: 1, system_admin: 0,
  };
  for (const [key, id] of deptId) {
    const members = await prisma.user.findMany({
      where: { deptId: id, deletedAt: null },
      select: { id: true, sysRole: true },
    });
    if (!members.length) continue;
    const top = members.sort((a, b) => (rolePri[b.sysRole] ?? 0) - (rolePri[a.sysRole] ?? 0))[0];
    await prisma.department.update({ where: { id }, data: { leaderId: top.id } });
  }
  console.log(`✓ 部门负责人已粗设`);

  console.log(`\n▶ 完成。导入用户密码统一为 ${DEFAULT_PWD}，用工号登录。`);
}

main()
  .catch((e) => { console.error('seed-hrz-roster 失败：', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
