# 钉钉日报分析模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 构建仅供 HR 和系统管理员使用的独立钉钉日报分析模块，支持 90 天首次补拉、每日增量同步、规则与 AI 混合评分、公司/部门/个人排名比较以及日周月自动总结，且与绩效数据完全隔离。

**Architecture:** 后端新增独立 daily-reports NestJS 模块，以钉钉 reportId 幂等保存原始日报，以“员工工作日聚合记录”作为评分最小单位，通过持久化数据库任务执行同步和 AI 分析。前端新增独立 /daily-reports 页面，在“分析与设置”模块下提供全公司概览、部门对比、个人对比、日报明细和日历豁免配置。

**Tech Stack:** NestJS 10、Prisma 5、PostgreSQL 14、Jest、Vue 3、Element Plus、ECharts 5、Playwright、OpenAI API 兼容 HTTP 接口。

**Spec:** docs/superpowers/specs/2026-08-18-daily-report-analysis-design.md

## Global Constraints

- 日报仅关联 users 和 departments；不得增加 assessment_cycles、assessment_tasks、indicator_instances、grade_results、performance_archives 或绩效 reports 的外键、查询或页面入口。
- 所有 /api/v1/daily-reports/* 接口仅允许 SysRole.hr 和 SysRole.system_admin；canViewAll 不扩大日报权限。
- 固定提示文案为“日报评分仅用于工作信息质量分析和管理参考，不进入绩效考核。”
- 所有 Cron 显式使用 timeZone: 'Asia/Shanghai'。
- 首次同步固定回看 90 天；每日同步固定回看最近 3 个自然日。
- 评分版本常量从 DAILY_REPORT_RUBRIC_VERSION='1.0.0' 和 DAILY_REPORT_PROMPT_VERSION='1.0.0' 开始。
- AI 密钥仅从 DAILY_REPORT_AI_API_KEY 读取；不得写入数据库、日志、审计或前端。
- AI 输出必须经过结构校验；无效结果不得产生默认分。
- 自动化测试不得访问真实钉钉、真实 AI 服务或真实员工日报。
- 当前工作树已有用户修改。每次提交前执行 git diff --cached --name-only，只暂存本任务列出的文件，不格式化或提交无关文件。
- 新增代码遵循测试先行：先看到目标测试因功能缺失而失败，再写最小实现并验证通过。

---

## File Structure

### Backend persistence and domain

- api/prisma/schema.prisma：新增日报枚举、模型以及 User/Department 反向关系。
- api/prisma/migrations/20260818000001_add_daily_report_analysis/migration.sql：创建日报表、约束、索引和外键。
- api/src/daily-reports/daily-report.types.ts：跨服务共享的领域类型。
- api/src/daily-reports/daily-report-scoring.ts：纯函数评分、部门分和稳定排名。
- api/src/daily-reports/daily-report-calendar.service.ts：工作日、人员资格、日期解析和员工日记录物化。
- api/src/daily-reports/dingtalk-report.client.ts：钉钉日志分页客户端。
- api/src/daily-reports/daily-report-sync.service.ts：90 天补拉、3 天增量和幂等写入。
- api/src/daily-reports/daily-report-redaction.ts：发送 AI 前的敏感信息脱敏。
- api/src/daily-reports/daily-report-ai.provider.ts：OpenAI 兼容接口、JSON Schema 校验和总结调用。
- api/src/daily-reports/daily-report-analysis.service.ts：员工日内容合并、AI 分析和版本持久化。
- api/src/daily-reports/daily-report-snapshot.service.ts：日周月指标、部门分、排名和快照。
- api/src/daily-reports/daily-report-jobs.service.ts：任务入队、领取、心跳、完成和重试。
- api/src/daily-reports/daily-report-worker.service.ts：按任务类型调用同步/分析服务。
- api/src/daily-reports/daily-report-scheduler.service.ts：08:00、08:30、周一 09:00、每月 1 日 09:00 调度。
- api/src/daily-reports/daily-reports.service.ts：查询、比较、人工调整、日历和豁免业务接口。
- api/src/daily-reports/daily-reports.controller.ts：HR/系统管理员 REST API。
- api/src/daily-reports/daily-reports.module.ts：模块装配。
- api/src/daily-reports/dto/*.ts：查询和写操作 DTO。

### Frontend

- web/src/api/daily-reports.api.ts：日报 API 客户端。
- web/src/types/api.types.ts：日报 API 类型。
- web/src/router/routes.ts：仅 HR/系统管理员的 /daily-reports 路由。
- web/src/views/daily-reports/DailyReportAnalysisView.vue：页面壳、周期切换和标签页。
- web/src/views/daily-reports/DailyReportOverview.vue：公司概览、AI 综述和排名。
- web/src/views/daily-reports/DailyReportComparison.vue：部门/个人并列比较。
- web/src/views/daily-reports/DailyReportList.vue：员工日报日记录列表。
- web/src/views/daily-reports/DailyReportDetailDrawer.vue：原文、依据、版本和人工调整。
- web/src/views/daily-reports/DailyReportSettings.vue：工作日例外、补班和人员豁免。
- web/src/components/charts/DailyReportTrendChart.vue：日报分和覆盖率趋势。
- web/src/components/charts/DailyReportDimensionChart.vue：七维对比雷达图。
- web/e2e/specs/20-daily-report-analysis.spec.ts：页面合同和响应式验收。

### Tests and operations

- api/src/daily-reports/*.spec.ts：领域服务单元测试。
- api/test/suites/20-daily-reports.e2e-spec.ts：权限和接口集成测试。
- api/test/test-app.ts：覆盖日报外部 provider，禁止测试联网。
- api/test/fixtures/fixture-factory.ts：清理日报测试表。
- .env.example：日报模板、日期字段和 AI 配置示例。
- docs/operations/daily-report-analysis.md：上线权限、首次补拉、监控和故障处理手册。

---

### Task 1: Persistence schema and scoring primitives

**Files:**
- Modify: api/prisma/schema.prisma
- Create: api/prisma/migrations/20260818000001_add_daily_report_analysis/migration.sql
- Create: api/src/daily-reports/daily-report.types.ts
- Create: api/src/daily-reports/daily-report-scoring.spec.ts
- Create: api/src/daily-reports/daily-report-scoring.ts

**Interfaces:**
- Consumes: PrismaService database connection and the User/Department UUID keys already defined in schema.prisma.
- Produces: DailyContentScores, RankableRow, calculateDailyScore(), calculatePeriodScore(), calculateDepartmentScore(), rankRows(), plus generated Prisma delegates for all daily report models.

- [ ] **Step 1: Write the failing scoring tests**

Create api/src/daily-reports/daily-report-scoring.spec.ts with the target public API:

~~~typescript
import {
  calculateDailyScore,
  calculateDepartmentScore,
  calculatePeriodScore,
  rankRows,
} from './daily-report-scoring';

const content = {
  completeness: 12,
  evidence: 20,
  risk: 10,
  plan: 11,
  collaboration: 8,
  readability: 9,
};

describe('daily report scoring', () => {
  it('adds the deterministic timeliness score to the 90-point content score', () => {
    expect(calculateDailyScore({ required: true, submitted: true, timelinessScore: 10, contentScores: content }))
      .toBe(80);
  });

  it('returns zero for a required day with no report', () => {
    expect(calculateDailyScore({ required: true, submitted: false, timelinessScore: 0, contentScores: null }))
      .toBe(0);
  });

  it('averages all required days and keeps missing days as zero', () => {
    expect(calculatePeriodScore([
      { required: true, finalScore: 80 },
      { required: true, finalScore: 0 },
      { required: false, finalScore: null },
    ])).toBe(40);
  });

  it('calculates the approved 20/60/10/10 department score', () => {
    expect(calculateDepartmentScore({
      requiredPersonDays: 10,
      submittedPersonDays: 8,
      submittedContentScores: [72, 81],
      riskPlanScore: 8,
      collaborationScore: 7,
    })).toBe(82);
  });

  it('breaks ranking ties by coverage, late count, then name', () => {
    expect(rankRows([
      { id: 'b', name: '乙', score: 90, submissionRate: 1, lateCount: 1 },
      { id: 'a', name: '甲', score: 90, submissionRate: 1, lateCount: 0 },
    ]).map((row) => row.id)).toEqual(['a', 'b']);
  });
});
~~~

- [ ] **Step 2: Run the test and verify the RED state**

Run:

~~~powershell
Set-Location api
npx jest src/daily-reports/daily-report-scoring.spec.ts --runInBand
~~~

Expected: FAIL with Cannot find module './daily-report-scoring'.

- [ ] **Step 3: Add the minimal scoring implementation**

Create api/src/daily-reports/daily-report.types.ts:

~~~typescript
export interface DailyContentScores {
  completeness: number;
  evidence: number;
  risk: number;
  plan: number;
  collaboration: number;
  readability: number;
}

export interface RankableRow {
  id: string;
  name: string;
  score: number;
  submissionRate: number;
  lateCount: number;
}
~~~

Create api/src/daily-reports/daily-report-scoring.ts with range validation and deterministic rounding:

~~~typescript
import { DailyContentScores, RankableRow } from './daily-report.types';

const limits: DailyContentScores = {
  completeness: 15,
  evidence: 25,
  risk: 15,
  plan: 15,
  collaboration: 10,
  readability: 10,
};

export function sumContentScores(scores: DailyContentScores): number {
  for (const key of Object.keys(limits) as Array<keyof DailyContentScores>) {
    if (!Number.isFinite(scores[key]) || scores[key] < 0 || scores[key] > limits[key]) {
      throw new Error('日报评分维度超出范围: ' + key);
    }
  }
  return Object.values(scores).reduce((sum, value) => sum + value, 0);
}

export function calculateDailyScore(input: {
  required: boolean;
  submitted: boolean;
  timelinessScore: 0 | 10;
  contentScores: DailyContentScores | null;
}): number | null {
  if (!input.required) return null;
  if (!input.submitted) return 0;
  if (!input.contentScores) throw new Error('已提交日报缺少内容评分');
  return input.timelinessScore + sumContentScores(input.contentScores);
}

export function calculatePeriodScore(days: Array<{ required: boolean; finalScore: number | null }>): number | null {
  const required = days.filter((day) => day.required);
  if (required.length === 0) return null;
  return Number((required.reduce((sum, day) => sum + (day.finalScore ?? 0), 0) / required.length).toFixed(2));
}

export function calculateDepartmentScore(input: {
  requiredPersonDays: number;
  submittedPersonDays: number;
  submittedContentScores: number[];
  riskPlanScore: number;
  collaborationScore: number;
}): number {
  if (input.requiredPersonDays === 0 || input.submittedPersonDays === 0) return 0;
  const coverage = input.submittedPersonDays / input.requiredPersonDays * 20;
  const contentAverage = input.submittedContentScores.reduce((a, b) => a + b, 0) / input.submittedContentScores.length;
  return Number((coverage + contentAverage / 90 * 60 + input.riskPlanScore + input.collaborationScore).toFixed(2));
}

export function rankRows<T extends RankableRow>(rows: T[]): Array<T & { rank: number }> {
  return [...rows]
    .sort((a, b) => b.score - a.score || b.submissionRate - a.submissionRate || a.lateCount - b.lateCount || a.name.localeCompare(b.name, 'zh-CN'))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
~~~

Extend schema.prisma with the enums and eight models from the spec. Use explicit enum names:

~~~prisma
enum DailyReportDateSource { template_field create_time @@map("daily_report_date_source") }
enum DailyReportMappingStatus { mapped unmatched @@map("daily_report_mapping_status") }
enum DailyReportSubmissionStatus { missing on_time late @@map("daily_report_submission_status") }
enum DailyReportAnalysisStatus { pending completed failed @@map("daily_report_analysis_status") }
enum DailyReportPeriodType { day week month @@map("daily_report_period_type") }
enum DailyReportScopeType { company department employee @@map("daily_report_scope_type") }
enum DailyReportJobStatus { pending running completed failed @@map("daily_report_job_status") }
enum DailyReportJobType { initial_sync daily_sync analyze_day analyze_week analyze_month reanalyze_day @@map("daily_report_job_type") }
~~~

Add models DailyReport, DailyReportDayRecord, DailyReportAnalysis, DailyReportReview, DailyReportPeriodSnapshot, DailyReportJob, DailyReportCalendarException and DailyReportUserExemption exactly as section 7 of the spec. Add dedupKey String? @unique to DailyReportJob and the unique constraints:

~~~prisma
@@unique([employeeId, businessDate])
@@unique([dayRecordId, inputHash, rubricVersion, promptVersion, model])
@@unique([date])
~~~

Add only User/Department reverse relations named DailyReportEmployee, DailyReportDayEmployee, DailyReportReviewer, DailyReportExemptionUser and DailyReportDepartment. The migration must use ON DELETE SET NULL for raw report snapshots and ON DELETE CASCADE for analyses, reviews, jobs owned by the module, and must not reference a performance table.

- [ ] **Step 4: Generate Prisma, validate migration shape, and run GREEN**

Run:

~~~powershell
Set-Location api
npx prisma format
npx prisma generate
npx prisma validate
npx jest src/daily-reports/daily-report-scoring.spec.ts --runInBand
~~~

Expected: Prisma validation succeeds and the five scoring tests PASS.

- [ ] **Step 5: Commit only persistence and scoring files**

~~~powershell
git add api/prisma/schema.prisma api/prisma/migrations/20260818000001_add_daily_report_analysis api/src/daily-reports/daily-report.types.ts api/src/daily-reports/daily-report-scoring.ts api/src/daily-reports/daily-report-scoring.spec.ts
git diff --cached --name-only
git commit -m "feat(api): add daily report persistence and scoring"
~~~

---

### Task 2: Work calendar, business-date resolution, and employee-day materialization

**Files:**
- Create: api/src/daily-reports/daily-report-calendar.service.spec.ts
- Create: api/src/daily-reports/daily-report-calendar.service.ts
- Create: api/src/daily-reports/daily-report.config.ts

**Interfaces:**
- Consumes: PrismaService and DailyReportDayRecord delegate from Task 1.
- Produces: DailyReportConfig, resolveBusinessDate(), isRequiredDate(), materializeRequiredDay(), and attachReportsToDayRecords().

- [ ] **Step 1: Write failing calendar tests**

Create api/src/daily-reports/daily-report-calendar.service.spec.ts:

~~~typescript
import { DailyReportCalendarService } from './daily-report-calendar.service';

describe('DailyReportCalendarService', () => {
  const prisma: any = {
    dailyReportCalendarException: { findUnique: jest.fn() },
    dailyReportUserExemption: { findFirst: jest.fn() },
    user: { findMany: jest.fn() },
    dailyReportDayRecord: { upsert: jest.fn() },
  };
  const service = new DailyReportCalendarService(prisma, {
    dateFieldNames: ['日报日期', '工作日期'],
    templateNames: ['日报'],
  } as any);

  beforeEach(() => jest.clearAllMocks());

  it('uses an exact configured template date field before createTime', () => {
    expect(service.resolveBusinessDate(
      [{ key: '日报日期', value: '2026-08-17', sort: 0, type: 1 }],
      new Date('2026-08-18T01:00:00+08:00'),
    )).toEqual({ businessDate: '2026-08-17', source: 'template_field' });
  });

  it('falls back to the Asia/Shanghai create date', () => {
    expect(service.resolveBusinessDate([], new Date('2026-08-17T16:30:00.000Z')))
      .toEqual({ businessDate: '2026-08-18', source: 'create_time' });
  });

  it('treats a weekend as non-required unless a workday exception exists', async () => {
    prisma.dailyReportCalendarException.findUnique.mockResolvedValue(null);
    await expect(service.isRequiredDate('2026-08-22')).resolves.toBe(false);
    prisma.dailyReportCalendarException.findUnique.mockResolvedValue({ isWorkday: true });
    await expect(service.isRequiredDate('2026-08-22')).resolves.toBe(true);
  });

  it('creates a missing day record for each eligible real DingTalk user', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', deptId: 'd1' }]);
    prisma.dailyReportDayRecord.upsert.mockResolvedValue({});
    await expect(service.materializeRequiredDay('2026-08-18')).resolves.toBe(1);
    expect(prisma.dailyReportDayRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { employeeId_businessDate: { employeeId: 'u1', businessDate: new Date('2026-08-18') } },
      create: expect.objectContaining({ submissionStatus: 'missing', timelinessScore: 0 }),
    }));
  });
});
~~~

- [ ] **Step 2: Run and verify RED**

~~~powershell
Set-Location api
npx jest src/daily-reports/daily-report-calendar.service.spec.ts --runInBand
~~~

Expected: FAIL because DailyReportCalendarService does not exist.

- [ ] **Step 3: Implement configuration and calendar service**

daily-report.config.ts must parse comma-separated exact names without logging credentials:

~~~typescript
import { ConfigService } from '@nestjs/config';

export interface DailyReportConfig {
  templateNames: string[];
  dateFieldNames: string[];
}

export function loadDailyReportConfig(config: ConfigService): DailyReportConfig {
  const split = (value: string | undefined, fallback: string[]) =>
    (value ? value.split(',') : fallback).map((item) => item.trim()).filter(Boolean);
  return {
    templateNames: split(config.get('DAILY_REPORT_TEMPLATE_NAMES'), ['日报']),
    dateFieldNames: split(config.get('DAILY_REPORT_DATE_FIELD_NAMES'), ['日报日期', '工作日期']),
  };
}
~~~

Implement DailyReportCalendarService with dayjs timezone-safe formatting using the process timezone-independent Intl API:

~~~typescript
private shanghaiDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}
~~~

materializeRequiredDay() must query users with deletedAt null, dingtalkId not null, entryDate <= end of date when present, leaveDate >= date when present, and exclude a matching DailyReportUserExemption. Do not use sysRole as an eligibility filter. Upsert missing records only; never overwrite a record already marked on_time or late.

- [ ] **Step 4: Run calendar tests and Prisma type-check**

~~~powershell
Set-Location api
npx jest src/daily-reports/daily-report-calendar.service.spec.ts --runInBand
npm run build
~~~

Expected: calendar tests PASS and the Nest build succeeds.

- [ ] **Step 5: Commit calendar files**

~~~powershell
git add api/src/daily-reports/daily-report-calendar.service.ts api/src/daily-reports/daily-report-calendar.service.spec.ts api/src/daily-reports/daily-report.config.ts
git diff --cached --name-only
git commit -m "feat(api): materialize daily report workdays"
~~~

---

### Task 3: DingTalk report client and idempotent synchronization

**Files:**
- Create: api/src/daily-reports/dingtalk-report.client.spec.ts
- Create: api/src/daily-reports/dingtalk-report.client.ts
- Create: api/src/daily-reports/daily-report-sync.service.spec.ts
- Create: api/src/daily-reports/daily-report-sync.service.ts

**Interfaces:**
- Consumes: DingtalkService.getAccessToken(), DailyReportCalendarService, PrismaService and DailyReportConfig.
- Produces: DingTalkReportItem, DingTalkReportPage, DingtalkReportClient.fetchPage(), DailyReportSyncService.syncRange(), runInitialSync(), runDailySync().

- [ ] **Step 1: Write failing client and sync tests**

The client spec must prove endpoint, filters and pagination fields:

~~~typescript
it('queries the configured daily template with a bounded time range', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ errcode: 0, result: { data_list: [], has_more: false, next_cursor: 0 } }),
  }) as any;
  const client = new DingtalkReportClient({ getAccessToken: async () => 'token' } as any);
  await client.fetchPage({
    startTime: 1,
    endTime: 2,
    cursor: 0,
    size: 100,
    templateName: '日报',
  });
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/topapi/report/list?access_token=token'),
    expect.objectContaining({ method: 'POST' }),
  );
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual({
    start_time: 1,
    end_time: 2,
    cursor: 0,
    size: 100,
    template_name: '日报',
  });
});
~~~

The sync spec must prove unknown-user preservation, content-hash idempotency, update invalidation, and no deletion on partial failure:

~~~typescript
it('stores an unmatched report instead of dropping it', async () => {
  client.fetchPage.mockResolvedValue({
    items: [reportFixture({ reportId: 'r1', creatorId: 'ding-missing' })],
    hasMore: false,
    nextCursor: 0,
  });
  prisma.user.findUnique.mockResolvedValue(null);
  await service.syncRange({ start: new Date('2026-08-17'), end: new Date('2026-08-18') });
  expect(prisma.dailyReport.upsert).toHaveBeenCalledWith(expect.objectContaining({
    create: expect.objectContaining({ sourceReportId: 'r1', mappingStatus: 'unmatched', employeeId: null }),
  }));
  expect(prisma.dailyReport.deleteMany).not.toHaveBeenCalled();
});
~~~

- [ ] **Step 2: Run and verify RED**

~~~powershell
Set-Location api
npx jest src/daily-reports/dingtalk-report.client.spec.ts src/daily-reports/daily-report-sync.service.spec.ts --runInBand
~~~

Expected: FAIL because both production modules are missing.

- [ ] **Step 3: Implement the client and sync service**

DingtalkReportClient.fetchPage() must POST to the legacy endpoint already compatible with the repository's DingTalk token:

~~~typescript
export interface DingTalkReportItem {
  reportId: string;
  creatorId: string;
  creatorName: string;
  deptName: string | null;
  templateName: string;
  createTime: number;
  modifiedTime: number;
  contents: Array<{ key: string; value: string; sort: number; type: number }>;
}

export interface DingTalkReportPage {
  items: DingTalkReportItem[];
  hasMore: boolean;
  nextCursor: number;
}
~~~

Map snake_case fields at the client boundary. Throw an Error containing only errcode and errmsg when HTTP or DingTalk status fails; do not include response contents.

DailyReportSyncService must:

1. Iterate every configured exact template name.
2. Read all pages with size 100.
3. Normalize contents by sort, key, type and value before SHA-256.
4. Resolve businessDate through DailyReportCalendarService.
5. Look up User by dingtalkId and Department by current user.deptId.
6. Upsert by sourceReportId.
7. Skip analysis invalidation when modifiedAt and contentHash are unchanged.
8. On changed content, clear no history; enqueue/recreate the day aggregate by updating combinedContentHash in Task 4.
9. Never call deleteMany or mark a report missing because it was absent from a response.

Use exact range helpers:

~~~typescript
runInitialSync(now = new Date()) {
  return this.syncRange({ start: addDays(now, -90), end: now });
}

runDailySync(now = new Date()) {
  return this.syncRange({ start: addDays(now, -3), end: now });
}
~~~

Implement addDays with Date arithmetic in a local helper; start/end are query timestamps, while businessDate remains Asia/Shanghai-derived.

- [ ] **Step 4: Run focused tests and build**

~~~powershell
Set-Location api
npx jest src/daily-reports/dingtalk-report.client.spec.ts src/daily-reports/daily-report-sync.service.spec.ts --runInBand
npm run build
~~~

Expected: both specs PASS and no existing DingTalk service file needs modification.

- [ ] **Step 5: Commit synchronization files**

~~~powershell
git add api/src/daily-reports/dingtalk-report.client.ts api/src/daily-reports/dingtalk-report.client.spec.ts api/src/daily-reports/daily-report-sync.service.ts api/src/daily-reports/daily-report-sync.service.spec.ts
git diff --cached --name-only
git commit -m "feat(api): sync DingTalk daily reports"
~~~

---

### Task 4: Sensitive-data redaction and AI employee-day analysis

**Files:**
- Create: api/src/daily-reports/daily-report-redaction.spec.ts
- Create: api/src/daily-reports/daily-report-redaction.ts
- Create: api/src/daily-reports/daily-report-ai.provider.spec.ts
- Create: api/src/daily-reports/daily-report-ai.provider.ts
- Create: api/src/daily-reports/daily-report-analysis.service.spec.ts
- Create: api/src/daily-reports/daily-report-analysis.service.ts

**Interfaces:**
- Consumes: ConfigService, DailyReportDayRecord with linked raw reports, PrismaService, scoring primitives.
- Produces: redactDailyReportText(), DailyReportAiResult, ScopeSummaryResult, DailyReportAiProvider.analyzeEmployeeDay(), summarizeScope(), DailyReportAnalysisService.analyzeDayRecord().

- [ ] **Step 1: Write failing redaction and AI validation tests**

~~~typescript
it('redacts phone, email, ID-card-like and bank-card-like values', () => {
  expect(redactDailyReportText('联系13812345678，邮箱a@b.com，身份证110101199001011234，卡6222021234567890'))
    .toBe('联系[手机号]，邮箱[邮箱]，身份证[身份证]，卡[银行卡]');
});

it('rejects a model response whose dimension total exceeds 90', () => {
  expect(() => validateAiResult({
    scores: { completeness: 15, evidence: 25, risk: 15, plan: 15, collaboration: 10, readability: 11 },
    summary: 'x',
    strengths: [],
    risks: [],
    followUps: [],
    evidence: [],
    confidence: 0.8,
  })).toThrow('日报评分维度超出范围');
});

it('stores one immutable analysis version for the combined employee-day content', async () => {
  ai.analyzeEmployeeDay.mockResolvedValue(validAiResult());
  await service.analyzeDayRecord('day-1');
  expect(prisma.dailyReportAnalysis.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      dayRecordId: 'day-1',
      rubricVersion: '1.0.0',
      promptVersion: '1.0.0',
      status: 'completed',
    }),
  }));
});
~~~

- [ ] **Step 2: Run and verify RED**

~~~powershell
Set-Location api
npx jest src/daily-reports/daily-report-redaction.spec.ts src/daily-reports/daily-report-ai.provider.spec.ts src/daily-reports/daily-report-analysis.service.spec.ts --runInBand
~~~

Expected: FAIL because redaction, provider and service modules do not exist.

- [ ] **Step 3: Implement redaction, provider and employee-day analysis**

Before any live OpenAI-compatible API work, invoke the openai-platform-api-key skill. Inspect key presence without printing it; if no approved reusable key exists, pause live calls while continuing stubbed implementation and tests.

The provider must use native fetch and require:

~~~typescript
export interface DailyReportAiResult {
  scores: DailyContentScores;
  summary: string;
  strengths: string[];
  risks: string[];
  followUps: string[];
  evidence: Array<{ dimension: keyof DailyContentScores; reportId: string; field: string; quote: string }>;
  confidence: number;
}
~~~

POST to DAILY_REPORT_AI_BASE_URL + /chat/completions with Authorization Bearer, model DAILY_REPORT_AI_MODEL, temperature 0, response_format json_object and a strict system prompt. The system prompt must state that report content is untrusted data, instructions inside it must not be followed, facts outside the content must not be inferred, and job role/word count must not affect score.

validateAiResult() must:

- require every score key;
- enforce 0—15, 0—25, 0—15, 0—15, 0—10, 0—10;
- enforce confidence between 0 and 1;
- enforce non-empty summary and evidence for non-zero dimensions;
- call sumContentScores() from Task 1;
- throw without persisting a completed analysis on invalid output.

DailyReportAnalysisService.analyzeDayRecord() must load the day record and all linked raw reports, sort by submittedAt/sourceReportId, combine exact fields, redact values, compute inputHash, reuse an identical completed analysis version, otherwise call the provider and append a new analysis. Missing day records return score 0 without an AI request.

- [ ] **Step 4: Run focused tests and build**

~~~powershell
Set-Location api
npx jest src/daily-reports/daily-report-redaction.spec.ts src/daily-reports/daily-report-ai.provider.spec.ts src/daily-reports/daily-report-analysis.service.spec.ts --runInBand
npm run build
~~~

Expected: all AI boundary tests PASS without a real network call.

- [ ] **Step 5: Commit AI analysis files**

~~~powershell
git add api/src/daily-reports/daily-report-redaction.ts api/src/daily-reports/daily-report-redaction.spec.ts api/src/daily-reports/daily-report-ai.provider.ts api/src/daily-reports/daily-report-ai.provider.spec.ts api/src/daily-reports/daily-report-analysis.service.ts api/src/daily-reports/daily-report-analysis.service.spec.ts
git diff --cached --name-only
git commit -m "feat(api): analyze daily reports with AI"
~~~

---

### Task 5: Period metrics, department scoring, comparisons, and immutable snapshots

**Files:**
- Create: api/src/daily-reports/daily-report-snapshot.service.spec.ts
- Create: api/src/daily-reports/daily-report-snapshot.service.ts

**Interfaces:**
- Consumes: DailyReportDayRecord, latest completed analysis, latest review, DailyReportAiProvider.summarizeScope(), scoring primitives.
- Produces: buildDaySnapshot(), buildWeekSnapshot(), buildMonthSnapshot(), getEmployeeComparison(), getDepartmentComparison().

- [ ] **Step 1: Write failing snapshot tests**

~~~typescript
it('uses the latest HR review as final score but preserves the AI score', async () => {
  prisma.dailyReportDayRecord.findMany.mockResolvedValue([
    dayFixture({ aiScore: 82, latestReviewScore: 75 }),
  ]);
  const snapshot = await service.buildDaySnapshot('2026-08-18');
  expect(snapshot.employeeRanking[0]).toMatchObject({ aiScore: 82, finalScore: 75 });
});

it('keeps a missing required day as zero in an employee period score', async () => {
  prisma.dailyReportDayRecord.findMany.mockResolvedValue([
    dayFixture({ businessDate: '2026-08-17', finalScore: 80 }),
    dayFixture({ businessDate: '2026-08-18', submissionStatus: 'missing', finalScore: 0 }),
  ]);
  const snapshot = await service.buildWeekSnapshot('2026-08-17');
  expect(snapshot.employeeRanking[0].finalScore).toBe(40);
});

it('returns partial when completed employee-day analysis coverage is incomplete', async () => {
  prisma.dailyReportDayRecord.findMany.mockResolvedValue([
    dayFixture({ analysisStatus: 'completed' }),
    dayFixture({ analysisStatus: 'pending' }),
  ]);
  const snapshot = await service.buildDaySnapshot('2026-08-18');
  expect(snapshot.status).toBe('partial');
  expect(snapshot.sourceCompleteness).toBe(0.5);
});
~~~

- [ ] **Step 2: Run and verify RED**

~~~powershell
Set-Location api
npx jest src/daily-reports/daily-report-snapshot.service.spec.ts --runInBand
~~~

Expected: FAIL because DailyReportSnapshotService is missing.

- [ ] **Step 3: Implement snapshot aggregation**

Use one internal normalized row:

~~~typescript
interface EffectiveDayScore {
  dayRecordId: string;
  employeeId: string;
  employeeName: string;
  deptId: string | null;
  deptName: string;
  required: boolean;
  submissionStatus: 'missing' | 'on_time' | 'late';
  aiScore: number | null;
  finalScore: number;
  contentScore: number | null;
  confidence: number | null;
  scores: DailyContentScores | null;
}
~~~

For each period:

1. Load all required day records in the exact date range.
2. Pick the latest completed analysis by analyzedAt.
3. Pick the latest review by createdAt.
4. Compute employee period score with missing days at zero.
5. Compute department coverage and the approved 20/60/10/10 score.
6. Rank via rankRows().
7. Ask summarizeScope() only after structured metrics exist.
8. Save company, department and employee DailyReportPeriodSnapshot rows in one transaction.
9. Mark snapshot partial when submitted employee-day analyses are incomplete; never invent missing scores.

Department and company prompts receive structured child summaries and evidence IDs, not all raw report text.

- [ ] **Step 4: Run snapshot tests and build**

~~~powershell
Set-Location api
npx jest src/daily-reports/daily-report-snapshot.service.spec.ts --runInBand
npm run build
~~~

Expected: snapshot tests PASS and types compile.

- [ ] **Step 5: Commit snapshot service**

~~~powershell
git add api/src/daily-reports/daily-report-snapshot.service.ts api/src/daily-reports/daily-report-snapshot.service.spec.ts
git diff --cached --name-only
git commit -m "feat(api): build daily report rankings"
~~~

---

### Task 6: Persistent job queue, worker, retries, and Asia/Shanghai schedules

**Files:**
- Create: api/src/daily-reports/daily-report-jobs.service.spec.ts
- Create: api/src/daily-reports/daily-report-jobs.service.ts
- Create: api/src/daily-reports/daily-report-worker.service.spec.ts
- Create: api/src/daily-reports/daily-report-worker.service.ts
- Create: api/src/daily-reports/daily-report-scheduler.service.spec.ts
- Create: api/src/daily-reports/daily-report-scheduler.service.ts

**Interfaces:**
- Consumes: DailyReportSyncService, DailyReportAnalysisService, DailyReportSnapshotService and DailyReportJob Prisma model.
- Produces: enqueue(), claimNext(), heartbeat(), complete(), failOrRetry(), processNext(), and four scheduled enqueuers.

- [ ] **Step 1: Write failing job and scheduler tests**

~~~typescript
it('deduplicates a scheduled job by dedupKey', async () => {
  prisma.dailyReportJob.upsert.mockResolvedValue({ id: 'job-1' });
  await service.enqueue('daily_sync', {}, { dedupKey: 'daily_sync:2026-08-18' });
  expect(prisma.dailyReportJob.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { dedupKey: 'daily_sync:2026-08-18' },
  }));
});

it('requeues a failed job while attempts remain', async () => {
  await service.failOrRetry(jobFixture({ attempts: 1, maxAttempts: 3 }), new Error('temporary'));
  expect(prisma.dailyReportJob.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'pending', attempts: 2 }),
  }));
});

it('enqueues the fixed three-day sync at 08:00', async () => {
  await scheduler.enqueueDailySync(new Date('2026-08-18T00:00:00.000Z'));
  expect(jobs.enqueue).toHaveBeenCalledWith('daily_sync', expect.any(Object), {
    dedupKey: 'daily_sync:2026-08-18',
  });
});
~~~

- [ ] **Step 2: Run and verify RED**

~~~powershell
Set-Location api
npx jest src/daily-reports/daily-report-jobs.service.spec.ts src/daily-reports/daily-report-worker.service.spec.ts src/daily-reports/daily-report-scheduler.service.spec.ts --runInBand
~~~

Expected: FAIL because job, worker and scheduler services are absent.

- [ ] **Step 3: Implement persisted jobs and schedules**

claimNext() must run in a Prisma transaction and use PostgreSQL row locking:

~~~sql
SELECT id
FROM daily_report_jobs
WHERE status = 'pending' AND scheduled_at <= NOW()
ORDER BY scheduled_at ASC, created_at ASC
FOR UPDATE SKIP LOCKED
LIMIT 1
~~~

Update the selected row to running with claimedAt, heartbeatAt and a generated workerId before the transaction returns. Do not select then update outside the transaction.

Worker dispatch:

~~~typescript
switch (job.type) {
  case 'initial_sync': await sync.runInitialSync(referenceNow); break;
  case 'daily_sync': await sync.runDailySync(referenceNow); break;
  case 'analyze_day': await snapshots.buildDaySnapshot(payload.periodStart); break;
  case 'analyze_week': await snapshots.buildWeekSnapshot(payload.periodStart); break;
  case 'analyze_month': await snapshots.buildMonthSnapshot(payload.periodStart); break;
  case 'reanalyze_day': await analysis.analyzeDayRecord(payload.dayRecordId); break;
}
~~~

DailyReportSchedulerService decorators:

~~~typescript
@Cron('0 8 * * *', { timeZone: 'Asia/Shanghai' })
@Cron('30 8 * * *', { timeZone: 'Asia/Shanghai' })
@Cron('0 9 * * 1', { timeZone: 'Asia/Shanghai' })
@Cron('0 9 1 * *', { timeZone: 'Asia/Shanghai' })
@Cron('* * * * *', { timeZone: 'Asia/Shanghai' })
~~~

08:30 must not enqueue formal day analysis until the same-date daily_sync job completed. Modified reports must enqueue reanalyze_day for their day record and rebuild affected period snapshots. Use capped exponential delays of 1, 5 and 15 minutes, maxAttempts 3.

- [ ] **Step 4: Run job tests and build**

~~~powershell
Set-Location api
npx jest src/daily-reports/daily-report-jobs.service.spec.ts src/daily-reports/daily-report-worker.service.spec.ts src/daily-reports/daily-report-scheduler.service.spec.ts --runInBand
npm run build
~~~

Expected: job tests PASS and Cron options compile with @nestjs/schedule 4.

- [ ] **Step 5: Commit job infrastructure**

~~~powershell
git add api/src/daily-reports/daily-report-jobs.service.ts api/src/daily-reports/daily-report-jobs.service.spec.ts api/src/daily-reports/daily-report-worker.service.ts api/src/daily-reports/daily-report-worker.service.spec.ts api/src/daily-reports/daily-report-scheduler.service.ts api/src/daily-reports/daily-report-scheduler.service.spec.ts
git diff --cached --name-only
git commit -m "feat(api): schedule daily report analysis"
~~~

---

### Task 7: HR-only REST API, manual review, calendar configuration, and audit

**Files:**
- Create: api/src/daily-reports/dto/daily-report-query.dto.ts
- Create: api/src/daily-reports/dto/daily-report-period.dto.ts
- Create: api/src/daily-reports/dto/daily-report-comparison.dto.ts
- Create: api/src/daily-reports/dto/create-daily-report-job.dto.ts
- Create: api/src/daily-reports/dto/review-daily-report.dto.ts
- Create: api/src/daily-reports/dto/calendar-exception.dto.ts
- Create: api/src/daily-reports/dto/user-exemption.dto.ts
- Create: api/src/daily-reports/daily-reports.service.spec.ts
- Create: api/src/daily-reports/daily-reports.service.ts
- Create: api/src/daily-reports/daily-reports.controller.ts
- Create: api/src/daily-reports/daily-reports.module.ts
- Modify: api/src/app.module.ts
- Create: api/test/suites/20-daily-reports.e2e-spec.ts
- Modify: api/test/test-app.ts
- Modify: api/test/fixtures/fixture-factory.ts

**Interfaces:**
- Consumes: all services from Tasks 1—6, CurrentUser/AuthUser, Roles decorator and common pagination.
- Produces: every /api/v1/daily-reports endpoint in section 11 of the spec and stable DTO response shapes for the web client.

- [ ] **Step 1: Write failing service and E2E authorization tests**

Controller class must be protected as a whole:

~~~typescript
@Controller('daily-reports')
@Roles(SysRole.hr, SysRole.system_admin)
export class DailyReportsController {}
~~~

Create an E2E role matrix:

~~~typescript
it.each([
  SysRole.employee,
  SysRole.manager,
  SysRole.dept_head,
  SysRole.vp,
  SysRole.chairman,
])('rejects %s even when canViewAll is true', async (sysRole) => {
  const user = await factory.createUser({ sysRole, canViewAll: true });
  const token = await login(app, user.employeeNo!);
  await app.http.get('/api/v1/daily-reports/overview')
    .set('Authorization', 'Bearer ' + token)
    .query({ periodType: 'day', periodStart: '2026-08-18' })
    .expect(403);
});

it.each([SysRole.hr, SysRole.system_admin])('allows %s', async (sysRole) => {
  const user = await factory.createUser({ sysRole });
  const token = await login(app, user.employeeNo!);
  await app.http.get('/api/v1/daily-reports/overview')
    .set('Authorization', 'Bearer ' + token)
    .query({ periodType: 'day', periodStart: '2026-08-18' })
    .expect(200);
});
~~~

Service spec must verify comparison size 2—5, latest review behavior, review reason audit, and initial/incremental job payloads.

- [ ] **Step 2: Run and verify RED**

~~~powershell
Set-Location api
npx jest src/daily-reports/daily-reports.service.spec.ts --runInBand
npm run test:e2e -- --runTestsByPath suites/20-daily-reports.e2e-spec.ts
~~~

Expected: unit test fails because service is missing; E2E fails with 404 for the new route.

- [ ] **Step 3: Implement DTOs, service, controller and module**

Use class-validator:

- periodType IsEnum, periodStart IsDateString;
- comparison IDs transformed from comma-separated query string, ArrayMinSize(2), ArrayMaxSize(5), IsUUID('4', { each: true });
- adjustedTotalScore IsInt Min(0) Max(100);
- adjustedComment IsString MaxLength(2000);
- reason IsString MinLength(1) MaxLength(500);
- pagination extends PaginationDto.

Required endpoints:

~~~text
GET    /daily-reports/overview
GET    /daily-reports/rankings
GET    /daily-reports/department-comparison
GET    /daily-reports/employee-comparison
GET    /daily-reports/report-days
GET    /daily-reports/report-days/:id
PATCH  /daily-reports/report-days/:id/review
POST   /daily-reports/sync-jobs
POST   /daily-reports/analysis-jobs
GET    /daily-reports/jobs
GET    /daily-reports/calendar-exceptions
POST   /daily-reports/calendar-exceptions
PATCH  /daily-reports/calendar-exceptions/:id
DELETE /daily-reports/calendar-exceptions/:id
GET    /daily-reports/user-exemptions
POST   /daily-reports/user-exemptions
PATCH  /daily-reports/user-exemptions/:id
DELETE /daily-reports/user-exemptions/:id
~~~

Audit action names:

~~~text
daily_report_viewed
daily_report_reviewed
daily_report_sync_requested
daily_report_analysis_requested
daily_report_calendar_changed
daily_report_exemption_changed
~~~

Audit newValue may contain IDs, ranges, counts, score changes and reasons, but never plainText, contents, AI request payload, API key or full model response.

DailyReportsModule imports PrismaModule and DingtalkModule, registers all new providers/controllers, and is imported once by AppModule. Keep the existing SchedulerModule unchanged.

Update TestApp to override DingtalkReportClient and DailyReportAiProvider with network-free fakes. Add all daily_report_* tables to FixtureFactory.resetDataTables before users are deleted.

- [ ] **Step 4: Run unit, E2E and build**

~~~powershell
Set-Location api
npx jest src/daily-reports/daily-reports.service.spec.ts --runInBand
npm run test:e2e -- --runTestsByPath suites/20-daily-reports.e2e-spec.ts
npm run build
~~~

Expected: HR/system_admin receive 200; all other roles receive 403; service tests and build PASS.

- [ ] **Step 5: Commit API surface**

~~~powershell
git add api/src/daily-reports/dto api/src/daily-reports/daily-reports.service.ts api/src/daily-reports/daily-reports.service.spec.ts api/src/daily-reports/daily-reports.controller.ts api/src/daily-reports/daily-reports.module.ts api/src/app.module.ts api/test/suites/20-daily-reports.e2e-spec.ts api/test/test-app.ts api/test/fixtures/fixture-factory.ts
git diff --cached --name-only
git commit -m "feat(api): expose HR daily report analysis"
~~~

---

### Task 8: Frontend API, HR-only navigation, and company overview

**Files:**
- Create: web/src/api/daily-reports.api.ts
- Modify: web/src/types/api.types.ts
- Modify: web/src/router/routes.ts
- Modify: web/e2e/specs/11-navigation-entrypoints.spec.ts
- Create: web/src/views/daily-reports/DailyReportAnalysisView.vue
- Create: web/src/views/daily-reports/DailyReportOverview.vue
- Create: web/src/components/charts/DailyReportTrendChart.vue
- Create: web/src/components/charts/DailyReportDimensionChart.vue
- Create: web/e2e/specs/20-daily-report-analysis.spec.ts
- Modify: web/playwright.contract.config.ts

**Interfaces:**
- Consumes: Task 7 REST response types, existing http interceptor, router navigation metadata and ECharts.
- Produces: dailyReportsApi, DailyReportOverviewResponse, DailyReportRankingRow, period controls, overview metrics and HR-only navigation.

- [ ] **Step 1: Write failing navigation and overview contracts**

Update navigation test expectation for HR:

~~~typescript
expect(analysis?.groups.flatMap((group) => group.items.map((item) => item.label)))
  .toEqual(['报表分析', '日报分析', '指标库', '考核模板', '用户管理']);
~~~

Add explicit non-HR assertion:

~~~typescript
expect(JSON.stringify(buildNavigation(routes, { sysRole: 'chairman', canViewAll: true })))
  .not.toContain('日报分析');
~~~

Create Playwright overview contract with mocked /auth/me and /daily-reports/overview:

~~~typescript
await page.goto('/daily-reports');
await expect(page.getByText('日报评分仅用于工作信息质量分析和管理参考，不进入绩效考核。')).toBeVisible();
await expect(page.getByTestId('daily-report-submission-rate')).toContainText('92.5%');
await expect(page.getByTestId('daily-report-company-summary')).toContainText('本周重点');
await expect(page.getByTestId('daily-report-department-ranking')).toContainText('研发部');
await expect(page.getByTestId('daily-report-employee-ranking')).toContainText('张三');
~~~

- [ ] **Step 2: Run and verify RED**

~~~powershell
Set-Location web
npx playwright test --config playwright.contract.config.ts e2e/specs/20-daily-report-analysis.spec.ts
~~~

Expected: FAIL because /daily-reports has no route.

- [ ] **Step 3: Add types, API, route, charts and overview**

Add route after /reports with order 15:

~~~typescript
{
  path: '/daily-reports',
  name: 'DailyReportAnalysis',
  component: () => import('@/views/daily-reports/DailyReportAnalysisView.vue'),
  meta: {
    requiresAuth: true,
    title: '日报分析',
    roles: ['hr', 'system_admin'],
    navigation: { module: 'analysis', label: '日报分析', order: 15 },
  },
}
~~~

Define the API methods with exact backend paths and use the existing apiGet cast pattern. The overview page must:

- default to day and the most recent business date returned by API;
- support day/week/month and periodStart in URL query;
- show sync/analysis timestamps and failed job count;
- show required, submitted, missing, submission rate and average score;
- show company AI summary and source completeness;
- show department and employee rankings with AI score, final score, confidence and prior-rank delta;
- show the fixed non-performance notice on every tab;
- provide reload, sync and analysis buttons with explicit task-created feedback.

DailyReportTrendChart uses ECharts LineChart. DailyReportDimensionChart uses RadarChart and fixed max values 10/15/25/15/15/10/10 as appropriate to the displayed normalized 100-scale series.

- [ ] **Step 4: Run contract, type-check, and build**

~~~powershell
Set-Location web
npx playwright test --config playwright.contract.config.ts e2e/specs/20-daily-report-analysis.spec.ts --grep "overview|navigation"
npm run type-check
npm run build
~~~

Expected: HR overview contract PASS, navigation contains 日报分析 only for HR/system_admin, type-check/build PASS.

- [ ] **Step 5: Commit frontend overview**

~~~powershell
git add web/src/api/daily-reports.api.ts web/src/types/api.types.ts web/src/router/routes.ts web/e2e/specs/11-navigation-entrypoints.spec.ts web/src/views/daily-reports/DailyReportAnalysisView.vue web/src/views/daily-reports/DailyReportOverview.vue web/src/components/charts/DailyReportTrendChart.vue web/src/components/charts/DailyReportDimensionChart.vue web/e2e/specs/20-daily-report-analysis.spec.ts web/playwright.contract.config.ts
git diff --cached --name-only
git commit -m "feat(web): add HR daily report overview"
~~~

---

### Task 9: Department/person comparison, report detail, review, and calendar settings UI

**Files:**
- Create: web/src/views/daily-reports/DailyReportComparison.vue
- Create: web/src/views/daily-reports/DailyReportList.vue
- Create: web/src/views/daily-reports/DailyReportDetailDrawer.vue
- Create: web/src/views/daily-reports/DailyReportSettings.vue
- Modify: web/src/views/daily-reports/DailyReportAnalysisView.vue
- Modify: web/e2e/specs/20-daily-report-analysis.spec.ts

**Interfaces:**
- Consumes: dailyReportsApi and Task 8 chart components; UserSelect, departmentsApi and Element Plus dialogs/tables.
- Produces: 2—5 department/person comparison, paged report-day list, evidence drill-down, HR score review, workday exception and exemption workflows.

- [ ] **Step 1: Add failing interaction and responsive contracts**

~~~typescript
test('compares two departments and drills into evidence', async ({ page }) => {
  await mockHrIdentity(page);
  await mockDailyReportApis(page);
  await page.goto('/daily-reports');
  await page.getByRole('tab', { name: '部门对比' }).click();
  await page.getByTestId('department-comparison-select').click();
  await page.getByText('研发部', { exact: true }).click();
  await page.getByText('销售部', { exact: true }).click();
  await expect(page.getByTestId('daily-report-dimension-chart')).toBeVisible();
  await expect(page.getByTestId('daily-report-comparison-summary')).toContainText('协同');
});

test('shows AI score and HR final score after a reviewed adjustment', async ({ page }) => {
  await page.goto('/daily-reports');
  await page.getByRole('tab', { name: '日报明细' }).click();
  await page.getByText('张三').click();
  await expect(page.getByTestId('daily-report-ai-score')).toContainText('82');
  await expect(page.getByTestId('daily-report-final-score')).toContainText('75');
  await expect(page.getByText('HR 已调整')).toBeVisible();
});

test('does not overflow at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/daily-reports');
  expect(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
});
~~~

- [ ] **Step 2: Run and verify RED**

~~~powershell
Set-Location web
npx playwright test --config playwright.contract.config.ts e2e/specs/20-daily-report-analysis.spec.ts --grep "compares|adjusted|390px"
~~~

Expected: FAIL because comparison, detail and settings components are missing.

- [ ] **Step 3: Implement comparison, list, detail and settings**

DailyReportComparison props:

~~~typescript
defineProps<{
  mode: 'department' | 'employee';
  periodType: 'day' | 'week' | 'month';
  periodStart: string;
}>();
~~~

Require 2—5 selections before requesting comparison. Use departmentsApi for departments and UserSelect with multiple=true for employees. Display score cards, submission rate, dimension radar, trend and AI difference summary without “能力更强”等文案。

DailyReportList filters:

- date range;
- department;
- employee;
- submissionStatus;
- mappingStatus;
- analysisStatus;
- minScore/maxScore;
- page/pageSize.

DailyReportDetailDrawer displays all raw source reports for the day, businessDateSource, timing rule, all analysis versions, six AI dimensions plus timely score, evidence, confidence and review history. Submit review only when score 0—100, comment <= 2000 and non-empty reason <= 500.

DailyReportSettings implements:

- calendar exception create/edit/delete with date, isWorkday and reason;
- user exemption create/edit/delete with UserSelect, startDate, endDate and reason;
- reload after each successful write;
- no model credentials or template environment variables in the browser.

Use CSS grid minmax(0, 1fr), overflow-wrap:anywhere on AI content, table horizontal scroll inside its own container, and no fixed page width.

- [ ] **Step 4: Run all daily-report web contracts and build**

~~~powershell
Set-Location web
npx playwright test --config playwright.contract.config.ts e2e/specs/20-daily-report-analysis.spec.ts
npm run type-check
npm run build
~~~

Expected: all daily-report contracts PASS, 390px page has no root overflow, type-check/build PASS.

- [ ] **Step 5: Commit frontend workflow**

~~~powershell
git add web/src/views/daily-reports/DailyReportComparison.vue web/src/views/daily-reports/DailyReportList.vue web/src/views/daily-reports/DailyReportDetailDrawer.vue web/src/views/daily-reports/DailyReportSettings.vue web/src/views/daily-reports/DailyReportAnalysisView.vue web/e2e/specs/20-daily-report-analysis.spec.ts
git diff --cached --name-only
git commit -m "feat(web): complete daily report analysis workflows"
~~~

---

### Task 10: Production configuration, operations guide, focused regression, and visible acceptance

**Files:**
- Modify: .env.example
- Create: docs/operations/daily-report-analysis.md
- Modify only if test evidence requires: api/test/test-app.ts
- Modify only if test evidence requires: api/test/fixtures/fixture-factory.ts

**Interfaces:**
- Consumes: completed backend and frontend module.
- Produces: deployable environment contract, runbook, focused green verification and browser acceptance evidence.

- [ ] **Step 1: Add configuration contract and operations guide**

Append names only, never real secrets, to .env.example:

~~~dotenv
# 钉钉日报分析
DAILY_REPORT_TEMPLATE_NAMES=日报
DAILY_REPORT_DATE_FIELD_NAMES=日报日期,工作日期
DAILY_REPORT_AI_BASE_URL=https://api.openai.com/v1
DAILY_REPORT_AI_API_KEY=
DAILY_REPORT_AI_MODEL=
DAILY_REPORT_AI_TIMEOUT_MS=60000
DAILY_REPORT_AI_MAX_CONCURRENCY=3
~~~

docs/operations/daily-report-analysis.md must include exact steps:

1. Apply for qyapi_report_query or the current DingTalk console equivalent.
2. Configure the seven environment variables.
3. Run npx prisma generate and npx prisma migrate deploy in the API container.
4. Restart API.
5. Sign in as system_admin and create POST /api/v1/daily-reports/sync-jobs with mode initial.
6. Poll GET /api/v1/daily-reports/jobs until completed.
7. Verify total, unmatched, failed and sample source content counts.
8. Create the first day analysis job.
9. Verify HR access and non-HR 403.
10. Explain AI-disabled mode, retry, unmatched-user repair and how to rotate the AI key.

- [ ] **Step 2: Run backend focused verification**

~~~powershell
Set-Location api
npx prisma generate
npx prisma validate
npx jest src/daily-reports --runInBand
npm run test:e2e -- --runTestsByPath suites/20-daily-reports.e2e-spec.ts
npm run build
~~~

Expected: all daily-report unit tests PASS, daily-report E2E PASS, Prisma validates, API build PASS.

- [ ] **Step 3: Run frontend focused verification**

~~~powershell
Set-Location ../web
npx playwright test --config playwright.contract.config.ts e2e/specs/20-daily-report-analysis.spec.ts
npm run type-check
npm run build
~~~

Expected: all daily-report browser contracts PASS and web build PASS.

- [ ] **Step 4: Run the feature locally with test substitutes and inspect both viewports**

Start the existing local stack using localhost rather than 127.0.0.1:

~~~powershell
Set-Location ..
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d api web
~~~

Use the in-app browser at http://localhost:5173/daily-reports with an HR test session and network fixtures or approved non-production credentials. Verify:

- company summary and both rankings;
- 2-department and 2-person comparison;
- raw report evidence and HR adjustment;
- sync/analysis task state;
- calendar and exemption settings;
- 1440x900 and 390x844 root scrollWidth equals clientWidth;
- employee/manager role cannot navigate to the page.

Do not trigger a production 90-day backfill during local acceptance.

- [ ] **Step 5: Confirm performance isolation with a schema and code scan**

Run:

~~~powershell
rg -n "assessmentCycle|assessmentTask|indicatorInstance|gradeResult|performanceArchive" api/src/daily-reports web/src/views/daily-reports
rg -n "dailyReport|daily-report" api/src/cycles api/src/tasks api/src/reports api/src/calibration api/src/publish web/src/views/task web/src/views/reports
~~~

Expected: first command returns no business coupling; second returns no imports or queries from performance modules. Test names and the fixed “不进入绩效考核” notice are acceptable only outside import/query expressions.

- [ ] **Step 6: Commit configuration and runbook**

~~~powershell
git add .env.example docs/operations/daily-report-analysis.md
git diff --cached --name-only
git commit -m "docs: add daily report operations guide"
~~~

- [ ] **Step 7: Final completion check**

Run:

~~~powershell
git status --short
git log -10 --oneline
~~~

Report separately:

- focused test/build results;
- any unrelated pre-existing dirty files;
- whether live DingTalk and live AI were intentionally not called;
- remaining production-only step: authorized 90-day backfill and sampled HR acceptance.

Do not claim production data synchronization or live AI scoring until those authorized production steps have completed.

---

## Plan Self-Review Checklist

- Persistence covers raw reports, employee-day records, analyses, reviews, snapshots, jobs, calendar exceptions and exemptions.
- TDD order is explicit for scoring, calendar, sync, AI, snapshots, jobs, API and UI.
- Every downstream interface is named before use.
- HR-only authorization is tested independently of canViewAll.
- Missing reports score zero; exemptions leave the denominator; late reports retain content score but lose timely points.
- Department formula remains 20/60/10/10 and ranking tie-breakers are deterministic.
- AI failure leaves raw reports and base statistics available.
- The plan does not modify the existing DingTalk organization sync service or performance report service.
- Initial 90-day and daily 3-day windows are fixed and idempotent.
- All scheduled jobs use Asia/Shanghai.
- Desktop and 390px mobile acceptance are included.
- Production credentials and real report contents never enter tests or commits.
