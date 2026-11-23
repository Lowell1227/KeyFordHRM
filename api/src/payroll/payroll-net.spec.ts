import { ConflictException } from '@nestjs/common';
import { assertPayrollNetShape, netSnapshotHash } from './payroll-net';

describe('immutable net approval snapshot', () => {
  it('hashes JSONB without depending on object key order', () => {
    expect(netSnapshotHash({ b: { y: 2, x: 1 }, a: 0 })).toBe(netSnapshotHash({ a: 0, b: { x: 1, y: 2 } }));
  });
  it('rejects absent, partial and modified snapshots rather than approving gross as net', () => {
    for (const value of [null, {}, { schema: 1, rows: [], totals: null }]) {
      expect(() => assertPayrollNetShape(value)).toThrow(ConflictException);
    }
  });
});
