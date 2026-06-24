/**
 * 全员铺满（容器内运行）：为「2026年度绩效考核」周期里尚无任务的全体在岗
 * 花名册员工，挂上一张通用考核模板的任务，按 Q2 末状态分布在各阶段、按配比给等级。
 * 不动已有的 10 个高管任务。
 *
 * 幂等：重跑先清掉「通用考核模板」产生的任务/快照，再重建。
 * 运行：docker exec hrm-api-1 npx ts-node prisma/seed-hrz-fillall.ts
 */
import {
  PrismaClient, Prisma, TaskStatus, PerfGrade,
  IndicatorType, FlowNodeType, FlowAction,
} from '@prisma/client';

const prisma = new PrismaClient();
const CYCLE_NAME = '2026年度绩效考核';
const TPL_NAME = '通用绩效考核模板';
const D = (n: number) => new Prisma.Decimal(n);

type Stage = 'self_eval' | 'manager_scoring' | 'hr_calibration' | 'approval' | 'published';
const ORDER: Stage[] = ['self_eval', 'manager_scoring', 'hr_calibration', 'approval', 'published'];
const reached = (cur: Stage, q: Stage) => ORDER.indexOf(cur) >= ORDER.indexOf(q);

// 阶段分布（每 20 人）：偏向已公示，少量在途
const STAGE_PATTERN: Stage[] = [
  ...Array(12).fill('published'),
  ...Array(3).fill('approval'),
  ...Array(3).fill('hr_calibration'),
  'manager_scoring', 'self_eval',
] as Stage[];
// 等级分布（每 10 个有等级的人）：A2 B4 C3 D1
const GRADE_PATTERN: PerfGrade[] = ['B', 'A', 'C', 'B', 'C', 'B', 'A', 'B', 'C', 'D'];
const BAND: Record<PerfGrade, number> = { A: 92, B: 83, C: 69, D: 55 };
const gradeOf = (s: number): PerfGrade => (s >= 90 ? 'A' : s >= 75 ? 'B' : s >= 60 ? 'C' : 'D');

async function main() {
  const cycle = await prisma.assessmentCycle.findFirst({ where: { name: CYCLE_NAME }, select: { id: true, createdBy: true } });
  if (!cycle) throw new Error(`找不到周期「${CYCLE_NAME}」，请先跑 seed-hrz-cycle.ts`);
  const hr = cycle.createdBy;
  const lihong = await prisma.user.findFirst({ where: { name: '李宏' }, select: { id: true } });

  // —— 幂等清理：删通用模板的旧快照及其任务 ——
  const oldTpl = await prisma.assessmentTemplate.findFirst({ where: { name: TPL_NAME }, select: { id: true } });
  if (oldTpl) {
    const snaps = await prisma.assessmentTemplateSnapshot.findMany({ where: { templateId: oldTpl.id, cycleId: cycle.id }, select: { id: true } });
    const snapIds = snaps.map((s) => s.id);
    if (snapIds.length) {
      const tasks = await prisma.assessmentTask.findMany({ where: { snapshotId: { in: snapIds } }, select: { id: true, employeeId: true } });
      const taskIds = tasks.map((t) => t.id);
      const empIds = tasks.map((t) => t.employeeId);
      await prisma.performanceArchive.deleteMany({ where: { cycleId: cycle.id, employeeId: { in: empIds } } });
      await prisma.flowRecord.deleteMany({ where: { taskId: { in: taskIds } } });
      await prisma.assessmentTask.deleteMany({ where: { id: { in: taskIds } } });
      await prisma.assessmentTemplateSnapshot.deleteMany({ where: { id: { in: snapIds } } });
    }
    console.log('已清理通用模板旧任务');
  }

  // —— 通用模板（幂等 upsert by name）——
  let tpl = await prisma.assessmentTemplate.findFirst({
    where: { name: TPL_NAME }, include: { dimensions: { include: { indicators: true }, orderBy: { sortOrder: 'asc' } } },
  });
  if (!tpl) {
    await prisma.assessmentTemplate.create({
      data: {
        name: TPL_NAME, description: '通用岗位年度考核模板（演示用）',
        applicableDepts: [], applicableUsers: [], maxScore: D(100), isActive: true, createdBy: hr,
        dimensions: {
          create: [
            { name: '业绩', type: 'kpi', weight: D(0.7), sortOrder: 0, indicators: { create: [
              { name: '工作目标完成', scoringStandard: '按既定目标完成度评分', weight: D(0.6), sortOrder: 0 },
              { name: '工作质量', scoringStandard: '交付质量、准确性与时效', weight: D(0.4), sortOrder: 1 },
            ] } },
            { name: '工作态度', type: 'attitude', weight: D(0.3), sortOrder: 1, indicators: { create: [
              { name: '责任心与协作', scoringStandard: '责任心、主动性与团队协作', weight: D(1.0), sortOrder: 0 },
            ] } },
          ],
        },
      },
    });
    tpl = await prisma.assessmentTemplate.findFirst({ where: { name: TPL_NAME }, include: { dimensions: { include: { indicators: true }, orderBy: { sortOrder: 'asc' } } } });
  }
  if (!tpl) throw new Error('通用模板创建失败');

  // —— 该周期下通用模板的快照（一份，所有通用任务共用）——
  const snapshotData = {
    maxScore: tpl.maxScore,
    dimensions: tpl.dimensions.map((d) => ({
      id: d.id, name: d.name, type: d.type, weight: d.weight,
      indicators: d.indicators.map((i) => ({
        id: i.id, name: i.name, scoringStandard: i.scoringStandard, weight: i.weight,
        indicatorType: (d.type === 'attitude' ? 'attitude' : 'kpi') as IndicatorType,
      })),
    })),
  };
  const snapshot = await prisma.assessmentTemplateSnapshot.create({
    data: { cycleId: cycle.id, templateId: tpl.id, snapshotData: snapshotData as any },
  });

  // —— 候选员工：花名册数字工号、在岗、有直属上级、且本周期尚无任务 ——
  const existing = await prisma.assessmentTask.findMany({ where: { cycleId: cycle.id }, select: { employeeId: true } });
  const taken = new Set(existing.map((e) => e.employeeId));
  const candidates = await prisma.user.findMany({
    where: { deletedAt: null, status: { not: 'resigned' }, directManagerId: { not: null }, employeeNo: { not: null } },
    select: { id: true, name: true, employeeNo: true, deptId: true, directManagerId: true },
    orderBy: { employeeNo: 'asc' },
  });
  const targets = candidates.filter((u) => /^[0-9]+$/.test(u.employeeNo ?? '') && !taken.has(u.id));
  console.log(`候选铺满员工：${targets.length}`);

  const T = {
    indicator: new Date('2026-01-20'), self: new Date('2026-06-20'), manager: new Date('2026-06-28'),
    calib: new Date('2026-07-03'), approve: new Date('2026-07-08'), publish: new Date('2026-07-12'),
  };

  // 预取上级的上级（审批人）
  const mgrCache = new Map<string, string | null>();
  async function approverOf(managerId: string | null): Promise<string | null> {
    if (!managerId) return lihong?.id ?? null;
    if (!mgrCache.has(managerId)) {
      const m = await prisma.user.findUnique({ where: { id: managerId }, select: { directManagerId: true } });
      mgrCache.set(managerId, m?.directManagerId ?? null);
    }
    return mgrCache.get(managerId) ?? lihong?.id ?? managerId;
  }

  let gi = 0; // 等级计数器
  let done = 0;
  const tally: Record<string, number> = {};
  for (let i = 0; i < targets.length; i++) {
    const u = targets[i];
    const stage = STAGE_PATTERN[i % STAGE_PATTERN.length];
    const graded = reached(stage, 'hr_calibration');
    const grade = graded ? GRADE_PATTERN[gi++ % GRADE_PATTERN.length] : undefined;
    const band = grade ? Math.max(45, Math.min(99, BAND[grade] + ((i % 5) - 2))) : 80;
    tally[stage] = (tally[stage] ?? 0) + 1;

    const approverId = await approverOf(u.directManagerId);
    const task = await prisma.assessmentTask.create({
      data: {
        cycleId: cycle.id, snapshotId: snapshot.id, employeeId: u.id, deptId: u.deptId,
        managerId: u.directManagerId, deptHeadId: u.directManagerId, approverId, status: stage as TaskStatus,
        indicatorSetAt: T.indicator, indicatorConfirmedAt: T.indicator,
        selfEvalSubmittedAt: reached(stage, 'manager_scoring') ? T.self : null,
        managerScoredAt: reached(stage, 'hr_calibration') ? T.manager : null,
        hrCalibratedAt: reached(stage, 'approval') ? T.calib : null,
        approvedAt: reached(stage, 'published') ? T.approve : null,
        publishedAt: stage === 'published' ? T.publish : null,
      },
    });

    const hasSelf = reached(stage, 'manager_scoring');
    const hasMgr = reached(stage, 'hr_calibration');
    let so = 0;
    const instances: Prisma.IndicatorInstanceCreateManyInput[] = [];
    for (const d of snapshotData.dimensions) {
      for (const ind of d.indicators) {
        const m = hasMgr ? band : null;
        const s = hasSelf ? Math.min(100, band + 3) : null;
        instances.push({
          taskId: task.id, templateIndicatorId: ind.id, name: ind.name, scoringStandard: ind.scoringStandard,
          weight: ind.weight as any, indicatorType: ind.indicatorType, dimensionName: d.name, dimensionWeight: d.weight as any,
          selfScore: s != null ? D(s) : null, selfComment: hasSelf ? '自评：本职工作按计划完成。' : null,
          managerScore: m != null ? D(m) : null, managerComment: hasMgr ? '主管评语：表现稳定，符合岗位要求。' : null,
          finalScore: m != null ? D(m) : null, sortOrder: so++,
        });
      }
    }
    await prisma.indicatorInstance.createMany({ data: instances });

    if (hasSelf) await prisma.selfEvalSummary.create({ data: { taskId: task.id, achievements: '完成本职岗位目标，配合团队推进重点工作。', improvements: '专业深度与效率可进一步提升。', submittedAt: T.self } });
    if (hasMgr) await prisma.managerEvalSummary.create({ data: { taskId: task.id, strengths: '工作踏实，执行到位。', improvements: '主动性与跨岗协作可加强。', submittedAt: T.manager } });

    if (hasMgr && grade) {
      const raw = gradeOf(band);
      const calibrated = reached(stage, 'approval') ? grade : null;
      const published = stage === 'published';
      await prisma.gradeResult.create({
        data: {
          taskId: task.id, calculatedScore: D(band), rawGrade: raw, calibratedGrade: calibrated,
          calibrationNote: calibrated ? 'HR 按分布校准。' : null, coefficient: D(1.0),
          hrCalibratorId: reached(stage, 'approval') ? hr : null, hrCalibratedAt: reached(stage, 'approval') ? T.calib : null,
          approverId: reached(stage, 'published') ? approverId : null, approvedAt: reached(stage, 'published') ? T.approve : null,
          isPublished: published, publishedAt: published ? T.publish : null, employeeConfirmedAt: published ? T.publish : null,
        },
      });
      if (published) {
        const dept = u.deptId ? await prisma.department.findUnique({ where: { id: u.deptId }, select: { name: true } }) : null;
        await prisma.performanceArchive.create({
          data: { employeeId: u.id, cycleId: cycle.id, employeeName: u.name, deptName: dept?.name ?? null, grade, totalScore: D(band), coefficient: D(1.0), summary: { rawGrade: raw, calibratedGrade: grade } as any, archivedAt: T.publish },
        });
      }
    }

    // 关键流程记录（精简）
    const flows: Prisma.FlowRecordCreateManyInput[] = [];
    if (hasSelf) flows.push({ taskId: task.id, cycleId: cycle.id, nodeType: FlowNodeType.self_eval, actorId: u.id, action: FlowAction.submit, comment: '提交自评', createdAt: T.self });
    if (hasMgr) flows.push({ taskId: task.id, cycleId: cycle.id, nodeType: FlowNodeType.manager_score, actorId: u.directManagerId, action: FlowAction.submit, comment: '主管评分', createdAt: T.manager });
    if (reached(stage, 'published')) flows.push({ taskId: task.id, cycleId: cycle.id, nodeType: FlowNodeType.publish, actorId: hr, action: FlowAction.submit, comment: '公示', createdAt: T.publish });
    if (flows.length) await prisma.flowRecord.createMany({ data: flows });

    done++;
  }

  console.log(`\n▶ 完成：新增 ${done} 个全员任务。阶段分布 = ${JSON.stringify(tally)}`);
}

main()
  .catch((e) => { console.error('seed-hrz-fillall 失败：', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
