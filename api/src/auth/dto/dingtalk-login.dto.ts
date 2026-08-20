import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import type { DingtalkLoginMode } from '../../dingtalk/dingtalk.service';

/** 钉钉免密登录请求。 */
export class DingTalkLoginDto {
  @IsString()
  @IsNotEmpty({ message: 'authCode 不能为空' })
  authCode!: string;

  @IsIn(['oauth', 'internal'], { message: 'loginMode 必须为 oauth 或 internal' })
  loginMode!: DingtalkLoginMode;
}
