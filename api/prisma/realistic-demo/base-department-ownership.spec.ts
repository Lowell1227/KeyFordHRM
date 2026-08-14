import { DEMO_CONFIG } from './config';

const systemConfigUpsert = jest.fn(async () => undefined);
const departmentUpsert = jest.fn(
  async (_request: {
    where: { id: string };
    update: { name: string };
    create: { id: string; name: string };
  }) => undefined,
);
const disconnect = jest.fn(async () => undefined);

jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    PrismaClient: jest.fn(() => ({
      systemConfig: { upsert: systemConfigUpsert },
      department: { upsert: departmentUpsert },
      user: { upsert: jest.fn(async () => undefined) },
      $disconnect: disconnect,
    })),
  };
});

jest.mock('bcrypt', () => ({
  hash: jest.fn(async () => 'unused-test-hash'),
}));

const BEIJING_OFFICE_ID = '00000000-0000-0000-0000-000000000011';
const APPROVED_NAME = '孚德北京办公室';

it('uses the approved Beijing office name in realistic ownership evidence', () => {
  expect(
    DEMO_CONFIG.baseDepartments.find(({ id }) => id === BEIJING_OFFICE_ID),
  ).toEqual({ id: BEIJING_OFFICE_ID, expectedName: APPROVED_NAME });
});

it('upserts the approved Beijing office name from the base seed', async () => {
  jest.isolateModules(() => {
    require('../seed');
  });

  const deadline = Date.now() + 5_000;
  while (disconnect.mock.calls.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(disconnect).toHaveBeenCalledTimes(1);

  const upsert = departmentUpsert.mock.calls
    .map(([request]) => request)
    .find(({ where }) => where.id === BEIJING_OFFICE_ID);

  expect(upsert).toEqual(
    expect.objectContaining({
      update: expect.objectContaining({ name: APPROVED_NAME }),
      create: expect.objectContaining({
        id: BEIJING_OFFICE_ID,
        name: APPROVED_NAME,
      }),
    }),
  );
});
