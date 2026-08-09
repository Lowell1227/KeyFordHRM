import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';

export class NotificationQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['pending', 'sent', 'failed'])
  status?: 'pending' | 'sent' | 'failed';

  @IsOptional()
  @Transform(({ value, obj }) => {
    const raw = (obj as Record<string, unknown> | undefined)?.unreadOnly ?? value;
    if (raw === true || raw === 'true') return true;
    if (raw === false || raw === 'false') return false;
    return raw;
  })
  @IsBoolean()
  unreadOnly?: boolean;
}
