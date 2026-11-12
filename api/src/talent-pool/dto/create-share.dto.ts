import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toNumber = ({ value }: { value: unknown }) => (value === undefined || value === null || value === '' ? value : Number(value));

export class CreateShareDto {
  /** 接收人（1–5 人），须为在职且角色为 dept_head / manager / hr / vp / system_admin。 */
  @IsArray()
  @ArrayMinSize(1, { message: '请选择至少 1 位接收人' })
  @ArrayMaxSize(5, { message: '一次最多分享给 5 人' })
  /** 接受任何版本的 UUID（种子/历史账号存在 v1–v5）。 */
  @IsUUID('all', { each: true, message: '接收人无效' })
  recipientIds!: string[];

  /** 有效期：7 或 30 天。 */
  @Transform(toNumber)
  @IsIn([7, 30], { message: '有效期仅支持 7 天或 30 天' })
  expiresInDays!: number;

  /** 是否附带简历原件（原件可能含手机号与邮箱，默认关闭）。 */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeResume?: boolean;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100, { message: '留言不能超过 100 字' })
  message?: string;
}
