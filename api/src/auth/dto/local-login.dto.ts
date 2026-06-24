import { IsNotEmpty, IsString } from 'class-validator';

/** 工号+密码登录请求。 */
export class LocalLoginDto {
  @IsString()
  @IsNotEmpty({ message: '工号不能为空' })
  employeeNo!: string;

  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  password!: string;
}
