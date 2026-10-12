import { IndicatorProgressHealth } from '@prisma/client';
import { BotGoalCandidate } from '../objectives/bot-goal-access.types';

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
