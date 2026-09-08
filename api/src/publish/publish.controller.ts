import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { SysRole } from "@prisma/client";
import { Roles } from "@/common/decorators/roles.decorator";
import { CurrentUser } from "@/common/decorators/current-user.decorator";
import { AuthUser } from "@/common/types/auth.types";
import { PublishService } from "./publish.service";
import { PublishCycleDto } from "./dto/publish-cycle.dto";
import { PublicationRecordsQueryDto } from "./dto/publication-records-query.dto";
import { HrCapabilities } from "@/common/decorators/hr-capabilities.decorator";

@Controller("cycles/:id")
@Roles(SysRole.hr, SysRole.system_admin)
@HrCapabilities("performance_publish")
export class PublishController {
  constructor(private readonly publishService: PublishService) {}

  @Get("publication-records")
  records(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Query() dto: PublicationRecordsQueryDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.publishService.getPublicationRecords(id, dto, viewer);
  }

  @Get("publication-records/:taskId")
  recordDetail(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.publishService.getPublicationRecordDetail(id, taskId, viewer);
  }

  /** POST /cycles/:id/publish — 结果公示发布。 */
  @Post("publish")
  @HttpCode(200)
  publish(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() dto: PublishCycleDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.publishService.publishCycle(id, dto, viewer);
  }
}
