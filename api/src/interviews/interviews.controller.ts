import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { InterviewsService } from './interviews.service';
import { UpdateInterviewDto } from './dto/update-interview.dto';
import { InterviewQueryDto } from './dto/interview-query.dto';

/** 主管/HR 面谈管理接口。 */
@Controller('interviews')
export class InterviewsController {
  constructor(private readonly interviewsService: InterviewsService) {}

  /** GET /interviews — 主管面谈列表。 */
  @Get()
  findAll(@Query() dto: InterviewQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.interviewsService.findAll(dto, viewer);
  }

  /** GET /interviews/mine — 员工自己的面谈列表。 */
  @Get('mine')
  findMine(@Query() dto: InterviewQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.interviewsService.findMine(dto, viewer);
  }

  /** GET /interviews/:id — 面谈详情。 */
  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.interviewsService.findOne(id, viewer);
  }

  /** PUT /interviews/:id — 主管填写面谈记录。 */
  @Put(':id')
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateInterviewDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.interviewsService.update(id, dto, viewer);
  }

  /** POST /interviews/:id/manager-sign — 主管签字。 */
  @Post(':id/manager-sign')
  managerSign(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.interviewsService.managerSign(id, viewer);
  }

  /** POST /interviews/:id/employee-sign — 员工签字。 */
  @Post(':id/employee-sign')
  employeeSign(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.interviewsService.employeeSign(id, viewer);
  }
}

/** 任务级面谈查看接口。 */
@Controller('tasks/:id')
export class TaskInterviewController {
  constructor(private readonly interviewsService: InterviewsService) {}

  /** GET /tasks/:id/interview — 员工在任务详情查看面谈。 */
  @Get('interview')
  findByTaskId(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.interviewsService.findByTaskId(id, viewer);
  }
}
