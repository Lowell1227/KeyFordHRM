import { Controller, Get, Patch, Param, Query, Body, ParseUUIDPipe } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { UsersService } from './users.service';
import { UserQueryDto } from './dto/user-query.dto';
import { UpdateManagerDto } from './dto/update-manager.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** GET /users — 查询用户列表（HR / system_admin） */
  @Get()
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('employee_archive_edit', 'employee_archive_review', 'organization_edit', 'cycle_plan_edit', 'cycle_plan_review')
  findAll(@Query() dto: UserQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.usersService.findAll(dto, viewer);
  }

  /** GET /users/:id/subordinates — 某人的直接下属（本人 / HR / system_admin / canViewAll） */
  @Get(':id/subordinates')
  findSubordinates(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.usersService.findSubordinates(id, viewer);
  }

  /** GET /users/:id — 查询用户详情（本人 / 直接主管 / HR / system_admin） */
  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.usersService.findOne(id, viewer);
  }

  /** @deprecated 绩效直属上级变更统一走员工档案审核接口。 */
  @Patch(':id/manager')
  @Roles(SysRole.system_admin, SysRole.hr)
  updateManager(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateManagerDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.usersService.updateManager(id, dto, operator);
  }

  /** PATCH /users/:id/settings — 更新系统权限；关系字段只作旧客户端拦截。 */
  @Patch(':id/settings')
  @Roles(SysRole.system_admin, SysRole.hr)
  updateSettings(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateUserSettingsDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.usersService.updateSettings(id, dto, operator);
  }

  /** PATCH /users/:id/role — 更新系统权限（system_admin，旧路径保留兼容） */
  @Patch(':id/role')
  @Roles(SysRole.system_admin)
  updateRole(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.usersService.updateRole(id, dto);
  }

  /** PATCH /users/:id/password — 设置密码（system_admin / HR） */
  @Patch(':id/password')
  @Roles(SysRole.system_admin, SysRole.hr)
  setPassword(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SetPasswordDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.usersService.setPassword(id, dto, operator);
  }
}
