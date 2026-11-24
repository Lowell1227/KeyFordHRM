import { Controller, Get } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { PersonnelDigestService } from './personnel-digest.service';

@Controller('employee-archives/personnel-digest')
@Roles(SysRole.hr, SysRole.system_admin)
@HrCapabilities('employee_archive_edit', 'employee_archive_review')
export class PersonnelDigestController {
  constructor(private readonly digest: PersonnelDigestService) {}

  @Get()
  list(@CurrentUser() viewer: AuthUser) {
    return this.digest.list(viewer);
  }
}
