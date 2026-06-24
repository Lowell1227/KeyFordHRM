/**
 * 聚合 E2E 测试报告，生成 PM 可读的 Markdown 摘要。
 *
 * 输入：
 *   - api/test-reports/junit-e2e.xml
 *   - web/playwright-report/results.xml
 * 输出：
 *   - e2e-report/summary.md
 */
import * as fs from 'fs';
import * as path from 'path';

const REPORT_DIR = path.resolve(__dirname, '..', 'e2e-report');
const LAYER_A_JUNIT = path.resolve(__dirname, '..', 'api', 'test-reports', 'junit-e2e.xml');
const LAYER_B_JUNIT = path.resolve(__dirname, '..', 'web', 'playwright-report', 'results.xml');
const OUTPUT = path.join(REPORT_DIR, 'summary.md');

interface Failure {
  suite: string;
  name: string;
  message: string;
  trace?: string;
}

interface ParsedReport {
  total: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number;
  failureList: Failure[];
}

function parseJUnit(xmlPath: string): ParsedReport {
  const result: ParsedReport = { total: 0, failures: 0, errors: 0, skipped: 0, time: 0, failureList: [] };
  if (!fs.existsSync(xmlPath)) return result;

  const xml = fs.readFileSync(xmlPath, 'utf-8');

  // testsuite 级统计
  const suiteRegex = /<testsuite[^>]*tests="(\d+)"[^>]*failures="(\d+)"[^>]*errors="(\d+)"[^>]*(?:skipped="(\d+)")?[^>]*time="([\d.]+)"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = suiteRegex.exec(xml)) !== null) {
    result.total += parseInt(m[1], 10);
    result.failures += parseInt(m[2], 10);
    result.errors += parseInt(m[3], 10);
    result.skipped += parseInt(m[4] || '0', 10);
    result.time += parseFloat(m[5]);
  }

  // 失败明细
  const testcaseRegex = /<testcase[^>]*classname="([^"]*)"[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/testcase>/g;
  while ((m = testcaseRegex.exec(xml)) !== null) {
    const suite = m[1];
    const name = m[2];
    const body = m[3];
    const failureMatch = body.match(/<failure[^>]*(?:message="([^\"]*)")?[^>]*>([\s\S]*?)<\/failure>/);
    const errorMatch = body.match(/<error[^>]*(?:message="([^\"]*)")?[^>]*>([\s\S]*?)<\/error>/);
    if (failureMatch || errorMatch) {
      const fm = failureMatch || errorMatch!;
      result.failureList.push({
        suite,
        name,
        message: fm[1] || '',
        trace: fm[2]?.trim() || '',
      });
    }
  }

  return result;
}

function coverageTable(): string {
  return `
## 与 E2E验收清单 14 环节覆盖对照

| 环节 | 层A 覆盖 | 层B 覆盖 | 备注 |
|------|----------|----------|------|
| 0 前置环境 | setup.ts / docker-compose.test.yml | playwright.config.ts | 自动起 PG、起后端 |
| 1 主数据 | 02-master-data | 04-template-weight-validation | 指标/模板/用户/部门 |
| 2 建周期+发起 | 03-cycle-lifecycle | - | launch、豁免 |
| 3 指标确认 | 03-cycle-lifecycle | - | 确认/退回 |
| 4 自评 | 03-cycle-lifecycle | - | 自评提交/越界 |
| 5 主管评分 | 03-cycle-lifecycle | - | 加减分/否决 |
| 6 部门复核 | 03-cycle-lifecycle | - | 通过/退回 |
| 7 HR校准 | 04-scoring-algorithm | - | 分布告警/改判 |
| 8 审批 | 03-cycle-lifecycle | - | 批量/退回 |
| 9 公示 | 03-cycle-lifecycle | - | 精确发布/未审批 409 |
| 10 员工确认+D18 | 05-data-redlines | 03-dom-redlines | 公示前遮罩/系数 |
| 11 关周期+归档 | 03-cycle-lifecycle | - | 幂等/跳过无等级 |
| 12 申诉 | 06-appeals | - | 改判/档案同步 |
| 13 报表 | 05-data-redlines | 02-role-menu-visibility | VP 仅汇总/无系数 |
| 14 催办限频 | 07-scheduler-cron | - | D19 限频 |
`;
}

function main() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const layerA = parseJUnit(LAYER_A_JUNIT);
  const layerB = parseJUnit(LAYER_B_JUNIT);

  const totalFailures = layerA.failures + layerA.errors + layerB.failures + layerB.errors;

  const lines: string[] = [];
  lines.push('# E2E 全量测试报告');
  lines.push(`\n生成时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push(`\n## 汇总\n`);
  lines.push(`| 层级 | 用例数 | 失败 | 错误 | 跳过 | 耗时(s) |`);
  lines.push(`|------|--------|------|------|------|----------|`);
  lines.push(
    `| 层A API | ${layerA.total} | ${layerA.failures} | ${layerA.errors} | ${layerA.skipped} | ${layerA.time.toFixed(2)} |`,
  );
  lines.push(
    `| 层B UI | ${layerB.total} | ${layerB.failures} | ${layerB.errors} | ${layerB.skipped} | ${layerB.time.toFixed(2)} |`,
  );

  lines.push(`\n## 失败明细\n`);
  if (layerA.failureList.length === 0 && layerB.failureList.length === 0) {
    lines.push('✅ 全部通过，无失败项。');
  } else {
    lines.push(`| 场景 | 用例 | 期望 vs 实际 | Trace/报错 |`);
    lines.push(`|------|------|--------------|------------|`);
    for (const f of layerA.failureList) {
      lines.push(`| 层A ${f.suite} | ${f.name} | ${f.message.replace(/\|/g, '\\|').slice(0, 80)} | ${(f.trace || '').slice(0, 120).replace(/\|/g, '\\|')} |`);
    }
    for (const f of layerB.failureList) {
      lines.push(`| 层B ${f.suite} | ${f.name} | ${f.message.replace(/\|/g, '\\|').slice(0, 80)} | ${(f.trace || '').slice(0, 120).replace(/\|/g, '\\|')} |`);
    }
  }

  lines.push(coverageTable());

  lines.push(`\n## 结论\n`);
  if (totalFailures === 0) {
    lines.push('✅ 层A 与 层B 全部通过，可进入 PM 签-off。');
  } else {
    lines.push(`❌ 共发现 ${totalFailures} 项失败。按任务要求，**不自行修复**，请 PM 分类后统一发返工卡。`);
    lines.push(`- 层A 失败会阻塞 PR 合并（CI 门控）。`);
    lines.push(`- 层B 失败需结合 video/trace 人工复核。`);
  }

  fs.writeFileSync(OUTPUT, lines.join('\n'), 'utf-8');
  console.log(`✓ 汇总报告已生成：${OUTPUT}`);
}

main();
