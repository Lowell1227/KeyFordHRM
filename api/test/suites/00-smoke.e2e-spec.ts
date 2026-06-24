import { buildTestApp, closeTestApp, TestApp } from '../test-app';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { login } from '../helpers/auth-helper';

describe('E2E smoke', () => {
  let app: TestApp;
  let factory: FixtureFactory;

  beforeAll(async () => {
    app = await buildTestApp();
    factory = new FixtureFactory(app.prisma);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await factory.resetDataTables();
  });

  it('health check returns ok', async () => {
    const res = await app.http.get('/api/v1/health').expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.status).toBe('ok');
  });

  it('can create user and login', async () => {
    const dept = await factory.getSeedDept();
    await factory.createUser({
      employeeNo: 'SMOKE001',
      name: '冒烟用户',
      sysRole: 'employee',
      deptId: dept.id,
      password: 'test123',
    });

    const token = await login(app.http, { employeeNo: 'SMOKE001', password: 'test123' });
    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThan(10);

    const me = await app.http.get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body.data.employeeNo).toBe('SMOKE001');
  });
});
