import { IsUUID } from 'class-validator';

export class MergeDepartmentDto {
  @IsUUID()
  targetDepartmentId!: string;
}
