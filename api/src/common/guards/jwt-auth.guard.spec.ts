import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AuthService } from '../../auth/auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard live employee authorization', () => {
  function setup(overrides: Record<string, unknown> = {}) {
    const currentUser = {
      id: 'employee-1', name: 'Virtual employee', employeeNo: '300', accountType: 'employee',
      status: 'active', archivedAt: null, deletedAt: null, sysRole: 'employee', deptId: 'dept-current',
      isAssessorOnly: false, canViewAll: false, hrCapabilities: [], ...overrides,
    };
    const prisma: any = {
      user: { findUnique: jest.fn(async () => currentUser) },
      employmentRecord: { findFirst: jest.fn(async () => ({ id: 'employment-1', employeeStatus: 'active' })) },
    };
    const effectiveDates = { refreshUserProjection: jest.fn(async () => ({ activated: false })) };
    const jwt = new JwtService({ secret: randomUUID() });
    const auth = new AuthService(prisma, jwt, {} as any, {} as any, {} as any, effectiveDates as any);
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    const guard = new (JwtAuthGuard as any)(reflector as unknown as Reflector, jwt, auth) as JwtAuthGuard;
    const payload = {
      sub: currentUser.id, name: 'Old name', employeeNo: '300', sysRole: 'hr', deptId: 'dept-old',
      isAssessorOnly: true, canViewAll: true, hrCapabilities: ['employee_archive_review'],
    };
    const request: any = { headers: { authorization: `Bearer ${jwt.sign(payload)}` } };
    const context = {
      getHandler: () => function handler() {}, getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { currentUser, prisma, effectiveDates, jwt, payload, request, context, guard, reflector };
  }

  it('uses current DB role, capabilities and department instead of stale signed permissions', async () => {
    const { guard, context, request } = setup({ sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'employee-1', name: 'Virtual employee', sysRole: 'hr_user', deptId: 'dept-current',
      isAssessorOnly: false, canViewAll: false, hrCapabilities: ['employee_archive_edit'],
    });
  });

  it.each([
    { status: 'resigned' }, { status: 'pending_entry' }, { archivedAt: new Date() }, { deletedAt: new Date() },
  ])('rejects a still-signed session for unavailable employee state %j', async (state) => {
    const { guard, context } = setup(state);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('applies due projection before authorization, even when the scheduler has not run', async () => {
    const { guard, context, currentUser, effectiveDates } = setup();
    effectiveDates.refreshUserProjection.mockImplementation(async () => {
      currentUser.status = 'resigned';
      return { activated: false };
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not revive the old session when the same person reenters with a new number', async () => {
    const { guard, context } = setup({ employeeNo: '301' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('requires a one-time relogin for legacy tokens without an employment-number claim', async () => {
    const { guard, context, request, jwt, payload } = setup();
    const { employeeNo: _legacyMissing, ...legacy } = payload;
    request.headers.authorization = `Bearer ${jwt.sign(legacy)}`;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('denies a projected-active employee whose latest effective record is resignation', async () => {
    const { guard, context, prisma } = setup();
    prisma.employmentRecord.findFirst.mockResolvedValue({ id: 'latest-record', employeeStatus: 'resigned' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses Shanghai calendar labels when resolving current employment at midnight', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-26T16:00:00.000Z'));
    try {
      const { guard, context, prisma } = setup();
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(prisma.employmentRecord.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ effectiveFrom: { lte: new Date('2026-09-27T00:00:00.000Z') } }),
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }));
    } finally { jest.useRealTimers(); }
  });

  it('requires approved, noncancelled sources when querying effective employment', async () => {
    const { guard, context, prisma } = setup();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    const query = prisma.employmentRecord.findFirst.mock.calls[0][0];
    expect(query.where.AND).toContainEqual({ OR: [
      { sourceRequestId: null },
      { sourceRequest: { profileReviewStatus: 'approved', onboardingStatus: { not: 'cancelled' } } },
      { sourceRequest: { profileReviewStatus: 'approved', onboardingStatus: null } },
    ] });
  });

  it.each(['service', 'test'])('keeps %s accounts outside employee-record requirements', async (accountType) => {
    const { guard, context, prisma, effectiveDates } = setup({ accountType });
    prisma.employmentRecord.findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(effectiveDates.refreshUserProjection).not.toHaveBeenCalled();
  });

  it('fails closed when the current account cannot be loaded', async () => {
    const { guard, context, prisma } = setup();
    prisma.user.findUnique.mockRejectedValue(new Error('repository unavailable'));
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps public routes accessible without reading employee records', async () => {
    const { guard, context, reflector, prisma, request } = setup();
    reflector.getAllAndOverride.mockReturnValue(true);
    request.headers = {};
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
