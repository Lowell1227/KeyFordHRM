import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTalentDto } from './create-talent.dto';
import { UpdateTalentDto } from './update-talent.dto';
import { TalentQueryDto } from './talent-query.dto';
import { TALENT_TAG_LABELS } from '../talent.constants';

describe('project management and ecommerce talent tags', () => {
  it.each([['project_management', '项目管理'], ['ecommerce_operations', '电商运营']])('accepts %s for create, edit and filtering', async (tag, label) => {
    expect((TALENT_TAG_LABELS as Record<string, string>)[tag]).toBe(label);
    expect(await validate(plainToInstance(CreateTalentDto, { name: '虚构标签测试', phone: '10000000001', sourceChannel: 'other', tags: [tag] }))).toEqual([]);
    expect(await validate(plainToInstance(UpdateTalentDto, { tags: [tag] }))).toEqual([]);
    expect(await validate(plainToInstance(TalentQueryDto, { tag }))).toEqual([]);
  });
  it('still rejects unknown tags', async () => {
    expect((await validate(plainToInstance(UpdateTalentDto, { tags: ['unknown_tag'] }))).some(error => error.property === 'tags')).toBe(true);
  });
});
