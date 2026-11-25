import { IsUUID } from 'class-validator';

export class TrackingContextQueryDto {
  @IsUUID('all')
  ownerId!: string;
}
