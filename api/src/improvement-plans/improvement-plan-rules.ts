import { BadRequestException } from '@nestjs/common';

export interface ImprovementGoal {
  id: string;
  name: string;
  description: string;
  weight: number;
}

export interface GoalEvaluation {
  goalId: string;
  score: number;
  comment: string;
}

export interface ImprovementEvaluation {
  items: GoalEvaluation[];
  overallComment: string;
  weightedScore: number;
}

export function validateGoals(input: ImprovementGoal[]): ImprovementGoal[] {
  if (!Array.isArray(input) || input.length === 0) throw new BadRequestException('至少填写一项目标');
  const ids = new Set<string>();
  const goals = input.map((goal) => {
    const id = goal.id?.trim();
    const name = goal.name?.trim();
    const description = goal.description?.trim();
    if (!id || !name || !description || ids.has(id)) throw new BadRequestException('目标名称、描述和唯一标识不能为空');
    if (!Number.isFinite(goal.weight) || goal.weight <= 0 || goal.weight > 100) throw new BadRequestException('目标权重必须大于 0 且不超过 100%');
    ids.add(id);
    return { id, name, description, weight: goal.weight };
  });
  if (Math.abs(goals.reduce((sum, goal) => sum + goal.weight, 0) - 100) > 0.001) {
    throw new BadRequestException('目标权重合计必须为 100%');
  }
  return goals;
}

export function calculateWeightedScore(goals: ImprovementGoal[], items: GoalEvaluation[]): number {
  const scores = new Map(items.map((item) => [item.goalId, item.score]));
  return Math.round(goals.reduce((sum, goal) => sum + goal.weight * (scores.get(goal.id) ?? 0), 0)) / 100;
}

export function validateEvaluation(
  goals: ImprovementGoal[],
  input: Pick<ImprovementEvaluation, 'items' | 'overallComment'>,
): ImprovementEvaluation {
  if (!Array.isArray(input.items) || input.items.length !== goals.length) throw new BadRequestException('请逐项目标填写评分和评价内容');
  const byGoal = new Map<string, GoalEvaluation>();
  for (const item of input.items) {
    if (byGoal.has(item.goalId)) throw new BadRequestException('目标评分不能重复');
    if (!Number.isFinite(item.score) || item.score < 0 || item.score > 100) throw new BadRequestException('目标评分必须在 0 至 100 之间');
    const comment = item.comment?.trim();
    if (!comment) throw new BadRequestException('每项目标都要填写评价内容');
    byGoal.set(item.goalId, { goalId: item.goalId, score: item.score, comment });
  }
  const items = goals.map((goal) => byGoal.get(goal.id));
  if (items.some((item) => !item)) throw new BadRequestException('评价的目标与已确认目标不一致');
  const overallComment = input.overallComment?.trim();
  if (!overallComment) throw new BadRequestException('请填写总体评价内容');
  return { items: items as GoalEvaluation[], overallComment, weightedScore: calculateWeightedScore(goals, items as GoalEvaluation[]) };
}
