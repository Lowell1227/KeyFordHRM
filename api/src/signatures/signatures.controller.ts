import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { SignaturesService } from './signatures.service';
import { CreateSignatureDto } from './dto/create-signature.dto';
import { SignatureQueryDto } from './dto/signature-query.dto';

@Controller('signatures')
export class SignaturesController {
  constructor(private readonly signaturesService: SignaturesService) {}

  /** GET /signatures — 查询指定业务记录的签字列表。 */
  @Get()
  findAll(@Query() query: SignatureQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.signaturesService.findAll(query, viewer);
  }

  /** POST /signatures — 当前用户为指定角色签字。 */
  @Post()
  @HttpCode(200)
  create(@Body() dto: CreateSignatureDto, @CurrentUser() viewer: AuthUser) {
    return this.signaturesService.create(dto, viewer);
  }
}
