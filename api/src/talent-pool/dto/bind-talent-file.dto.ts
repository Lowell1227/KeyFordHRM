import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class BindTalentFileDto {
  /** MinIO 对象键，必须 talent-resume/ 前缀。 */
  @Transform(trim)
  @IsString() @IsNotEmpty()
  @MaxLength(500)
  objectKey!: string;

  @Transform(trim)
  @IsString() @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;

  @Transform(trim)
  @IsString() @IsNotEmpty()
  @MaxLength(100)
  mimeType!: string;

  /** 前端上报大小；服务端优先以对象存储实际元信息为准。 */
  @Transform(({ value }) => Number(value))
  @IsInt() @Min(1) @Max(10 * 1024 * 1024)
  fileSize!: number;
}
