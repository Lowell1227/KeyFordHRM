/**
 * 串联演示数据（容器内运行）：基于已导入的 10 张高管模板，创建一个
 * 「2026年度绩效考核」周期，并把 10 个真实任务铺在流程各阶段，
 * 自评→主管评分→HR校准→审批→公示 全链路都有数据。
 *
 * 幂等：重跑会先清掉同名周期及其任务/快照/档案/流程记录。
 * 运行：docker exec hrm-api-1 npx ts-node prisma/seed-hrz-cycle.ts
 */
import {
  PrismaClient, Prisma, CycleStatus, TaskStatus, PerfGrade,
  IndicatorType, FlowNodeType, FlowAction,
} from '@prisma/client';

const prisma = new PrismaClient();
const CYCLE_NAME = '2026年度绩效考核';
const D = (n: number) => new Prisma.Decimal(n);

// 阶段 + 目标等级编排（10 位高管）
type Stage = 'self_eval' | 'manager_scoring' | 'hr_calibration' | 'approval' | 'published';
const PLAN: Record<string, { stage: Stage; grade?: PerfGrade }> = {
  吴之涵: { stage: 'self_eval' },
  余鹏程: { stage: 'manager_scoring' },
  胡菁懿: { stage: 'hr_calibration', grade: 'A' },
  易竑甫: { stage: 'hr_calibration', grade: 'B' },
  莫天飞: { stage: 'hr_calibration', grade: 'B' },
  郭志浩: { stage: 'hr_calibration', grade: 'C' },
  贾东: { stage: 'approval', grade: 'B' },
  王星: { stage: 'approval', grade: 'C' },
  苏萌: { stage: 'published', grade: 'A' },
  钟升君: { stage: 'published', grade: 'B' },
};
const BAND: Record<PerfGrade, number> = { A: 92, B: 83, C: 70, D: 55 };
const gradeOf = (score: number): PerfGrade =>
  score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';

// 阶段排序，用于判断某阶段是否「已走过」
const ORDER: Stage[] = ['self_eval', 'manager_scoring', 'hr_calibration', 'approval', 'published'];
const reached = (cur: Stage, q: Stage) => ORDER.indexOf(cur) >= ORDER.indexOf(q);

const indType = (dimType: string): IndicatorType =>
  dimType === 'penalty' ? 'penalty' : dimType === 'bonus' ? 'bonus' : dimType === 'attitude' ? 'attitude' : 'kpi';

async function main() {
  // —— 0) 清理旧周期（幂等）——
  const old = await prisma.assessmentCycle.findFirst({ where: { name: CYCLE_NAME }, select: { id: true } });
  if (old) {
    await prisma.performanceArchive.deleteMany({ where: { cycleId: old.id } });
    await prisma.flowRecord.deleteMany({ where: { cycleId: old.id } });
    await prisma.assessmentTask.deleteMany({ where: { cycleId: old.id } }); // 级联清实例/评分/等级
    await prisma.assessmentTemplateSnapshot.deleteMany({ where: { cycleId: old.id } });
    await prisma.assessmentCycle.delete({ where: { id: old.id } });
    console.log('已清理旧周期');
  }

  const hr = await prisma.user.findFirst({ where: { OR: [{ name: '姚瑶' }, { employeeNo: 'HR001' }] }, select: { id: true } });
  const lihong = await prisma.user.findFirst({ where: { name: '李宏' }, select: { id: true } });

  // —— 1) 建周期 ——
  const cycle = await prisma.assessmentCycle.create({
    data: {
      name: CYCLE_NAME,
      type: 'annual',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      deadlineIndicatorSetting: new Date('2026-01-31'),
      deadlineSelfEval: new Date('2026-06-25'),
      deadlineManagerScore: new Date('2026-06-30'),
      deadlineHrCalibration: new Date('2026-07-05'),
      deadlineApproval: new Date('2026-07-10'),
      deadlinePublish: new Date('2026-07-15'),
      status: CycleStatus.hr_calibration,
      createdBy: hr?.id ?? null,
      gradeAMaxRatio: D(0.2), gradeBMaxRatio: D(0.4), gradeCMaxRatio: D(0.3), gradeDMaxRatio: D(0.1),
    },
  });
  console.log('✓ 周期：', cycle.name);

  // 时间戳基准（Q2 末）
  const T = {
    indicator: new Date('2026-01-20'),
    self: new Date('2026-06-20'),
    manager: new Date('2026-06-28'),
    calib: new Date('2026-07-03'),
    approve: new Date('2026-07-08'),
    publish: new Date('2026-07-12'),
  };

  let done = 0;
  for (const [execName, plan] of Object.entries(PLAN)) {
    const exec = await prisma.user.findFirst({
      where: { name: execName, deletedAt: null },
      select: { id: true, deptId: true, directManagerId: true },
    });
    if (!exec) { console.log(`⚠ 跳过：找不到 ${execName}`); continue; }

    const template = await prisma.assessmentTemplate.findFirst({
      where: { name: `2026年度考核表-${execName}` },
      include: { dimensions: { include: { indicators: true }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!template) { console.log(`⚠ 跳过：找不到模板 ${execName}`); continue; }

    // 上级 / 审批人
    const managerId = exec.directManagerId;
    let approverId = lihong?.id ?? null;
    if (managerId) {
      const mgr = await prisma.user.findUnique({ where: { id: managerId }, select: { directManagerId: true } });
      approverId = mgr?.directManagerId ?? lihong?.id ?? managerId;
    }

    // 快照
    const snapshotData = {
      maxScore: template.maxScore,
      dimensions: template.dimensions.map((d) => ({
        id: d.id, name: d.name, type: d.type, weight: d.weight,
        indicators: d.indicators.map((i) => ({
          id: i.id, name: i.name, scoringStandard: i.scoringStandard,
          description: i.description, dataSource: i.dataSource,
          targetValue: i.targetValue, unit: i.unit, weight: i.weight,
          indicatorType: indType(d.type),
        })),
      })),
    };
    const snapshot = await prisma.assessmentTemplateSnapshot.create({
      data: { cycleId: cycle.id, templateId: template.id, snapshotData: snapshotData as any },
    });

    const stage = plan.stage;
    const status: TaskStatus = stage as TaskStatus;
    const band = plan.grade ? BAND[plan.grade] : 80;

    const task = await prisma.assessmentTask.create({
      data: {
        cycleId: cycle.id, snapshotId: snapshot.id, employeeId: exec.id, deptId: exec.deptId,
        managerId: managerId, deptHeadId: managerId, approverId,
        status,
        indicatorSetAt: T.indicator,
        indicatorConfirmedAt: T.indicator,
        selfEvalSubmittedAt: reached(stage, 'manager_scoring') ? T.self : null,
        managerScoredAt: reached(stage, 'hr_calibration') ? T.manager : null,
        hrCalibratedAt: reached(stage, 'approval') ? T.calib : null,
        approvedAt: reached(stage, 'published') ? T.approve : null,
        publishedAt: stage === 'published' ? T.publish : null,
      },
    });

    // 指标实例
    const hasSelf = reached(stage, 'manager_scoring'); // 自评已交
    const hasMgr = reached(stage, 'hr_calibration');   // 主管已评
    let so = 0;
    const instances: Prisma.IndicatorInstanceCreateManyInput[] = [];
    for (const d of snapshotData.dimensions) {
      const scoreThisDim = d.type === 'kpi' || d.type === 'attitude';
      for (const i of d.indicators) {
        const mScore = hasMgr && scoreThisDim ? band : null;
        const sScore = hasSelf && scoreThisDim ? Math.min(100, band + 4) : null;
        instances.push({
          taskId: task.id, templateIndicatorId: i.id, name: i.name,
          description: i.description ?? i.scoringStandard ?? null,
          scoringStandard: i.scoringStandard ?? null, dataSource: i.dataSource ?? null,
          targetValue: i.targetValue ?? null, unit: i.unit ?? null,
          weight: i.weight as any, indicatorType: i.indicatorType as IndicatorType,
          dimensionName: d.name, dimensionWeight: d.weight as any,
          selfScore: sScore != null ? D(sScore) : null,
          selfComment: hasSelf && scoreThisDim ? '自评：按目标推进，关键指标达成。' : null,
          managerScore: mScore != null ? D(mScore) : null,
          managerComment: hasMgr && scoreThisDim ? '主管评语：完成度良好，符合预期。' : null,
          finalScore: mScore != null ? D(mScore) : null,
          sortOrder: so++,
        });
      }
    }
    await prisma.indicatorInstance.createMany({ data: instances });

    // 自评 / 主管评 摘要
    if (hasSelf) {
      await prisma.selfEvalSummary.create({
        data: { taskId: task.id, achievements: '本年度核心业务目标基本达成，重点项目按里程碑推进。',
          improvements: '跨部门协同与团队梯队建设仍需加强。', nextGoals: '冲刺优秀档，扩大新渠道占比。',
          submittedAt: T.self },
      });
    }
    if (hasMgr) {
      await prisma.managerEvalSummary.create({
        data: { taskId: task.id, strengths: '业务结果扎实，目标拆解清晰。',
          improvements: '需进一步提升人才培养与流程沉淀。', developmentPlan: '下半年牵头一个标杆项目。',
          submittedAt: T.manager },
      });
    }

    // 等级结果（达到校准阶段才出原始等级）
    if (hasMgr) {
      const raw = gradeOf(band);
      const calibrated = reached(stage, 'approval') ? (plan.grade ?? raw) : null;
      const published = stage === 'published';
      await prisma.gradeResult.create({
        data: {
          taskId: task.id, calculatedScore: D(band), rawGrade: raw,
          calibratedGrade: calibrated, calibrationNote: calibrated ? 'HR 按分布校准确认。' : null,
          coefficient: D(1.0),
          hrCalibratorId: reached(stage, 'approval') ? hr?.id ?? null : null,
          hrCalibratedAt: reached(stage, 'approval') ? T.calib : null,
          approverId: reached(stage, 'published') ? approverId : null,
          approvedAt: reached(stage, 'published') ? T.approve : null,
          isPublished: published, publishedAt: published ? T.publish : null,
          employeeConfirmedAt: published ? T.publish : null,
        },
      });
    }

    // 流程记录（时间线）
    const flows: Prisma.FlowRecordCreateManyInput[] = [
      { taskId: task.id, cycleId: cycle.id, nodeType: FlowNodeType.indicator_confirm, actorId: exec.id, action: FlowAction.approve, comment: '指标确认', createdAt: T.indicator },
    ];
    if (hasSelf) flows.push({ taskId: task.id, cycleId: cycle.id, nodeType: FlowNodeType.self_eval, actorId: exec.id, action: FlowAction.submit, comment: '提交自评', createdAt: T.self });
    if (hasMgr) flows.push({ taskId: task.id, cycleId: cycle.id, nodeType: FlowNodeType.manager_score, actorId: managerId, action: FlowAction.submit, comment: '提交主管评分', createdAt: T.manager });
    if (reached(stage, 'approval')) flows.push({ taskId: task.id, cycleId: cycle.id, nodeType: FlowNodeType.hr_calibration, actorId: hr?.id ?? null, action: FlowAction.submit, comment: 'HR 校准', createdAt: T.calib });
    if (reached(stage, 'published')) flows.push({ taskId: task.id, cycleId: cycle.id, nodeType: FlowNodeType.approval, actorId: approverId, action: FlowAction.approve, comment: '审批通过', createdAt: T.approve });
    if (stage === 'published') flows.push({ taskId: task.id, cycleId: cycle.id, nodeType: FlowNodeType.publish, actorId: hr?.id ?? null, action: FlowAction.submit, comment: '结果公示', createdAt: T.publish });
    await prisma.flowRecord.createMany({ data: flows.filter((f) => f.actorId !== undefined) as any });

    // 档案（已公示）
    if (stage === 'published' && plan.grade) {
      const dept = exec.deptId ? await prisma.department.findUnique({ where: { id: exec.deptId }, select: { name: true } }) : null;
      await prisma.performanceArchive.create({
        data: {
          employeeId: exec.id, cycleId: cycle.id, employeeName: execName, deptName: dept?.name ?? null,
          grade: plan.grade, totalScore: D(band), coefficient: D(1.0),
          summary: { rawGrade: gradeOf(band), calibratedGrade: plan.grade } as any,
          archivedAt: T.publish,
        },
      });
    }

    done++;
    console.log(`✓ ${execName.padEnd(4)} [${stage}]${plan.grade ? ' 等级' + plan.grade : ''}`);
  }

  console.log(`\n▶ 完成：周期「${CYCLE_NAME}」+ ${done} 个任务全链路数据已就绪。`);
}

main()
  .catch((e) => { console.error('seed-hrz-cycle 失败：', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
