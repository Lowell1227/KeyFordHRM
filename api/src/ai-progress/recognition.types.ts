import { IndicatorProgressHealth } from '@prisma/client';
import { BotGoalCandidate } from '../objectives/bot-goal-access.types';
import type { ObjectivesService } from '../objectives/objectives.service';

export interface ConfirmedDraftChanges {
  indicatorId?: string;
  periodId?: string | null;
  content?: string;
  actualValue?: string | null;
  healthStatus?: IndicatorProgressHealth | null;
}

export type SavedProgress = Awaited<ReturnType<ObjectivesService['updateIndicatorProgress']>>;

export type ProgressPreview = { kind: 'reply'; text: string } | {
  kind: 'draft';
  draftId: string;
  state: 'pending' | 'saved';
  expiresAt: string;
  goals: BotGoalCandidate[];
  indicatorId: string | null;
  periodId: string | null;
  content: string;
  actualValue: string | null;
  healthStatus: IndicatorProgressHealth | null;
  uncertain: boolean;
  canSave: boolean;
  targetValue: string | null;
  unit: string | null;
  completionPercent: number | null;
  progress: number | null;
  saved: SavedProgress | null;
};

export interface ProgressCandidate {
  indicatorId: string | null;
  content: string;
  actualValue: string | null;
  healthStatus: IndicatorProgressHealth | null;
  uncertain: boolean;
}

export interface RecognitionInput {
  message: string;
  goals: BotGoalCandidate[];
}

export interface ProviderRuntimeConfig {
  provider: 'kimi' | 'deepseek' | 'qwen';
  apiKey: string;
  modelId: string;
  region?: string;
  workspaceId?: string;
}
