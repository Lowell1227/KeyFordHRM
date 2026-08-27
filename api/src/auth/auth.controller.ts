import { Controller, Get, Post, Body, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth.types';
import { LocalLoginDto } from './dto/local-login.dto';
import { DingTalkLoginDto } from './dto/dingtalk-login.dto';
import { TestLoginDto } from './dto/test-login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

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

  @Post('change-password')
  @HttpCode(200)
  async changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() authUser: AuthUser) {
    return this.authService.changePassword(authUser.id, dto);
  }

  /** 钉钉免密登录（占位）。 */
  @Public()
  @Post('dingtalk')
  @HttpCode(200)
  async dingtalk(@Body() dto: DingTalkLoginDto) {
    return this.authService.dingtalkLogin(dto);
  }

  /** 登录页可展示的受控测试身份；开关关闭时返回空列表。 */
  @Public()
  @Get('test-accounts')
  async testAccounts() {
    return this.authService.getTestAccounts();
  }

  /** 仅在显式开关开启时允许固定测试账号免密登录。 */
  @Public()
  @Post('test-login')
  @HttpCode(200)
  async testLogin(@Body() dto: TestLoginDto) {
    return this.authService.testLogin(dto);
  }
}
