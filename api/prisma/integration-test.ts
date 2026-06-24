import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const API_BASE = 'http://localhost:3000/api/v1';

interface TestResult {
  actor: string;
  scenario: string;
  method: string;
  url: string;
  body?: unknown;
  statusCode: number;
  response: unknown;
  pageResult: string;
  passed: boolean;
}

async function login(employeeNo: string, password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeNo, password }),
  });
  const json = await res.json();
  if (json.code !== 0 || !json.data?.token) {
    throw new Error(`Login failed for ${employeeNo}: ${JSON.stringify(json)}`);
  }
  return json.data.token;
}

async function api(method: string, path: string, token: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
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
  return { status: res.status, json };
}

async function main() {
  const results: TestResult[] = [];

  const emp1 = await prisma.user.findUnique({ where: { employeeNo: 'EMP001' } });
  const emp2 = await prisma.user.findUnique({ where: { employeeNo: 'EMP002' } });
  const mgr = await prisma.user.findUnique({ where: { employeeNo: 'MGR001' } });
  const hr = await prisma.user.findUnique({ where: { employeeNo: 'HR001' } });
  const vp = await prisma.user.findUnique({ where: { employeeNo: 'VP001' } });
  if (!emp1 || !emp2 || !mgr || !hr || !vp) throw new Error('测试账号未找到');

  const indicatorConfirmCycle = await prisma.assessmentCycle.findFirst({ where: { name: '指标确认-确认' } });
  const indicatorRejectCycle = await prisma.assessmentCycle.findFirst({ where: { name: '指标确认-退回' } });
  const selfEvalCycle = await prisma.assessmentCycle.findFirst({ where: { name: '自评周期' } });
  const managerCycle = await prisma.assessmentCycle.findFirst({ where: { name: '主管评分周期' } });
  const calibrationCycle = await prisma.assessmentCycle.findFirst({ where: { name: 'HR校准周期' } });
  const approvalCycle = await prisma.assessmentCycle.findFirst({ where: { name: '审批周期' } });

  const indicatorConfirmTask = await prisma.assessmentTask.findFirst({ where: { cycleId: indicatorConfirmCycle?.id, employeeId: emp1.id } });
  const indicatorRejectTask = await prisma.assessmentTask.findFirst({ where: { cycleId: indicatorRejectCycle?.id, employeeId: emp2.id } });
  const selfEvalTask = await prisma.assessmentTask.findFirst({ where: { cycleId: selfEvalCycle?.id, employeeId: emp1.id } });
  const managerTask = await prisma.assessmentTask.findFirst({ where: { cycleId: managerCycle?.id, employeeId: emp1.id } });
  const calibrationTask1 = await prisma.assessmentTask.findFirst({ where: { cycleId: calibrationCycle?.id, employeeId: emp1.id } });
  const calibrationTask2 = await prisma.assessmentTask.findFirst({ where: { cycleId: calibrationCycle?.id, employeeId: emp2.id } });
  const approvalTask1 = await prisma.assessmentTask.findFirst({ where: { cycleId: approvalCycle?.id, employeeId: emp1.id } });
  const approvalTask2 = await prisma.assessmentTask.findFirst({ where: { cycleId: approvalCycle?.id, employeeId: emp2.id } });

  if (!indicatorConfirmTask || !indicatorRejectTask || !selfEvalTask || !managerTask || !calibrationTask1 || !calibrationTask2 || !approvalTask1 || !approvalTask2) {
    throw new Error('测试任务未找到');
  }

  // ========== F3: 员工 ==========
  const empToken = await login('EMP001', 'test123');

  // 1. 确认指标
  {
    const { status, json } = await api('POST', `/tasks/${indicatorConfirmTask.id}/indicators/confirm`, empToken);
    results.push({
      actor: '员工 EMP001',
      scenario: '① 确认指标',
      method: 'POST',
      url: `/tasks/${indicatorConfirmTask.id}/indicators/confirm`,
      statusCode: status,
      response: json,
      pageResult: status >= 200 && status < 300 && json.data?.status === 'self_eval' ? '指标确认成功，任务进入自评阶段' : '失败',
      passed: status >= 200 && status < 300 && json.data?.status === 'self_eval',
    });
  }

  // 2. 退回指标（用 EMP002 登录）
  const emp2Token = await login('EMP002', 'test123');
  {
    const body = { comment: '指标不合理，请修改' };
    const { status, json } = await api('POST', `/tasks/${indicatorRejectTask.id}/indicators/reject`, emp2Token, body);
    results.push({
      actor: '员工 EMP002',
      scenario: '① 退回指标',
      method: 'POST',
      url: `/tasks/${indicatorRejectTask.id}/indicators/reject`,
      body,
      statusCode: status,
      response: json,
      pageResult: status >= 200 && status < 300 && json.data?.status === 'indicator_setting' ? '指标退回成功，任务回到指标制定阶段' : '失败',
      passed: status >= 200 && status < 300 && json.data?.status === 'indicator_setting',
    });
  }

  // 3. 自评提交
  const selfEvalInstances = await prisma.indicatorInstance.findMany({ where: { taskId: selfEvalTask.id } });
  const actualValues = selfEvalInstances.map((inst) => ({
    id: inst.id,
    actualValue: '95',
    actualNote: '已完成目标',
  }));
  const selfEvalBody = {
    indicators: selfEvalInstances.filter((i) => i.indicatorType !== 'veto').map((inst) => ({
      id: inst.id,
      selfScore: 90,
      selfComment: '自评说明',
    })),
    summary: {
      achievements: '完成了销售目标',
      improvements: '需提升客户沟通',
      suggestions: '增加培训',
      nextGoals: '下季度增长20%',
      supportNeeded: '需要资源支持',
    },
  };

  {
    const { status, json } = await api('PUT', `/tasks/${selfEvalTask.id}/actual-value`, empToken, { indicators: actualValues });
    results.push({
      actor: '员工 EMP001',
      scenario: '① 自评-更新实际完成值',
      method: 'PUT',
      url: `/tasks/${selfEvalTask.id}/actual-value`,
      body: { indicators: actualValues },
      statusCode: status,
      response: json,
      pageResult: status >= 200 && status < 300 ? '实际完成值保存成功' : '失败',
      passed: status >= 200 && status < 300,
    });
  }

  {
    const { status, json } = await api('POST', `/tasks/${selfEvalTask.id}/self-eval`, empToken, selfEvalBody);
    results.push({
      actor: '员工 EMP001',
      scenario: '① 自评-提交自评',
      method: 'POST',
      url: `/tasks/${selfEvalTask.id}/self-eval`,
      body: selfEvalBody,
      statusCode: status,
      response: json,
      pageResult: status >= 200 && status < 300 && json.data?.status === 'manager_scoring' ? '自评提交成功，任务进入主管评分阶段' : '失败',
      passed: status >= 200 && status < 300 && json.data?.status === 'manager_scoring',
    });
  }

  // ========== F4: 主管 ==========
  const mgrToken = await login('MGR001', 'test123');
  {
    const managerInstances = await prisma.indicatorInstance.findMany({ where: { taskId: managerTask.id } });
    const managerBody = {
      indicators: managerInstances.filter((i) => i.indicatorType !== 'veto').map((inst) => ({
        id: inst.id,
        managerScore: 88,
        managerComment: '主管评分说明',
        extraScores: inst.indicatorType === 'bonus' ? [{ label: '额外贡献', value: 5 }] : undefined,
      })),
      evalSummary: {
        strengths: '工作积极主动',
        improvements: '时间管理待加强',
        developmentPlan: '参加时间管理培训',
      },
      veto: { isVeto: true, vetoReason: '发生重大客户投诉' },
    };

    const { status, json } = await api('POST', `/tasks/${managerTask.id}/manager-score`, mgrToken, managerBody);
    results.push({
      actor: '主管 MGR001',
      scenario: '② 主管评分+加减分+一票否决',
      method: 'POST',
      url: `/tasks/${managerTask.id}/manager-score`,
      body: managerBody,
      statusCode: status,
      response: json,
      pageResult: status >= 200 && status < 300 && ['dept_review', 'hr_calibration'].includes(json.data?.status) ? '主管评分提交成功，任务进入下一环节' : '失败',
      passed: status >= 200 && status < 300 && ['dept_review', 'hr_calibration'].includes(json.data?.status),
    });
  }

  // ========== F5: HR 校准 ==========
  const hrToken = await login('HR001', 'test123');

  {
    const { status, json } = await api('GET', `/cycles/${calibrationCycle!.id}/calibration`, hrToken);
    results.push({
      actor: 'HR HR001',
      scenario: '③ 校准-获取工作台',
      method: 'GET',
      url: `/cycles/${calibrationCycle!.id}/calibration`,
      statusCode: status,
      response: json,
      pageResult: status >= 200 && status < 300 && Array.isArray(json.data?.items) ? `校准工作台加载成功，共 ${json.data?.items?.length} 人` : '失败',
      passed: status >= 200 && status < 300 && Array.isArray(json.data?.items),
    });
  }

  {
    const { status, json } = await api('GET', `/cycles/${calibrationCycle!.id}/grade-distribution`, hrToken);
    results.push({
      actor: 'HR HR001',
      scenario: '③ 校准-获取等级分布',
      method: 'GET',
      url: `/cycles/${calibrationCycle!.id}/grade-distribution`,
      statusCode: status,
      response: json,
      pageResult: status >= 200 && status < 300 && json.data?.A != null ? '等级分布加载成功' : '失败',
      passed: status >= 200 && status < 300 && json.data?.A != null,
    });
  }

  {
    const calibBody = {
      submit: true,
      calibrations: [
        {
          taskId: calibrationTask1.id,
          calibratedGrade: 'A',
          calibrationNote: '表现优异，破格提升',
          isVeto: false,
        },
        {
          taskId: calibrationTask2.id,
          calibratedGrade: 'A',
          calibrationNote: '表现优异',
          isVeto: false,
        },
      ],
    };
    const { status, json } = await api('POST', `/cycles/${calibrationCycle!.id}/calibration`, hrToken, calibBody);
    results.push({
      actor: 'HR HR001',
      scenario: '③ 校准-提交校准（触发分布告警）',
      method: 'POST',
      url: `/cycles/${calibrationCycle!.id}/calibration`,
      body: calibBody,
      statusCode: status,
      response: json,
      pageResult: status >= 200 && status < 300 && json.data?.submit === true ? `校准提交成功，更新 ${json.data?.updated} 条，告警 ${json.data?.warnings?.length || 0} 条` : '失败',
      passed: status >= 200 && status < 300 && json.data?.submit === true,
    });
  }

  // ========== F6: VP 审批 ==========
  const vpToken = await login('VP001', 'test123');

  {
    const { status, json } = await api('GET', `/cycles/${approvalCycle!.id}/approval`, vpToken);
    results.push({
      actor: 'VP VP001',
      scenario: '④ 审批-获取审批列表',
      method: 'GET',
      url: `/cycles/${approvalCycle!.id}/approval`,
      statusCode: status,
      response: json,
      pageResult: status >= 200 && status < 300 && Array.isArray(json.data) ? `审批列表加载成功，共 ${json.data?.length} 条` : '失败',
      passed: status >= 200 && status < 300 && Array.isArray(json.data),
    });
  }

  {
    const approveBody = { taskIds: [approvalTask1.id], comment: '同意' };
    const { status, json } = await api('POST', `/cycles/${approvalCycle!.id}/approval`, vpToken, approveBody);
    results.push({
      actor: 'VP VP001',
      scenario: '④ 审批-批量通过',
      method: 'POST',
      url: `/cycles/${approvalCycle!.id}/approval`,
      body: approveBody,
      statusCode: status,
      response: json,
      pageResult: status >= 200 && status < 300 && json.data?.approved === 1 ? '批量通过成功' : '失败',
      passed: status >= 200 && status < 300 && json.data?.approved === 1,
    });
  }

  {
    const rejectBody = { comment: '数据存疑，请重新校准' };
    const { status, json } = await api('POST', `/tasks/${approvalTask2.id}/approval/reject`, vpToken, rejectBody);
    results.push({
      actor: 'VP VP001',
      scenario: '④ 审批-单条退回',
      method: 'POST',
      url: `/tasks/${approvalTask2.id}/approval/reject`,
      body: rejectBody,
      statusCode: status,
      response: json,
      pageResult: status >= 200 && status < 300 && json.data?.status === 'hr_calibration' ? '单条退回成功，任务回到 HR 校准' : '失败',
      passed: status >= 200 && status < 300 && json.data?.status === 'hr_calibration',
    });
  }

  // 打印报告
  console.log('\n========== B2-FIX 真后端联调报告 ==========\n');
  let passCount = 0;
  let failCount = 0;
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} [${r.actor}] ${r.scenario}`);
    console.log(`   请求: ${r.method} ${r.url}`);
    if (r.body) console.log(`   请求体: ${JSON.stringify(r.body)}`);
    console.log(`   响应码: ${r.statusCode}`);
    console.log(`   响应体: ${JSON.stringify(r.response)}`);
    console.log(`   页面结果: ${r.pageResult}`);
    console.log();
    if (r.passed) passCount++; else failCount++;
  }
  console.log(`总计: ${passCount} 通过, ${failCount} 失败`);
  if (failCount > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
