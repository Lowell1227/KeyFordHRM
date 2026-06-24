/**
 * 通过后端 API 为 Playwright 准备测试数据。
 *
 * 这些函数在测试运行前调用，要求后端已启动并可登录。
 */

const API_BASE = process.env.PLAYWRIGHT_API_BASE_URL || 'http://localhost:3000/api/v1';

export interface ApiSeedContext {
  hrToken: string;
  adminToken: string;
}

async function api(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`API ${method} ${path} failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

export async function login(employeeNo: string, password: string): Promise<string> {
  const res = await api('POST', '/auth/login', undefined, { employeeNo, password });
  return res.data.token;
}

export async function createUsers(adminToken: string) {
  const deptRes = await api('GET', '/departments', adminToken);
  const dept = deptRes.data.items[0];

  const hr = await api('POST', '/users', adminToken, {
    employeeNo: 'HR001',
    name: '测试HR',
    sysRole: 'hr',
    deptId: dept.id,
    password: 'test123',
  });

  const manager = await api('POST', '/users', adminToken, {
    employeeNo: 'MGR001',
    name: '测试主管',
    sysRole: 'manager',
    deptId: dept.id,
    password: 'test123',
  });

  const employee = await api('POST', '/users', adminToken, {
    employeeNo: 'EMP001',
    name: '测试员工',
    sysRole: 'employee',
    deptId: dept.id,
    directManagerId: manager.data.id,
    password: 'test123',
  });

  const approver = await api('POST', '/users', adminToken, {
    employeeNo: 'VP001',
    name: '测试VP',
    sysRole: 'vp',
    deptId: dept.id,
    password: 'test123',
  });

  await api('PATCH', `/departments/${dept.id}/approver`, adminToken, { approverId: approver.data.id });
  await api('PATCH', `/users/${manager.data.id}/role`, adminToken, { sysRole: 'manager' });

  return { dept, hr: hr.data, manager: manager.data, employee: employee.data, approver: approver.data };
}

export async function createTemplate(hrToken: string, deptId: string) {
  return api('POST', '/templates', hrToken, {
    name: '2026年一季度绩效模板（自动化验证）',
    applicableDepts: [deptId],
    applicableUsers: [],
    dimensions: [
      {
        name: 'KPI维度',
        type: 'kpi',
        weight: 0.6,
        sortOrder: 0,
        indicators: [
          { name: '指标A', weight: 0.5, sortOrder: 0 },
          { name: '指标B', weight: 0.5, sortOrder: 1 },
        ],
      },
      {
        name: '态度维度',
        type: 'attitude',
        weight: 0.4,
        sortOrder: 1,
        indicators: [{ name: '指标C', weight: 1, sortOrder: 0 }],
      },
    ],
  });
}

export async function createCycle(hrToken: string) {
  return api('POST', '/cycles', hrToken, {
    name: '2026年一季度绩效考核（自动化验证）',
    type: 'quarterly',
    startDate: '2026-01-01',
    endDate: '2026-03-31',
  });
}

export async function getTaskByEmployee(cycleId: string, employeeNo: string, hrToken: string) {
  const res = await api('GET', `/tasks?cycleId=${cycleId}&keyword=${employeeNo}`, hrToken);
  return res.data.items[0];
}

export async function launchCycle(cycleId: string, hrToken: string) {
  return api('POST', `/cycles/${cycleId}/launch`, hrToken);
}
