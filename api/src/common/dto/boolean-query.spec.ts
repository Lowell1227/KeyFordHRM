import 'reflect-metadata';
import { ValidationPipe, type Type } from '@nestjs/common';
import { UserQueryDto } from '@/users/dto/user-query.dto';
import { DepartmentQueryDto } from '@/departments/dto/department-query.dto';
import { PositionQueryDto } from '@/positions/dto/position.dto';
import { ObjectiveQueryDto } from '@/objectives/dto/objective-query.dto';
import { IndicatorQueryDto } from '@/indicators/dto/indicator-query.dto';
import { TalentQueryDto } from '@/talent-pool/dto/talent-query.dto';
import { NotificationQueryDto } from '@/notifications/dto/notification-query.dto';
import { ContractSubjectQueryDto } from '@/contract-subjects/contract-subjects.dto';
import { PersonnelReferenceDataQueryDto } from '@/personnel-reference-data/personnel-reference-data.dto';
import { TemplatesController } from '@/templates/templates.controller';

const TemplateQueryDto = Reflect.getMetadata('design:paramtypes', TemplatesController.prototype, 'findAll')[0];
const queries: Array<[string, Type<unknown>, string, boolean | undefined]> = [
  ...['archived', 'includeResigned', 'includeTestAccounts', 'unassigned'].map((key) =>
    [`users.${key}`, UserQueryDto, key, undefined] as [string, Type<unknown>, string, undefined]),
  ['departments.flat', DepartmentQueryDto, 'flat', undefined],
  ['departments.isActive', DepartmentQueryDto, 'isActive', undefined],
  ['positions.includeInactive', PositionQueryDto, 'includeInactive', false],
  ['objectives.flat', ObjectiveQueryDto, 'flat', undefined],
  ['indicators.isActive', IndicatorQueryDto, 'isActive', true],
  ['templates.isActive', TemplateQueryDto, 'isActive', true],
  ['talents.dueOnly', TalentQueryDto, 'dueOnly', undefined],
  ['talents.staleOnly', TalentQueryDto, 'staleOnly', undefined],
  ['notifications.unreadOnly', NotificationQueryDto, 'unreadOnly', undefined],
  ['subjects.includeInactive', ContractSubjectQueryDto, 'includeInactive', undefined],
  ['references.includeInactive', PersonnelReferenceDataQueryDto, 'includeInactive', undefined],
];

describe.each(queries)('%s under the application ValidationPipe', (_name, metatype, key, defaultValue) => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } });
  const transform = (input: Record<string, unknown>) => pipe.transform(input, { type: 'query', metatype });

  it.each([['false', false], ['true', true], [false, false], [true, true]])('parses %s without truthiness coercion', async (raw, expected) => {
    expect((await transform({ [key]: raw }))[key]).toBe(expected);
  });

  it('preserves the omitted default', async () => {
    expect((await transform({}))[key]).toBe(defaultValue);
  });

  it.each(['', 'yes', '0', '1', 0, 1, ['false', 'true'], { value: 'false' }])('rejects malformed input %j', async (raw) => {
    await expect(transform({ [key]: raw })).rejects.toThrow();
  });
});
