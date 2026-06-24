/**
 * 高管考核表导入（容器内运行）。读取 scripts/hrz-templates.json，
 * 为每位高管创建一张 AssessmentTemplate（维度+指标），指派给本人。
 * 幂等：同名模板先删后建（级联清维度/指标）。
 *
 * 运行：docker exec hrm-api-1 npx ts-node prisma/seed-hrz-templates.ts
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface IndIn { name: string; weight: number; description: string | null; scoringStandard: string | null; dataSource: string | null }
interface DimIn { name: string; type: string; weight: number; indicators: IndIn[] }
interface TplIn { execName: string; dept: string; period: string; dimensions: DimIn[] }

// DB 约束：weight ∈ (0, 1]。扣分项维度权重为 0，夹到最小正值。
const W = (w: number) => new Prisma.Decimal(Math.min(1, Math.max(0.0001, w)));

async function main() {
  const file = path.join(__dirname, '../scripts/hrz-templates.json');
  const templates = JSON.parse(fs.readFileSync(file, 'utf8')) as TplIn[];
  console.log(`读取模板 ${templates.length} 张`);

  // 创建人：优先用导入的 HR（姚瑶），否则任意 system_admin/hr
  const creator = await prisma.user.findFirst({
    where: { OR: [{ name: '姚瑶' }, { sysRole: 'hr' }, { sysRole: 'system_admin' }] },
    orderBy: { sysRole: 'asc' },
    select: { id: true },
  });

  let ok = 0;
  for (const t of templates) {
    const name = `2026年度考核表-${t.execName}`;
    const exec = await prisma.user.findFirst({
      where: { name: t.execName, deletedAt: null },
      select: { id: true },
    });
    if (!exec) { console.log(`⚠ 找不到高管用户：${t.execName}，跳过`); continue; }

    // 幂等：删同名旧模板（级联删维度/指标）
    await prisma.assessmentTemplate.deleteMany({ where: { name } });

    await prisma.assessmentTemplate.create({
      data: {
        name,
        description: `考核周期：${t.period}；部门：${t.dept}`,
        applicableUsers: [exec.id],
        applicableDepts: [],
        maxScore: new Prisma.Decimal(100),
        isActive: true,
        createdBy: creator?.id ?? null,
        dimensions: {
          create: t.dimensions.map((d, di) => ({
            name: d.name,
            type: d.type as any,
            weight: W(d.weight),
            sortOrder: di,
            indicators: {
              create: d.indicators.map((i, ii) => ({
                name: i.name.slice(0, 200),
                description: i.description,
                scoringStandard: i.scoringStandard,
                dataSource: i.dataSource,
                weight: W(i.weight),
                sortOrder: ii,
              })),
            },
          })),
        },
      },
    });
    ok++;
    console.log(`✓ ${name}  指派→${t.execName}  维度${t.dimensions.length}/指标${t.dimensions.reduce((a, d) => a + d.indicators.length, 0)}`);
  }
  console.log(`\n▶ 完成，写入模板 ${ok}/${templates.length}`);
}

main()
  .catch((e) => { console.error('seed-hrz-templates 失败：', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
