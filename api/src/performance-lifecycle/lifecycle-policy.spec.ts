import { ConflictException, ForbiddenException } from '@nestjs/common';
import { HR_CAPABILITIES, hasHrCapability } from '@/auth/hr-capabilities';
import { assertLifecycleAction, lifecycleProjection, lifecycleWhere, assertLifecycleActive } from './lifecycle-policy';

const hr = { id: 'hr', sysRole: 'hr', isAssessorOnly: false } as any;
const record = { status: 'self_eval', updatedAt: new Date('2026-11-26T00:00:00Z'), lifecycleStatus: 'active', lifecycleVersion: 0 };

describe('explicit performance lifecycle capabilities', () => {
  it.each(['view', 'terminate', 'delete'])('registers independent %s authority', (action) => {
    expect(HR_CAPABILITIES as readonly string[]).toContain(`performance_lifecycle_${action}`);
  });
  it('does not grant lifecycle management from existing performance authority', () => {
    expect(hasHrCapability({ sysRole: 'hr_user', hrCapabilities: ['performance_publish', 'cycle_plan_edit'] },
      'performance_lifecycle_terminate' as never)).toBe(false);
  });
});

describe('lifecycle policy preserves business facts', () => {
  it('offers termination, not deletion, for unfinished work', () => {
    expect(lifecycleProjection('task', record, hr).allowedActions).toEqual(['lifecycle_terminate']);
    expect(() => assertLifecycleAction('task', record, 'delete')).toThrow(ConflictException);
  });
  it.each([
    ['task', { status: 'published' }], ['task', { status: 'appealing', publishedAt: new Date() }],
    ['task', { status: 'confirmed' }], ['task', { status: 'appealing' }],
    ['task', { status: 'manager_scoring', approvedAt: new Date() }],
    ['task', { status: 'manager_scoring', gradeResult: { isPublished: true, publishedAt: new Date() } }],
    ['task', { status: 'exempted' }], ['goal_change', { status: 'active', effectiveVersionId: 'version' }],
    ['goal_change', { status: 'revoked' }], ['improvement_plan', { status: 'completed' }],
    ['confirmation', { status: 'approved' }], ['confirmation', { status: 'rejected' }],
  ])('protects completed/effective %s from termination', (kind, facts) => {
    const row = { ...record, ...facts };
    expect(() => assertLifecycleAction(kind as any, row, 'terminate')).toThrow(ConflictException);
    expect(row).toEqual({ ...record, ...facts });
  });
  it.each([
    { status: 'confirmed', approvedAt: new Date(), employeeConfirmedAt: new Date(), publishedAt: null },
    { status: 'approval', approvedAt: new Date(), employeeConfirmedAt: null, publishedAt: null },
    { status: 'published', approvedAt: new Date(), employeeConfirmedAt: null, publishedAt: new Date() },
    { status: 'appealing', employeeConfirmedAt: new Date(), publishedAt: new Date() },
  ])('does not skip remaining obligations by deleting a protected task', (facts) => {
    const row = { ...record, ...facts };
    expect(() => assertLifecycleAction('task', row, 'terminate')).toThrow(ConflictException);
    expect(() => assertLifecycleAction('task', row, 'delete')).toThrow(ConflictException);
    expect(lifecycleProjection('task', row, hr).allowedActions).toEqual([]);
  });
  it.each([
    { status: 'closed' }, { status: 'exempted' },
    { status: 'published', publishedAt: new Date(), employeeConfirmedAt: new Date() },
    { status: 'confirmed', publishedAt: new Date(), employeeConfirmedAt: new Date() },
  ])('archives only a completed task while preserving its facts', (facts) => {
    const row = { ...record, ...facts };
    expect(() => assertLifecycleAction('task', row, 'delete')).not.toThrow();
  });
  it('makes terminated/deleted records non-actionable and keeps delete separate', () => {
    expect(() => assertLifecycleActive({ ...record, lifecycleStatus: 'terminated' })).toThrow(ConflictException);
    expect(lifecycleProjection('task', { ...record, lifecycleStatus: 'terminated' }, hr).allowedActions)
      .toEqual(['lifecycle_delete']);
    expect(lifecycleProjection('task', { ...record, lifecycleStatus: 'deleted' }, hr).allowedActions).toEqual([]);
  });
  it('does not substitute lifecycle-view for original rights or mutation authority', () => {
    const viewer = { ...hr, sysRole: 'hr_user', hrCapabilities: ['performance_lifecycle_view'] };
    expect(lifecycleProjection('task', record, viewer).allowedActions).toEqual([]);
    expect(lifecycleWhere('deleted', { ...viewer, hrCapabilities: [] })).toEqual({ lifecycleStatus: 'deleted' });
    expect(lifecycleWhere('all', { ...viewer, hrCapabilities: [] })).toEqual({});
    expect(lifecycleWhere(undefined, viewer)).toEqual({ lifecycleStatus: { not: 'deleted' } });
  });
});
