import supertest from 'supertest';

export interface RoleCredentials {
  employeeNo: string;
  password: string;
}

export async function login(http: supertest.SuperTest<supertest.Test>, credentials: RoleCredentials): Promise<string> {
  const res = await http
    .post('/api/v1/auth/login')
    .send({ employeeNo: credentials.employeeNo, password: credentials.password })
    .expect((response) => {
      if (![200, 201].includes(response.status)) {
        throw new Error(`Expected 200 or 201, got ${response.status}`);
      }
    });

  if (res.body.code !== 0 || !res.body.data?.token) {
    throw new Error(`登录失败 ${credentials.employeeNo}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data.token as string;
}

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}
