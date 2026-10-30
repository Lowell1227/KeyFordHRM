import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import {
  CreatePersonnelReferenceDataDto,
  PersonnelReferenceDataKind,
  PersonnelReferenceDataQueryDto,
  UpdatePersonnelReferenceDataDto,
} from './personnel-reference-data.dto';
import { PersonnelReferenceDataGuard } from './personnel-reference-data.guard';
import { PersonnelReferenceDataService } from './personnel-reference-data.service';

@Controller('personnel-reference-data')
@Roles(SysRole.hr, SysRole.system_admin)
@UseGuards(PersonnelReferenceDataGuard)
export class PersonnelReferenceDataController {
  constructor(private readonly referenceData: PersonnelReferenceDataService) {}

  @Get(':kind')
  @HrCapabilities(
    'employee_archive_edit',
    'employee_archive_review',
    'organization_edit',
  )
  findAll(
    @Param('kind', new ParseEnumPipe(PersonnelReferenceDataKind))
    kind: PersonnelReferenceDataKind,
    @Query() query: PersonnelReferenceDataQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.referenceData.findAll(kind, query, user);
  }

  @Post(':kind')
  @HrCapabilities('employee_archive_edit')
  create(
    @Param('kind', new ParseEnumPipe(PersonnelReferenceDataKind))
    kind: PersonnelReferenceDataKind,
    @Body() input: CreatePersonnelReferenceDataDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.referenceData.create(kind, input, user);
  }

  @Patch(':kind/:id')
  @HrCapabilities('employee_archive_edit')
  update(
    @Param('kind', new ParseEnumPipe(PersonnelReferenceDataKind))
    kind: PersonnelReferenceDataKind,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdatePersonnelReferenceDataDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.referenceData.update(kind, id, input, user);
  }
}
