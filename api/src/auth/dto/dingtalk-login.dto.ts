import { IsNotEmpty, IsString } from 'class-validator';

/** 钉钉免密登录请求。 */
export class DingTalkLoginDto {
  @IsString()
  @IsNotEmpty({ message: 'authCode 不能为空' })
  authCode!: string;
}
