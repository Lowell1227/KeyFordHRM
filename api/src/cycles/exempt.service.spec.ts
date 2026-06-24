import { ExemptService } from './exempt.service';

function date(iso: string): Date {
  return new Date(iso);
}

describe('ExemptService', () => {
  let service: ExemptService;
  const cycle = {
    startDate: date('2026-01-01'),
    endDate: date('2026-03-31'),
  };
  const ratio = 0.3333;

  beforeEach(() => {
    service = new ExemptService();
  });

  it('整周期在职：不豁免', () => {
    const user = { entryDate: date('2026-01-01'), leaveDate: null };
    const result = service.calcExempt(user, cycle, ratio);
    expect(result.onJobDays).toBe(90);
    expect(result.isExempt).toBe(false);
  });

  it('期中入职且不足 1/3：豁免', () => {
    const user = { entryDate: date('2026-03-03'), leaveDate: null };
    const result = service.calcExempt(user, cycle, ratio);
    expect(result.onJobDays).toBe(29);
    expect(result.isExempt).toBe(true);
  });

  it('期中离职且不足 1/3：豁免', () => {
    const user = { entryDate: date('2026-01-01'), leaveDate: date('2026-01-20') };
    const result = service.calcExempt(user, cycle, ratio);
    expect(result.onJobDays).toBe(20);
    expect(result.isExempt).toBe(true);
  });

  it('入职与离职都在周期内：按实际在岗天数计算', () => {
    const user = { entryDate: date('2026-01-15'), leaveDate: date('2026-02-10') };
    const result = service.calcExempt(user, cycle, ratio);
    expect(result.onJobDays).toBe(27);
    expect(result.isExempt).toBe(true);
  });

  it('边界值：刚好等于阈值（90 * 0.3333 ≈ 29.997），30 天不豁免', () => {
    const user = { entryDate: date('2026-03-02'), leaveDate: null };
    const result = service.calcExempt(user, cycle, ratio);
    expect(result.onJobDays).toBe(30);
    expect(result.isExempt).toBe(false);
  });
});
