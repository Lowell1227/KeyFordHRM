import { IsOptional, IsString } from 'class-validator';

/** POST /tasks/:id/approval/reject 退回请求体。 */
export class ApprovalRejectDto {
  @IsOptional()
  @IsString()
  comment?: string;
}
