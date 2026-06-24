import { ArrayNotEmpty, IsBoolean, IsOptional, IsUUID } from 'class-validator';

/** POST /cycles/:id/publish 公示请求体。 */
export class PublishCycleDto {
  @IsUUID('4', { each: true })
  @ArrayNotEmpty()
  taskIds!: string[];

  @IsOptional()
  @IsBoolean()
  sendDingtalkNotification?: boolean;
}
