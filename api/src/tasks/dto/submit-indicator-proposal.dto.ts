import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { SetIndicatorItemDto } from './set-indicators.dto';

export class IndicatorProposalItemDto extends SetIndicatorItemDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  target?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  standard?: string;
}

/** POST /tasks/:id/indicator-proposal 请求体。 */
export class SubmitIndicatorProposalDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IndicatorProposalItemDto)
  items!: IndicatorProposalItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
