import { IsUUID } from 'class-validator';

export class TrackingContextQueryDto {
  @IsUUID('4')
  ownerId!: string;
}
