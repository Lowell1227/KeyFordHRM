import { EmployeeArchivesService } from './employee-archives.service';
import { EmployeeOnboardingService } from './employee-onboarding.service';

describe('personnel directory submission boundaries', () => {
  it('requires a directory position for a first hire before creating a request', async () => {
    const service = new EmployeeArchivesService({ $transaction: async (run: any) => run({}) } as any);
    await expect(service.createEmployee({ name: 'Synthetic hire', employee: { position: 'Free title' } } as any, {} as any))
      .rejects.toMatchObject({ response: { data: { fieldErrors: { 'employee.positionId': expect.any(String) } } } });
  });

  it('rejects a changed free-text position in reentry instead of creating new legacy data', async () => {
    const service = new EmployeeOnboardingService({} as any, {} as any, {} as any, {} as any);
    await expect((service as any).normalizePosition({}, { positionId: null, position: 'New free title' },
      { positionId: null, position: 'Historical title' })).rejects.toMatchObject({
      response: { data: { fieldErrors: { 'employee.positionId': expect.any(String) } } },
    });
  });
});
