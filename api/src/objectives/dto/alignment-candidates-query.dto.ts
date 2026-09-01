import { IsUUID } from 'class-validator';

export class AlignmentCandidatesQueryDto {
  @IsUUID('4')
  taskId!: string;
}
