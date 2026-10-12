import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export const AI_PROVIDERS = ['kimi', 'deepseek', 'qwen'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const AI_REGIONS = [
  'cn-beijing',
  'ap-southeast-1',
  'us-east-1',
  'eu-central-1',
  'ap-northeast-1',
  'cn-hongkong',
];

export class AiProviderParamsDto {
  @IsIn(AI_PROVIDERS)
  provider!: AiProvider;
}

export class SaveAiProviderDto {
  // Omission preserves the existing credential; null and blank are rejected.
  @Transform(({ obj }) => obj.apiKey)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(4096)
  @Matches(/^\S+$/)
  apiKey?: string;

  @IsString()
  @Transform(({ obj }) => obj.modelId)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/)
  modelId!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ obj }) => obj.region)
  @IsIn(AI_REGIONS)
  region?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(({ obj }) => obj.workspaceId)
  @Matches(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/)
  workspaceId?: string;
}

export class SetAiBotEnabledDto {
  // Preserve JSON booleans despite the application's global implicit conversion.
  @Transform(({ obj }) => obj.enabled)
  @IsBoolean()
  enabled!: boolean;
}

export class SetAiAllowlistDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  userIds!: string[];
}
