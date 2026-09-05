import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { FinalGradeService } from './final-grade.service';
import { SubmitFinalGradeDto } from './dto/submit-final-grade.dto';

/** 整周期结果评定接口。 */
@Controller('tasks/:id')
export class FinalGradeController {
  constructor(private readonly finalGradeService: FinalGradeService) {}

  /** GET /tasks/:id/final-grade — 评定页数据。 */
  @Get('final-grade')
  getFinalGrade(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.finalGradeService.getFinalGrade(id, viewer);
  }

  /** POST /tasks/:id/final-grade — 提交整周期最终等级。 */
  @Post('final-grade')
  @HttpCode(200)
  submitFinalGrade(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SubmitFinalGradeDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.finalGradeService.submitFinalGrade(id, dto, viewer);
  }
}
