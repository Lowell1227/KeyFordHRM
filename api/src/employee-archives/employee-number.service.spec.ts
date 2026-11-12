import { EmployeeNumberService } from './employee-number.service';

describe('EmployeeNumberService', () => {
  it('renews the released slot without inserting a second source request and returns its history', async () => {
    const previous = { id: 'n1', sourceRequestId: 'r1', userId: 'u1', employeeNo: '358',
      status: 'released', releasedAt: new Date('2026-11-11T00:00:00Z') };
    const tx: any = { $queryRaw: jest.fn().mockResolvedValue([{ value: 359n }]), employeeNumberAssignment: {
      findFirst: jest.fn().mockResolvedValue(previous), create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    } };
    const result = await new EmployeeNumberService().renewReleasedReservation(tx, 'r1', 'u1');
    expect(result).toEqual({ employeeNo: '359', previousAssignment: previous });
    expect(tx.employeeNumberAssignment.create).not.toHaveBeenCalled();
    expect(tx.employeeNumberAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: 'n1', sourceRequestId: 'r1', userId: 'u1', employeeNo: '358', status: 'released' },
      data: { employeeNo: '359', status: 'reserved', releasedAt: null, effectiveFrom: null, effectiveTo: null },
    });
  });

  it.each([null, { status: 'current' }, { status: 'reserved' }])('does not renew a missing or occupied reservation: %j', async previous => {
    const tx: any = { $queryRaw: jest.fn(), employeeNumberAssignment: {
      findFirst: jest.fn().mockResolvedValue(previous), updateMany: jest.fn(),
    } };
    await expect(new EmployeeNumberService().renewReleasedReservation(tx, 'r1', 'u1')).rejects.toThrow();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.employeeNumberAssignment.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale released slot instead of issuing a number', async () => {
    const tx: any = { $queryRaw: jest.fn().mockResolvedValue([{ value: 359n }]), employeeNumberAssignment: {
      findFirst: jest.fn().mockResolvedValue({ id: 'n1', status: 'released', employeeNo: '358' }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    } };
    await expect(new EmployeeNumberService().renewReleasedReservation(tx, 'r1', 'u1')).rejects.toThrow();
  });

  it('reserves the next sequence number and never rewinds it on release', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ value: 358n }]),
      $executeRaw: jest.fn(),
      employeeNumberAssignment: {
        create: jest.fn().mockResolvedValue({ employeeNo: '358' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as any;
    const service = new EmployeeNumberService();
    await expect(service.reserveNext(tx, 'request-1')).resolves.toBe('358');
    await service.releaseReservation(tx, 'request-1', new Date('2026-09-18T08:00:00Z'));
    expect(tx.employeeNumberAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ employeeNo: '358', status: 'reserved', sourceRequestId: 'request-1' }),
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
