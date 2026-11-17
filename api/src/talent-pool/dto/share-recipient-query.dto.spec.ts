import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ShareRecipientQueryDto } from './share-recipient-query.dto';

describe('分享接收人专用分页参数', () => {
  it('默认每页20人，姓名或工号关键词去空白，字符串页码可转换', async () => {
    const defaults = plainToInstance(ShareRecipientQueryDto, {});
    expect([defaults.page, defaults.pageSize]).toEqual([1, 20]);
    const query = plainToInstance(ShareRecipientQueryDto, { keyword: ' F001 ', page: '2', pageSize: '10' });
    expect(await validate(query)).toEqual([]);
    expect([query.keyword, query.skip, query.take]).toEqual(['F001', 10, 10]);
  });

  it.each([
    { page: 0 }, { page: 1.5 }, { pageSize: 101 }, { pageSize: 0 }, { keyword: ['F001'] },
  ])('非法参数不能变成无界人员查询：%j', async (input) => {
    expect((await validate(plainToInstance(ShareRecipientQueryDto, input))).length).toBeGreaterThan(0);
  });
});
