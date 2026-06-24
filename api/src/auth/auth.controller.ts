import { Controller, Get, Post, Body, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth.types';
import { LocalLoginDto } from './dto/local-login.dto';
import { DingTalkLoginDto } from './dto/dingtalk-login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** 工号+密码登录。 */
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LocalLoginDto) {
    return this.authService.localLogin(dto);
  }

  /** 当前登录用户信息。 */
  @Get('me')
  async me(@CurrentUser() authUser: AuthUser) {
    return this.authService.getMe(authUser.id);
  }

  /** 钉钉免密登录（占位）。 */
  @Public()
  @Post('dingtalk')
  @HttpCode(200)
  async dingtalk(@Body() dto: DingTalkLoginDto) {
    return this.authService.dingtalkLogin(dto);
  }
}
