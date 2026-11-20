import { talentEmploymentStatus } from './talent-employment';

const employeeId = 'synthetic-linked-employee';
const employee = (status: string, patch = {}) => ({ id: employeeId, status, deletedAt: null, archivedAt: null, ...patch });

describe('talent linked employee current status', () => {
  it('does not show employee status for an unlinked candidate', () => {
    expect(talentEmploymentStatus(null, null)).toBeNull();
    expect(talentEmploymentStatus(undefined, employee('active'))).toBeNull();
  });

  it.each(['active', 'probation', 'resigned', 'pending_entry'] as const)('shows the linked employee current %s status', status => {
    expect(talentEmploymentStatus(employeeId, employee(status))).toBe(status);
  });

  it('uses the current active status after reentry instead of retaining a previous resignation', () => {
    expect(talentEmploymentStatus(employeeId, employee('resigned'))).toBe('resigned');
    expect(talentEmploymentStatus(employeeId, employee('active'))).toBe('active');
  });

  it('keeps a confirmed resignation visible after the employee is archived', () => {
    expect(talentEmploymentStatus(employeeId, employee('resigned', { archivedAt: new Date('2026-01-01') }))).toBe('resigned');
  });

  it.each([null, undefined, employee('active', { id: 'another-employee' }),
    employee('active', { deletedAt: new Date() }), employee('resigned', { deletedAt: new Date() }),
    employee('active', { archivedAt: new Date() }), employee('probation', { archivedAt: new Date() }), employee('unsupported'),
  ])('requires review rather than inferring resignation from an unusable link', user => {
    expect(talentEmploymentStatus(employeeId, user)).toBe('unknown');
  });

  it('returns only a business status and leaves the employee record unchanged', () => {
    const user = Object.freeze(employee('active', { phone: 'private', salary: 'private' }));
    expect(talentEmploymentStatus(employeeId, user)).toBe('active');
    expect(user).toEqual(employee('active', { phone: 'private', salary: 'private' }));
  });
});
