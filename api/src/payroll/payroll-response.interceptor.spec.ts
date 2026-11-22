import { StreamableFile } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { serializePayroll } from './payroll-response.interceptor';

describe('exact payroll response serialization', () => {
  it('preserves positive and negative cents in nested private payloads', () => {
    const value = { gross: new Prisma.Decimal('70368744177664.01'), lines: [{ amount: new Prisma.Decimal('-70368744177664.01') }, { amount: new Prisma.Decimal(0) }, { amount: null }] };
    expect(serializePayroll(value)).toEqual({ gross: '70368744177664.01', lines: [{ amount: '-70368744177664.01' }, { amount: '0' }, { amount: null }] });
  });
  it('does not serialize a file or timestamp as a record', () => {
    const file = new StreamableFile(Buffer.from('fictional'));
    expect(serializePayroll(file)).toBe(file);
    const date = new Date(); expect(serializePayroll(date)).toBe(date);
  });
});
