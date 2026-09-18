import { EmployeeNumberService } from './employee-number.service';

describe('EmployeeNumberService', () => {
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
