export interface BotGoalCandidate {
  id: string;
  title: string;
  targetValue: string | null;
  unit: string | null;
  periodId: string | null;
  periodKey: string | null;
}

export type BotGoalAccess =
  | { kind: 'ready'; goals: BotGoalCandidate[] }
  | {
      kind:
        | 'no_cycle'
        | 'not_participant'
        | 'awaiting_goal_approval'
        | 'month_locked'
        | 'self_eval_submitted';
      message: string;
    };
