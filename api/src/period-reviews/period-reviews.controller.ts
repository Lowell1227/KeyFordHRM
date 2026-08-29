import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { PeriodReviewsService } from './period-reviews.service';
import { SaveEmployeePeriodReviewDraftDto } from './dto/save-employee-period-review-draft.dto';
import { SubmitEmployeePeriodReviewDto } from './dto/submit-employee-period-review.dto';

@Controller('assessment-periods')
export class PeriodReviewsController {
  constructor(private readonly service: PeriodReviewsService) {}

  @Get(':id/review')
  getReview(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.service.getReview(id, viewer);
  }

  @Put(':id/employee-draft')
  saveEmployeeDraft(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SaveEmployeePeriodReviewDraftDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.service.saveEmployeeDraft(id, dto, viewer);
  }

  @Post(':id/employee-submit')
  @HttpCode(200)
  submitEmployeeReview(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SubmitEmployeePeriodReviewDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.service.submitEmployeeReview(id, dto, viewer);
  }
}
