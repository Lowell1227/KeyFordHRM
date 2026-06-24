import { test, expect } from '@playwright/test';

const API_BASE = process.env.PLAYWRIGHT_API_BASE_URL || 'http://localhost:3000/api/v1';

async function api(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok || json.code !== 0) {
    throw new Error(`API ${method} ${path} failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.data;
}

async function login(employeeNo: string) {
  const data = await api('POST', '/auth/login', undefined, { employeeNo, password: '000000' });
  return data.token as string;
}

async function fetchAll<T>(token: string, path: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const data = await api('GET', `${path}${separator}page=${page}&pageSize=100`, token);
    items.push(...data.items);
    if (items.length >= data.total || data.items.length === 0) return items;
  }
}

function formatRunLabel(value = new Date()): string {
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}-${pad(value.getHours())}${pad(value.getMinutes())}`;
}

test.describe('05-multi-role-happy-path', () => {
  test('runs full lifecycle from HR launch to employee confirmation', async () => {
    const hrToken = await login('HR001');
    const employeeToken = await login('EMP001');
    const managerToken = await login('MGR001');
    const approverToken = await login('VP001');

    const users = await fetchAll<{ id: string; employeeNo?: string }>(hrToken, '/users');
    const employee = users.find((user) => user.employeeNo === 'EMP001');
    expect(employee).toBeTruthy();

    const runLabel = formatRunLabel();
    await api('POST', '/templates', hrToken, {
      name: `2026年二季度绩效模板（全流程验证 ${runLabel}）`,
      applicableDepts: [],
      applicableUsers: users.map((user) => user.id),
      maxScore: 100,
      isActive: true,
      dimensions: [
        {
          name: 'KPI',
          type: 'kpi',
          weight: 0.7,
          sortOrder: 0,
          indicators: [{ name: 'KPI A', weight: 1, sortOrder: 0 }],
        },
        {
          name: 'Attitude',
          type: 'attitude',
          weight: 0.3,
          sortOrder: 1,
          indicators: [{ name: 'Attitude A', weight: 1, sortOrder: 0 }],
        },
      ],
    });

    const cycle = await api('POST', '/cycles', hrToken, {
      name: `2026年二季度绩效考核（全流程验证 ${runLabel}）`,
      type: 'quarterly',
      startDate: '2026-04-01',
      endDate: '2026-06-30',
    });

    const launch = await api('POST', `/cycles/${cycle.id}/launch`, hrToken);
    expect(launch.activeTasks).toBeGreaterThan(0);

    const tasks = await fetchAll<{ id: string; employeeId: string; status: string }>(
      hrToken,
      `/tasks?cycleId=${cycle.id}`,
    );
    const task = tasks.find((item) => item.employeeId === employee!.id);
    expect(task?.status).toBe('indicator_setting');

    await api('POST', `/tasks/${task!.id}/indicators/confirm`, employeeToken);

    let detail = await api('GET', `/tasks/${task!.id}`, employeeToken);
    await api('POST', `/tasks/${task!.id}/self-eval`, employeeToken, {
      indicators: detail.indicatorInstances
        .filter((item: { indicatorType: string }) => item.indicatorType !== 'veto')
        .map((item: { id: string }) => ({ id: item.id, selfScore: 82, selfComment: 'self eval ok' })),
      summary: { achievements: 'completed key objectives' },
    });

    detail = await api('GET', `/tasks/${task!.id}`, managerToken);
    const scoreResult = await api('POST', `/tasks/${task!.id}/manager-score`, managerToken, {
      indicators: detail.indicatorInstances
        .filter((item: { indicatorType: string }) => item.indicatorType !== 'veto')
        .map((item: { id: string }) => ({ id: item.id, managerScore: 86, managerComment: 'manager score ok' })),
      evalSummary: { strengths: 'stable delivery' },
    });

    if (scoreResult.status === 'dept_review') {
      const review = await api('POST', `/tasks/${task!.id}/dept-review`, managerToken, {
        action: 'approve',
        comment: 'dept review ok',
      });
      expect(review.status).toBe('hr_calibration');
    } else {
      expect(scoreResult.status).toBe('hr_calibration');
    }

    const calibration = await api('POST', `/cycles/${cycle.id}/calibration`, hrToken, {
      submit: true,
      calibrations: [{ taskId: task!.id, calibratedGrade: 'B', calibrationNote: 'calibration ok' }],
    });
    expect(calibration.submit).toBe(true);

    const approval = await api('POST', `/cycles/${cycle.id}/approval`, approverToken, {
      taskIds: [task!.id],
      comment: 'approval ok',
    });
    expect(approval.approved).toBe(1);

    const publish = await api('POST', `/cycles/${cycle.id}/publish`, hrToken, {
      taskIds: [task!.id],
      sendDingtalkNotification: false,
    });
    expect(publish.published).toBe(1);

    const confirmation = await api('POST', `/tasks/${task!.id}/employee-confirm`, employeeToken);
    expect(confirmation.status).toBe('confirmed');
  });
});
