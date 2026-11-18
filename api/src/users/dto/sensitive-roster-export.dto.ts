import { IsString, Length } from 'class-validator';
import { UserQueryDto } from './user-query.dto';

export class SensitiveRosterExportDto extends UserQueryDto {
  @IsString() @Length(1, 128, { message: '请输入当前账号密码' })
  accountPassword!: string;

  @IsString() @Length(4, 64, { message: 'Excel打开密码须为4至64位' })
  filePassword!: string;
}
