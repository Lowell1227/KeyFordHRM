import { resolveCalibrationRecipient } from './calibration-recipient';

describe('calibration notification recipient', () => {
  const task = { employeeId: 'owner', deptHeadId: 'head', managerId: 'manager' };
  const prisma = () => ({ user: { findFirst: jest.fn().mockResolvedValue(null) } });

  it('routes a different employee to the designated cycle owner without requiring a global role', async () => {
    const db = prisma();
    expect(await resolveCalibrationRecipient(db as any, { ...task, employeeId: 'employee' }, 'owner')).toBe('owner');
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });

  it('does not invent an owner for a legacy cycle without one', async () => {
    const db = prisma();
    expect(await resolveCalibrationRecipient(db as any, task, null)).toBeNull();
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });

  it('routes the owner own result to an eligible frozen department reviewer', async () => {
    const db = prisma();
    db.user.findFirst.mockResolvedValueOnce({ id: 'head' });
    expect(await resolveCalibrationRecipient(db as any, task, 'owner')).toBe('head');
    expect(db.user.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'head', status: 'active', deletedAt: null });
    expect(db.user.findFirst.mock.calls[0][0].where.OR).toContainEqual({ sysRole: 'hr_user', hrCapabilities: { has: 'performance_calibration' } });
  });

  it('skips an ineligible head and tries the frozen manager, then another eligible HR', async () => {
    const db = prisma();
    db.user.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'hr' });
    expect(await resolveCalibrationRecipient(db as any, task, 'owner')).toBe('hr');
    expect(db.user.findFirst.mock.calls.map(([args]) => args.where.id)).toEqual(['head', 'manager', { not: 'owner' }]);
  });

  it('never notifies the employee and does not invent a handler when no eligible HR exists', async () => {
    const db = prisma();
    expect(await resolveCalibrationRecipient(db as any, { ...task, deptHeadId: 'owner', managerId: 'owner' }, 'owner')).toBeNull();
    expect(db.user.findFirst).toHaveBeenCalledTimes(1);
    expect(db.user.findFirst.mock.calls[0][0].where.id).toEqual({ not: 'owner' });
  });
});
