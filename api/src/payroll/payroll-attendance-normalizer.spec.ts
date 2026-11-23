import { normalizeAttendance, PayrollAttendanceInput, PayrollAttendanceRecord } from './payroll-attendance-normalizer';

const expected = (employeeId = 'fictional-1', workDate = '2026-11-02', required = true, units = '1') => ({
  employeeId,
  workDate,
  required,
  units,
});
const record = (patch: Partial<PayrollAttendanceRecord> = {}): PayrollAttendanceRecord => ({
  sourceId: 'clock-1',
  sourceVersion: 0,
  employeeId: 'fictional-1',
  workDate: '2026-11-02',
  startsAt: '2026-11-02T09:00:00+08:00',
  endsAt: '2026-11-02T17:00:00+08:00',
  type: 'normal',
  state: 'effective',
  hours: '8',
  unit: 'hour',
  ...patch,
});
const input = (
  records: PayrollAttendanceRecord[] = [],
  patch: Partial<PayrollAttendanceInput> = {},
): PayrollAttendanceInput => ({
  month: '2026-11',
  expected: [expected()],
  records,
  ...patch,
});
const codes = (value: PayrollAttendanceInput) => normalizeAttendance(value).issues.map((issue) => issue.code);

describe('normalizeAttendance', () => {
  it.each(['late', 'early'])('normalizes %s as a regular fact without deciding its pay rate', type => {
    const result = normalizeAttendance(input([record({ type: type as any })]));
    expect(result.issues).toEqual([]);
    expect(result.days[0].records[0]).toMatchObject({ type, kind: 'regular', resolution: 'usable', effectiveHours: '8' });
  });
  it.each(['superseded', 'cancelled'])('retains %s tombstones without using them as attendance coverage', state => {
    const type = state === 'superseded' ? 'normal' : 'paid_leave';
    const tombstone = record({ type, state: state as any, sourceVersion: 2 });
    const alone = normalizeAttendance(input([tombstone]));
    expect(alone.days[0].records[0]).toMatchObject({ state, resolution: 'inactive', effectiveHours: null });
    expect(alone.issues.map(row => row.code)).toEqual(['MISSING_RECORD']);
    const result = normalizeAttendance(input([record({ type, sourceVersion: 1 }), tombstone, record({ sourceId: 'replacement' })]));
    expect(result.issues).toEqual([]);
    expect(result.days[0].records.filter(row => row.resolution === 'usable')).toHaveLength(1);
    expect(normalizeAttendance(input([record({ state: 'revoked' })])).issues.map(row => row.code)).toEqual(['REVOKED_RECORD']);
  });
  it('does not accept superseded on external leave sources or cancelled on normal sources', () => {
    expect(codes(input([record({ type: 'paid_leave', state: 'superseded' as any })]))).toContain('INVALID_RECORD_STATE');
    expect(codes(input([record({ type: 'normal', state: 'cancelled' as any })]))).toContain('INVALID_RECORD_STATE');
  });
  it('retains every expected HRM day, distinguishing missing facts from days not requiring attendance', () => {
    const result = normalizeAttendance(
      input([], {
        expected: [expected(), expected('fictional-2'), expected('fictional-1', '2026-11-03', false, '0')],
      }),
    );
    expect(result.days.map((day) => [day.employeeId, day.workDate, day.units, day.required, day.issues])).toEqual([
      ['fictional-1', '2026-11-02', '1', true, ['MISSING_RECORD']],
      ['fictional-1', '2026-11-03', '0', false, []],
      ['fictional-2', '2026-11-02', '1', true, ['MISSING_RECORD']],
    ]);
  });

  it('keeps schedule units independent from source hours and sanitizes unknown/private fields', () => {
    const raw = {
      ...record({ hours: '08.2500', endsAt: '2026-11-02T17:15:00+08:00' }),
      position: 'private',
      photo: 'private',
      device: { id: 'private' },
    };
    const result = normalizeAttendance(
      input([raw], {
        expected: [expected('fictional-1', '2026-11-02', true, '01.00')],
      }),
    );
    expect(result.issues).toEqual([]);
    expect(result.days[0]).toMatchObject({ units: '1', required: true });
    expect(result.days[0].records[0]).toEqual({
      ...record({
        hours: '8.25',
        startsAt: '2026-11-02T01:00:00.000Z',
        endsAt: '2026-11-02T09:15:00.000Z',
      }),
      kind: 'regular',
      resolution: 'usable',
      effectiveHours: '8.25',
    });
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('deduplicates replay and equivalent decimal/time encodings without changing the version', () => {
    const once = normalizeAttendance(input([record()]));
    expect(
      normalizeAttendance(
        input([
          record(),
          record(),
          record({
            hours: '08.000',
            startsAt: '2026-11-02T01:00:00Z',
            endsAt: '2026-11-02T09:00:00Z',
          }),
        ]),
      ),
    ).toEqual(once);
    expect(once.version).toMatch(/^[a-f0-9]{64}$/);
  });

  it('selects the greatest numeric source revision without resurrecting older effective facts', () => {
    const result = normalizeAttendance(
      input([record({ sourceVersion: 2 }), record({ sourceVersion: 10, state: 'revoked' })]),
    );
    expect(result.days[0].records).toHaveLength(1);
    expect(result.days[0].records[0]).toMatchObject({
      sourceVersion: 10,
      state: 'revoked',
      resolution: 'inactive',
      effectiveHours: null,
    });
    expect(result.days[0].issues).toEqual(['REVOKED_RECORD']);
    expect(result.version).not.toBe(normalizeAttendance(input([record({ sourceVersion: 2 })])).version);
    expect(
      normalizeAttendance(input([record({ sourceVersion: 2 }), record({ sourceVersion: 1, state: 'pending' })])).issues,
    ).toEqual([]);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, '10'])(
    'never guesses an invalid sourceVersion %s',
    (sourceVersion) => {
      const value = input([record({ sourceVersion: sourceVersion as number })]);
      expect(codes(value)).toContain('INVALID_SOURCE_VERSION');
      expect(normalizeAttendance(value).days[0].records[0].effectiveHours).toBeNull();
    },
  );

  it('keeps conflicting same-id/revision contents unresolved, including all affected days', () => {
    const first = record();
    const second = record({ employeeId: 'fictional-2', hours: '7' });
    const value = input([first, second], {
      expected: [expected(), expected('fictional-2')],
    });
    const result = normalizeAttendance(value);
    expect(result.days).toHaveLength(2);
    for (const day of result.days) {
      expect(day.issues).toContain('SOURCE_VERSION_CONFLICT');
      expect(day.records[0]).toMatchObject({
        resolution: 'unresolved',
        effectiveHours: null,
      });
    }
    expect(normalizeAttendance({ ...value, records: [second, first] })).toEqual(result);
  });

  it('reports a conflicting historical replay even when a later revision exists', () => {
    expect(codes(input([record(), record({ hours: '7' }), record({ sourceVersion: 1 })]))).toContain(
      'SOURCE_VERSION_CONFLICT',
    );
  });

  it('follows the source workDate for a night shift ending in the next calendar month', () => {
    const night = record({
      workDate: '2026-11-30',
      startsAt: '2026-11-30T22:00:00+08:00',
      endsAt: '2026-12-01T06:00:00+08:00',
    });
    const result = normalizeAttendance(input([night], { expected: [expected('fictional-1', '2026-11-30')] }));
    expect(result.issues).toEqual([]);
    expect(result.days.map((day) => day.workDate)).toEqual(['2026-11-30']);
    expect(result.days[0].records[0]).toMatchObject({
      effectiveHours: '8',
      resolution: 'usable',
    });
  });

  it('never silently drops records outside the month or the HRM coverage roster', () => {
    const result = normalizeAttendance(
      input([record({ employeeId: 'unmapped' }), record({ sourceId: 'outside', workDate: '2026-12-01' })]),
    );
    expect(result.days).toHaveLength(3);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeId: 'unmapped',
          code: 'UNEXPECTED_RECORD',
        }),
        expect.objectContaining({
          workDate: '2026-12-01',
          code: 'OUTSIDE_MONTH',
        }),
      ]),
    );
    expect(result.days.find((day) => day.employeeId === 'unmapped')).toMatchObject({ units: null, required: null });
    expect(result.days.flatMap((day) => day.records).every((row) => row.effectiveHours === null)).toBe(true);
  });

  it.each(['pending', 'revoked'] as const)(
    'retains %s approval facts without treating them as effective attendance',
    (state) => {
      const result = normalizeAttendance(input([record({ type: 'paid_leave', state })]));
      expect(result.days[0].records[0]).toMatchObject({
        state,
        effectiveHours: null,
      });
      expect(result.days[0].issues).toContain(state === 'pending' ? 'PENDING_APPROVAL' : 'REVOKED_RECORD');
      expect(result.days[0].issues).not.toContain('MISSING_RECORD');
    },
  );

  it.each(['makeup', 'paid_leave', 'unpaid_leave', 'sick_leave', 'business_trip', 'outing'] as const)(
    'uses explicit effective %s coverage to replace a matching missing punch once',
    (type) => {
      const result = normalizeAttendance(
        input([record({ type: 'missing_punch' }), record({ sourceId: 'approval', type })]),
      );
      expect(result.issues).toEqual([]);
      expect(result.days[0].records.find((row) => row.type === 'missing_punch')).toMatchObject({
        resolution: 'covered',
        effectiveHours: '0',
      });
      expect(result.days[0].records.filter((row) => row.resolution === 'usable')).toHaveLength(1);
    },
  );

  it('permits adjoining approved intervals to cover a missing punch without overlapping pay coverage', () => {
    const result = normalizeAttendance(
      input([
        record({ type: 'missing_punch' }),
        record({
          sourceId: 'morning',
          type: 'makeup',
          endsAt: '2026-11-02T13:00:00+08:00',
          hours: '4',
        }),
        record({
          sourceId: 'afternoon',
          type: 'paid_leave',
          startsAt: '2026-11-02T13:00:00+08:00',
          hours: '4',
        }),
      ]),
    );
    expect(result.issues).toEqual([]);
    expect(result.days[0].records.find((row) => row.type === 'missing_punch')?.resolution).toBe('covered');
  });

  it.each([
    { type: 'makeup', state: 'pending' },
    { type: 'makeup', state: 'revoked' },
    { type: 'normal', state: 'effective' },
    { type: 'overtime', state: 'effective' },
  ] as const)('does not resolve missing punches from $state $type', (patch) => {
    expect(codes(input([record({ type: 'missing_punch' }), record({ sourceId: 'other', ...patch })]))).toContain(
      'MISSING_PUNCH',
    );
  });

  it('keeps a partly covered missing punch unresolved', () => {
    expect(
      codes(
        input([
          record({ type: 'missing_punch' }),
          record({
            sourceId: 'half',
            type: 'makeup',
            endsAt: '2026-11-02T13:00:00+08:00',
            hours: '4',
          }),
        ]),
      ),
    ).toContain('MISSING_PUNCH');
  });

  it.each(['normal', 'business_trip', 'unpaid_leave', 'absence'] as const)(
    'blocks incompatible overlapping paid_leave and %s instead of double counting',
    (type) => {
      const result = normalizeAttendance(input([record({ type: 'paid_leave' }), record({ sourceId: 'other', type })]));
      expect(result.days[0].issues).toContain('INTERVAL_CONFLICT');
      expect(result.days[0].records.every((row) => row.effectiveHours === null)).toBe(true);
    },
  );

  it('counts identical effective interval facts with different source ids only once', () => {
    const result = normalizeAttendance(input([record(), record({ sourceId: 'clock-2' })]));
    expect(result.issues).toEqual([]);
    expect(result.days[0].records.map((row) => row.effectiveHours).sort()).toEqual(['0', '8']);
    expect(result.days[0].records.map((row) => row.resolution).sort()).toEqual(['duplicate', 'usable']);
  });

  it('separates adjoining overtime from regular work and blocks an overlapping overtime interval', () => {
    const overtime = record({
      sourceId: 'ot',
      type: 'overtime',
      overtimeKind: 'weekday',
      startsAt: '2026-11-02T17:00:00+08:00',
      endsAt: '2026-11-02T19:00:00+08:00',
      hours: '2',
    });
    const result = normalizeAttendance(input([record(), overtime]));
    expect(result.issues).toEqual([]);
    expect(result.days[0].records.find((row) => row.type === 'overtime')).toMatchObject({
      kind: 'overtime',
      effectiveHours: '2',
    });
    expect(codes(input([record(), { ...overtime, startsAt: '2026-11-02T16:00:00+08:00' }]))).toContain(
      'INTERVAL_CONFLICT',
    );
  });

  it('does not let overtime alone satisfy a required regular-attendance day', () => {
    expect(codes(input([record({ type: 'overtime', overtimeKind: 'weekday' })]))).toContain('MISSING_REGULAR_COVERAGE');
    expect(
      codes(
        input([record({ type: 'overtime', overtimeKind: 'weekday' })], {
          expected: [expected('fictional-1', '2026-11-02', false, '0')],
        }),
      ),
    ).toEqual([]);
  });

  it('detects overlapping absolute intervals even when the source assigns different work days', () => {
    const result = normalizeAttendance(
      input([record(), record({ sourceId: 'other-day', workDate: '2026-11-03' })], {
        expected: [expected(), expected('fictional-1', '2026-11-03')],
      }),
    );
    expect(result.days.every((day) => day.issues.includes('INTERVAL_CONFLICT'))).toBe(true);
    expect(result.days.flatMap((day) => day.records).every((row) => row.effectiveHours === null)).toBe(true);
  });

  it('does not use conflicting coverage to clear a missing punch', () => {
    const result = normalizeAttendance(
      input([
        record({ type: 'missing_punch' }),
        record({ sourceId: 'leave', type: 'paid_leave' }),
        record({ sourceId: 'trip', type: 'business_trip' }),
      ]),
    );
    expect(result.days[0].issues).toEqual(['INTERVAL_CONFLICT', 'MISSING_PUNCH']);
    expect(result.days[0].records.every((row) => row.effectiveHours === null)).toBe(true);
  });

  it('cannot mark a malformed missing-punch source as covered by a valid approval', () => {
    const result = normalizeAttendance(
      input([record({ sourceId: '', type: 'missing_punch' }), record({ sourceId: 'approval', type: 'makeup' })]),
    );
    expect(result.days[0].records.find((row) => row.type === 'missing_punch')).toMatchObject({
      resolution: 'unresolved',
      effectiveHours: null,
    });
    expect(result.days[0].issues).toEqual(['INVALID_SOURCE_ID', 'MISSING_PUNCH']);
  });

  it('does not let an unrelated malformed interval hide a fully covered missing punch', () => {
    const result = normalizeAttendance(
      input([
        record({ type: 'missing_punch' }),
        record({ sourceId: 'approval', type: 'makeup' }),
        record({ sourceId: 'bad', startsAt: 'invalid', type: 'overtime', overtimeKind: 'weekday' }),
      ]),
    );
    expect(result.days[0].records.find((row) => row.type === 'missing_punch')).toMatchObject({
      resolution: 'covered',
      effectiveHours: '0',
    });
    expect(result.days[0].issues).toEqual(['INVALID_INTERVAL']);
  });

  it('distinguishes confirmed absence, explicit missing punch and not-required facts from no data', () => {
    const absence = normalizeAttendance(input([record({ type: 'absence' })]));
    expect(absence.issues).toEqual([]);
    expect(absence.days[0].records[0]).toMatchObject({
      type: 'absence',
      kind: 'exception',
      resolution: 'usable',
      effectiveHours: '8',
    });
    expect(codes(input([record({ type: 'missing_punch' })]))).toEqual(['MISSING_PUNCH']);
    expect(
      codes(
        input([record({ type: 'not_required', hours: '0' })], {
          expected: [expected('fictional-1', '2026-11-02', false, '0')],
        }),
      ),
    ).toEqual([]);
    expect(codes(input([record({ type: 'not_required', hours: '0' })]))).toContain('REQUIREMENT_CONFLICT');
  });

  it.each(['normal', 'unpaid_leave', 'absence', 'makeup', 'overtime'] as const)(
    'blocks effective %s hours beyond the absolute interval without correcting the source',
    (type) => {
      const result = normalizeAttendance(input([record({
        type, overtimeKind: 'weekday', hours: '20', endsAt: '2026-11-02T11:00:00+08:00',
      })], { expected: [expected('fictional-1', '2026-11-02', false, '0')] }));
      expect(result.days[0].issues).toEqual(['HOURS_EXCEED_INTERVAL']);
      expect(result.days[0].records[0]).toMatchObject({
        hours: '20', resolution: 'unresolved', effectiveHours: null,
      });
      expect(result.issues[0].message).toBeTruthy();
    },
  );

  it.each(['0', '1.5', '2'])(
    'keeps valid %s hours, including deducted breaks, inside a two-hour interval',
    (hours) => {
      const result = normalizeAttendance(input([record({ hours, endsAt: '2026-11-02T11:00:00+08:00' })]));
      expect(result.issues).toEqual([]);
      expect(result.days[0].records[0]).toMatchObject({ hours, resolution: 'usable', effectiveHours: hours });
    },
  );

  it.each([
    ['2026-11-30T23:00:00+08:00', '2026-12-01T01:00:00+08:00', '2', false],
    ['2026-11-30T23:00:00+08:00', '2026-12-01T01:00:00+08:00', '2.0001', true],
    ['2026-11-30T18:00:00+08:00', '2026-11-30T14:00:00+02:00', '2', false],
    ['2026-11-30T18:00:00+08:00', '2026-11-30T14:00:00+02:00', '3', true],
    ['2026-11-30T00:00:00Z', '2026-12-01T08:00:00Z', '32', false],
    ['2026-11-30T00:00:00Z', '2026-12-01T08:00:00Z', '32.0001', true],
    ['2026-11-30T09:00:00Z', '2026-11-30T11:00:00Z', '2.00000000000000000001', true],
    ['2026-11-30T09:00:00.0001Z', '2026-11-30T09:00:00.0002Z', '0.00000001', false],
    ['2026-11-30T09:00:00.0001Z', '2026-11-30T09:00:00.0002Z', '0.00000003', true],
  ] as const)('compares %s to %s against %s hours without losing date, offset or decimal precision', (startsAt, endsAt, hours, exceeds) => {
    const result = normalizeAttendance(input([record({ workDate: '2026-11-30', startsAt, endsAt, hours })], {
      expected: [expected('fictional-1', '2026-11-30')],
    }));
    expect(result.days[0].issues).toEqual(exceeds ? ['HOURS_EXCEED_INTERVAL'] : []);
    expect(result.days[0].records[0]).toMatchObject({
      hours, resolution: exceeds ? 'unresolved' : 'usable', effectiveHours: exceeds ? null : hours,
    });
  });

  it.each(['pending', 'revoked'] as const)('keeps the existing %s issue without pricing inactive overlong hours', (state) => {
    const result = normalizeAttendance(input([record({ state, hours: '20' })]));
    expect(result.days[0].issues).toEqual([state === 'pending' ? 'PENDING_APPROVAL' : 'REVOKED_RECORD']);
    expect(result.days[0].records[0]).toMatchObject({ hours: '20', resolution: 'inactive', effectiveHours: null });
  });

  it('does not compare duration against an invalid interval', () => {
    expect(codes(input([record({ startsAt: 'invalid', hours: '20' })]))).toEqual(['INVALID_INTERVAL']);
  });

  it.each(['day', 'unknown'] as const)('keeps %s duration unresolved instead of guessing its conversion for an interval check', (unit) => {
    const result = normalizeAttendance(input([record({ unit, hours: '20', endsAt: '2026-11-02T11:00:00+08:00' })]));
    expect(result.days[0].issues).toEqual([unit === 'day' ? 'DAY_CONVERSION_REQUIRED' : 'UNKNOWN_UNIT']);
    expect(result.days[0].records[0]).toMatchObject({ unit, hours: '20', resolution: 'unresolved', effectiveHours: null });
  });

  it.each(['day', 'unknown'] as const)('retains raw %s units and never invents an eight-hour conversion', (unit) => {
    const result = normalizeAttendance(input([record({ unit, hours: '1' })]));
    expect(result.days[0].issues).toContain(unit === 'day' ? 'DAY_CONVERSION_REQUIRED' : 'UNKNOWN_UNIT');
    expect(result.days[0].records[0]).toMatchObject({
      unit,
      hours: '1',
      effectiveHours: null,
      resolution: 'unresolved',
    });
  });

  it.each(['', ' ', 'NaN', 'Infinity', '-1', '1e2', '0x10', '1,5', '1.2.3', '.5'])(
    'retains malformed decimal %j as unresolved',
    (hours) => {
      const result = normalizeAttendance(input([record({ hours })]));
      expect(result.days[0].issues).toContain('INVALID_HOURS');
      expect(result.days[0].records[0]).toMatchObject({
        hours,
        effectiveHours: null,
      });
    },
  );

  it('preserves decimal precision without binary floating point or integer-hour rounding', () => {
    const hours = '0.123456789012345678901234567890';
    expect(normalizeAttendance(input([record({ hours })])).days[0].records[0].effectiveHours).toBe(
      '0.12345678901234567890123456789',
    );
  });

  it.each(['2026-02-29', '2026-11-31', '2026-00-10', '2026-13-01', '2026-11-2'])(
    'rejects impossible/non-ISO workDate %s without rolling it forward',
    (workDate) => {
      const result = normalizeAttendance(input([record({ workDate })]));
      expect(result.issues).toContainEqual(expect.objectContaining({ workDate, code: 'INVALID_WORK_DATE' }));
      expect(result.days.find((day) => day.workDate === workDate)?.records[0].effectiveHours).toBeNull();
    },
  );

  it.each([
    '2026-02-29T09:00:00Z',
    '2026-11-02T24:00:00Z',
    '2026-11-02T09:60:00Z',
    '2026-11-02T09:00:60Z',
    '2026-11-02T09:00:00',
    '2026-11-02T09:00:00+24:00',
    'not-a-time',
  ])('rejects invalid or timezone-ambiguous timestamp %s', (startsAt) => {
    expect(codes(input([record({ startsAt })]))).toContain('INVALID_INTERVAL');
  });

  it.each(['2026-11-02T01:00:00Z', '2026-11-02T00:59:59Z'])('rejects nonpositive intervals ending %s', (endsAt) => {
    expect(codes(input([record({ endsAt })]))).toContain('INVALID_INTERVAL');
  });

  it('accepts real leap dates and explicit offsets', () => {
    const leap = record({
      workDate: '2024-02-29',
      startsAt: '2024-02-29T09:00:00+08:00',
      endsAt: '2024-02-29T17:00:00+08:00',
    });
    expect(
      codes(
        input([leap], {
          month: '2024-02',
          expected: [expected('fictional-1', '2024-02-29')],
        }),
      ),
    ).toEqual([]);
  });

  it('preserves submillisecond ISO precision instead of rejecting or collapsing a real interval', () => {
    const precise = record({
      startsAt: '2026-11-02T09:00:00.0001+08:00',
      endsAt: '2026-11-02T09:00:00.0002+08:00',
      hours: '0.00000001',
    });
    const result = normalizeAttendance(input([precise]));
    expect(result.issues).toEqual([]);
    expect(result.days[0].records[0]).toMatchObject({
      startsAt: '2026-11-02T01:00:00.0001Z',
      endsAt: '2026-11-02T01:00:00.0002Z',
      effectiveHours: '0.00000001',
    });
    const adjacent = {
      ...precise,
      sourceId: 'adjacent',
      startsAt: precise.endsAt,
      endsAt: '2026-11-02T09:00:00.0003+08:00',
    };
    expect(codes(input([precise, adjacent]))).toEqual([]);
    expect(codes(input([precise, { ...adjacent, startsAt: '2026-11-02T09:00:00.00015+08:00' }]))).toContain(
      'INTERVAL_CONFLICT',
    );
  });

  it('keeps a real zero-hour fact separate from no supplied source facts', () => {
    expect(normalizeAttendance(input([record({ hours: '0' })])).days[0].records[0]).toMatchObject({
      resolution: 'usable',
      effectiveHours: '0',
    });
    expect(codes(input([record({ hours: '0' })]))).toEqual([]);
    expect(codes(input())).toEqual(['MISSING_RECORD']);
  });

  it.each(['weekday', 'restday', 'holiday'] as const)(
    'retains explicitly supplied %s overtime classification',
    (overtimeKind) => {
      const value = input([record({ type: 'overtime', overtimeKind })], {
        expected: [expected('fictional-1', '2026-11-02', false, '0')],
      });
      const result = normalizeAttendance(value);
      expect(result.issues).toEqual([]);
      expect(result.days[0].records[0]).toMatchObject({ overtimeKind, resolution: 'usable', effectiveHours: '8' });
      expect(
        normalizeAttendance({
          ...value,
          records: [record({ type: 'overtime', overtimeKind: overtimeKind === 'weekday' ? 'restday' : 'weekday' })],
        }).version,
      ).not.toBe(result.version);
    },
  );

  it.each([undefined, 'unknown', ''])('does not guess an overtime category from %j', (overtimeKind) => {
    const result = normalizeAttendance(
      input([record({ type: 'overtime', overtimeKind: overtimeKind as 'weekday' })], {
        expected: [expected('fictional-1', '2026-11-02', false, '0')],
      }),
    );
    expect(result.days[0].issues).toContain('OVERTIME_KIND_REQUIRED');
    expect(result.days[0].records[0]).toMatchObject({ resolution: 'unresolved', effectiveHours: null });
  });

  it('does not require an overtime price category for a real zero duration', () => {
    expect(
      codes(
        input([record({ type: 'overtime', hours: '0' })], {
          expected: [expected('fictional-1', '2026-11-02', false, '0')],
        }),
      ),
    ).toEqual([]);
  });

  it('does not deduplicate differing overtime classifications as the same result', () => {
    expect(
      codes(
        input(
          [
            record({ sourceId: 'weekday', type: 'overtime', overtimeKind: 'weekday' }),
            record({ sourceId: 'restday', type: 'overtime', overtimeKind: 'restday' }),
          ],
          { expected: [expected('fictional-1', '2026-11-02', false, '0')] },
        ),
      ),
    ).toEqual(['INTERVAL_CONFLICT']);
  });

  it('uses an explicit effective unpaid-leave result instead of the same normal and missing-punch interval', () => {
    const value = input([
      record(),
      record({ sourceId: 'leave', type: 'unpaid_leave' }),
      record({ sourceId: 'missing', type: 'missing_punch' }),
    ]);
    const result = normalizeAttendance(value);
    expect(result.issues).toEqual([]);
    expect(result.days[0].records.filter((row) => row.resolution === 'usable')).toEqual([
      expect.objectContaining({ type: 'unpaid_leave', effectiveHours: '8' }),
    ]);
    expect(result.days[0].records.find((row) => row.type === 'normal')).toMatchObject({
      resolution: 'covered',
      effectiveHours: '0',
    });
    expect(result.days[0].records.find((row) => row.type === 'missing_punch')).toMatchObject({
      resolution: 'covered',
      effectiveHours: '0',
    });
    expect(normalizeAttendance({ ...value, records: [...value.records].reverse() })).toEqual(result);
  });

  it('does not guess a partial normal/leave split or use an unpaid replacement that conflicts with another paid cover', () => {
    const partial = record({
      sourceId: 'leave',
      type: 'unpaid_leave',
      endsAt: '2026-11-02T13:00:00+08:00',
      hours: '4',
    });
    expect(codes(input([record(), partial]))).toEqual(['INTERVAL_CONFLICT']);
    const conflict = normalizeAttendance(
      input([
        record(),
        record({ sourceId: 'leave', type: 'unpaid_leave' }),
        record({ sourceId: 'other', type: 'paid_leave' }),
      ]),
    );
    expect(conflict.days[0].issues).toEqual(['INTERVAL_CONFLICT']);
    expect(conflict.days[0].records.every((row) => row.effectiveHours === null)).toBe(true);
  });

  it('does not let an adapter review note erase missing source facts or an unresolved unit', () => {
    const note = { reviewNote: 'Fictional reviewer acknowledged this row', issues: [] };
    expect(codes({ ...input(), ...note })).toEqual(['MISSING_RECORD']);
    const result = normalizeAttendance(input([{ ...record({ unit: 'unknown' }), ...note }]));
    expect(result.days[0].issues).toEqual(['UNKNOWN_UNIT']);
    expect(result.days[0].records[0].effectiveHours).toBeNull();
    expect(JSON.stringify(result)).not.toContain('reviewNote');
  });

  it.each(['2026-00', '2026-13', '26-11', '2026-1', '0000-11'])(
    'rejects invalid month %s at the input boundary',
    (month) => {
      expect(() => normalizeAttendance(input([], { month }))).toThrow(RangeError);
    },
  );

  it('does not silently choose a conflicting HRM expectation or accept malformed schedule units', () => {
    const conflict = normalizeAttendance(
      input([record()], {
        expected: [expected(), expected('fictional-1', '2026-11-02', false)],
      }),
    );
    expect(conflict.days[0]).toMatchObject({
      units: null,
      required: null,
      issues: expect.arrayContaining(['EXPECTED_CONFLICT']),
    });
    expect(
      codes(
        input([], {
          expected: [expected('fictional-1', '2026-11-02', true, 'NaN')],
        }),
      ),
    ).toContain('INVALID_EXPECTED_UNITS');
  });

  it('is deterministic across order, exact duplicates and privacy-only changes without mutating input', () => {
    const value = input([record({ sourceId: 'b' }), record({ sourceId: 'a', employeeId: 'fictional-2' })], {
      expected: [expected(), expected('fictional-2')],
    });
    const before = JSON.stringify(value);
    const result = normalizeAttendance(value);
    expect(JSON.stringify(value)).toBe(before);
    expect(
      normalizeAttendance({
        ...value,
        expected: [...value.expected].reverse(),
        records: [...value.records].reverse(),
      }),
    ).toEqual(result);
    expect(
      normalizeAttendance({
        ...value,
        expected: [...value.expected, ...value.expected],
      }),
    ).toEqual(result);
    expect(normalizeAttendance(input([{ ...record(), photos: ['private'] } as PayrollAttendanceRecord]))).toEqual(
      normalizeAttendance(input([record()])),
    );
    expect(normalizeAttendance(input([record({ hours: '7.5', sourceVersion: 1 })])).version).not.toBe(
      normalizeAttendance(input([record()])).version,
    );
  });
});
