import { SignatureBusinessType, SignatureRole } from '@prisma/client';
import { SignaturesService } from './signatures.service';

it('does not allow the generic signature endpoint to continue retired probation scoring', async () => {
  const prisma = { signature: { create: jest.fn() }, $transaction: jest.fn() };
  const service = new SignaturesService(prisma as never);
  await expect(service.create({
    businessType: SignatureBusinessType.probation_task,
    businessRecordId: '11111111-1111-4111-8111-111111111111',
    role: SignatureRole.assessor,
  } as never, { id: 'manager-1' } as never)).rejects.toThrow('历史签字仅供查阅');
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
