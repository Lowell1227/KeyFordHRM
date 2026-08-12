import type { Prisma } from "@prisma/client";
import type { DemoContext } from "./context";

export interface NarrativeRows {
  selfEvaluation: Prisma.SelfEvalSummaryCreateManyInput;
  managerEvaluation: Prisma.ManagerEvalSummaryCreateManyInput;
}

interface WorkflowNarrativeSource {
  name: string;
  finalScore?: unknown;
}

function weakestIndicator(
  indicators: WorkflowNarrativeSource[],
): WorkflowNarrativeSource {
  if (indicators.length === 0)
    throw new Error("workflow narrative requires at least one indicator");
  return [...indicators].sort(
    (left, right) => Number(left.finalScore) - Number(right.finalScore),
  )[0];
}

export function generateInterviewNarrative(
  indicators: WorkflowNarrativeSource[],
): Pick<
  Prisma.PerformanceInterviewCreateManyInput,
  | "achievements"
  | "weaknesses"
  | "nextGoals"
  | "remediation"
  | "supportNeeded"
  | "otherMatters"
> {
  const weakest = weakestIndicator(indicators);
  return {
    achievements: "已完成周期重点工作，并形成可复核的交付证据。",
    weaknesses: `${weakest.name}是本周期相对薄弱项，需要加强过程控制。`,
    nextGoals: `下一周期优先提升${weakest.name}，按月检查阶段成果。`,
    remediation: `围绕${weakest.name}设置双周里程碑，由主管跟踪偏差并及时纠正。`,
    supportNeeded: "需要主管协调跨团队资源，并提供双周反馈。",
    otherMatters: "员工已了解最终成绩、评价依据及申诉渠道。",
  };
}

export function generateImprovementNarrative(
  indicators: WorkflowNarrativeSource[],
  targetDate: Date,
): Pick<
  Prisma.ImprovementPlanCreateManyInput,
  "improvementNeed" | "importance" | "improvementGoal" | "measures"
> {
  const weakest = weakestIndicator(indicators);
  const measureDeadline = (daysBeforeTarget: number): string => {
    const value = new Date(targetDate);
    value.setUTCDate(value.getUTCDate() - daysBeforeTarget);
    return value.toISOString().slice(0, 10);
  };
  return {
    improvementNeed: `${weakest.name}得分偏低，需提升计划拆解、执行跟踪和结果复盘。`,
    importance:
      "该项直接影响岗位核心交付和团队协作质量，需在本改进周期内闭环。",
    improvementGoal: `${weakest.name}相关成果达到岗位合格标准，并连续两次通过主管复核。`,
    measures: [
      {
        description: `拆解${weakest.name}月度目标并确认验收口径`,
        responsible: "员工本人",
        deadline: measureDeadline(42),
      },
      {
        description: "提交阶段进展证据并对偏差进行复盘",
        responsible: "员工本人",
        deadline: measureDeadline(21),
      },
      {
        description: "完成最终复核并形成书面反馈",
        responsible: "直属主管",
        deadline: measureDeadline(0),
      },
    ],
  };
}

export function generateNarratives(
  context: DemoContext,
  taskId: string,
  indicators: Prisma.IndicatorInstanceCreateManyInput[],
  selfSubmittedAt: Date,
  managerSubmittedAt: Date,
): NarrativeRows {
  if (indicators.length === 0)
    throw new Error(
      `task ${taskId} cannot generate narratives without indicators`,
    );
  const ordered = [...indicators].sort(
    (left, right) => Number(left.finalScore) - Number(right.finalScore),
  );
  const lowest = ordered[0];
  const highest = ordered[ordered.length - 1];
  const createdAt = new Date(selfSubmittedAt);

  return {
    selfEvaluation: {
      id: context.own("self-eval", context.id("self-eval", taskId)),
      taskId,
      achievements: `本周期已交付${highest.name}相关成果，结果达到既定口径并形成可复用经验。`,
      improvements: `${lowest.name}仍是本周期主要改善项，需要加强过程检查和结果复盘。`,
      suggestions: "建议保留月度复盘机制，及时校正目标与资源投入。",
      nextGoals: `下一周期优先提升${lowest.name}，同时巩固${highest.name}的稳定产出。`,
      supportNeeded: `需要直属主管协调跨团队资源，并对${lowest.name}提供双周反馈。`,
      attachments: [],
      submittedAt: selfSubmittedAt,
      createdAt,
      updatedAt: createdAt,
    },
    managerEvaluation: {
      id: context.own("manager-eval", context.id("manager-eval", taskId)),
      taskId,
      strengths: `${highest.name}表现突出，交付结果清晰且能够支持团队目标。`,
      improvements: `${lowest.name}得分相对较低，需要提升计划拆解与过程纠偏。`,
      developmentPlan: `围绕${lowest.name}制定月度里程碑，由主管每两周检查一次证据和进展。`,
      attachments: [],
      submittedAt: managerSubmittedAt,
      createdAt,
      updatedAt: managerSubmittedAt,
    },
  };
}
