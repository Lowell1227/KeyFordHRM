import type { Prisma } from "@prisma/client";
import type { DemoContext } from "./context";

export interface NarrativeRows {
  selfEvaluation: Prisma.SelfEvalSummaryCreateManyInput;
  managerEvaluation: Prisma.ManagerEvalSummaryCreateManyInput;
}

export function generateNarratives(
  context: DemoContext,
  taskId: string,
  indicators: Prisma.IndicatorInstanceCreateManyInput[],
  submittedAt: Date,
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
  const createdAt = new Date(submittedAt);

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
      submittedAt,
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
      submittedAt,
      createdAt,
      updatedAt: createdAt,
    },
  };
}
