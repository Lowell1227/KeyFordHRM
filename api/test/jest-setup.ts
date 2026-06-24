import 'reflect-metadata';

jest.setTimeout(120000);

beforeAll(() => {
  // 任何 suite 级别的全局前置可放这里
});

afterAll(async () => {
  // jest globalSetup/teardown 已负责容器生命周期
});
