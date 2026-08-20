# 真实演示数据跨角色验收报告

## 结论：BLOCKED（生产数据装载已验证，浏览器验收未完成）

目标 Docker `hrm` / `kayford_perf` 已完成两次生产模式 seed 与两次
verify，27 类 owned 数据、总数 7,513、关系计数和确定性 ID 均保持一致，
实际目标幂等性通过。当前不能给出“8 角色验收通过”或“可上线”的结论：
规定使用的应用内浏览器返回 `No browser is available`，可用浏览器列表为
`[]`。按浏览器技能约束，未降级为独立 Playwright 或其他浏览器工具，
因此页面观察、刷新、权限范围、控制台错误和 12 张截图均尚未执行。

## 写入目标与安全门

- Compose 项目：`hrm`（未启动或访问 `kayford-deploy`）。
- API 容器：`hrm-api-1`；数据库容器：`hrm-postgres-1`。
- 数据库：`kayford_perf`；PostgreSQL 状态为 running / healthy。
- 写入前最终 preview：exit 0、无 collision、`existingOwnedTotal=0`。
- 共享密码仅检查非空并通过环境变量名转发，未打印、未写入文件或命令字面量。
- seed gate 和密码均只存在于单次 `docker exec`；执行后容器持久环境计数均为 0。
- 未执行 clean。

## 两次 seed / verify 结果

两次 seed 均 exit 0，两次 verify 均 exit 0。第二次结果与第一次完全一致：

```json
{
  "counts": {
    "department": 1,
    "user": 133,
    "indicator": 52,
    "template": 14,
    "dimension": 28,
    "template-indicator": 84,
    "cycle": 5,
    "snapshot": 45,
    "task": 384,
    "indicator-instance": 2286,
    "self-eval": 241,
    "manager-eval": 241,
    "grade": 241,
    "flow": 2438,
    "archive": 361,
    "objective": 28,
    "action-item": 56,
    "interview": 241,
    "appeal": 7,
    "improvement-plan": 23,
    "probation-review": 11,
    "probation-indicator": 44,
    "confirmation": 7,
    "signature": 480,
    "notification": 48,
    "audit-log": 14
  },
  "total": 7513,
  "relations": {
    "taskEmployees": 384,
    "taskSnapshots": 384,
    "indicatorTasks": 2286,
    "acceptanceAccounts": 8
  }
}
```

Owned 用户共 133 个，其中 8 个且仅 8 个验收账号存在密码哈希，另外
125 个为空；8 个哈希均为 bcrypt cost 10，未发现额外非空哈希。验证过程
没有输出密码或哈希。

## Fresh 写前验证

| 验证 | 结果 |
| --- | --- |
| realistic seed 测试 | PASS：12 suites / 67 tests，148.692 s |
| API unit | PASS：25 suites / 289 tests，7.468 s |
| API 隔离 E2E | PASS：18 suites / 78 tests，193.51 s；Testcontainer `localhost:32805/hrm_e2e` |
| API build | PASS：exit 0 |
| Web contracts | PASS：65 / 65，1.1 min |
| Web build | PASS：4,091 modules，13.90 s，exit 0 |

API E2E 使用隔离 Testcontainer，没有连接目标 `kayford_perf`。Web contract
所需的测试专用状态仅用于 pre-write contract 门，不用于下列真实 8 角色验收。

## 服务与敏感信息复核

- `GET /api/v1/health`：HTTP 200，`data.status=ok`，`data.db=ok`。
- `http://192.168.31.65:5173/`：HTTP 200。
- 最近两小时 API + Web 日志中，共享密码明文匹配 0、环境变量名匹配 0、
  bcrypt cost-10 模式匹配 0。

## 8 角色浏览器验收矩阵（尚未观察）

下表的“预期”来自任务验收规范；“实际观察”均明确记为未观察，不能据此
判断业务通过。

| 角色 / 工号 | 路由 | API | 业务场景 | 预期 | 实际观察 | 刷新 | Console / pageerror | 截图 | Blocker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Admin / `FD900001` | `/dashboard`、`/users`、`/cycles`、`/reports` | 未观察 | 系统全局管理 | 可见 128 名在职人员及管理员菜单 | 未观察 | 未执行 | 未执行 | 无 | 应用内浏览器不可用 |
| HR / `FD100001` | `/dashboard`、`/cycles`、`/calibration`、`/publish`、`/appeals`、`/users`、`/probation-reviews/manage`、`/confirmation-applications/manage`、`/reports` | 未观察 | 全局绩效、人事与申诉 | 可见 Q1/Q2/Q3、分布及 HR 流程 | 未观察 | 未执行 | 未执行 | 无 | 应用内浏览器不可用 |
| VP / `FD100002` | `/approval`、`/reports`、`/confirmation-applications/approvals` | 未观察 | 高管审批 | 仅见授权范围内审批和报表 | 未观察 | 未执行 | 未执行 | 无 | 应用内浏览器不可用 |
| 部门负责人 / `FD210001` | `/tasks?scope=team`、`/reports`、`/appeals` | 未观察 | 部门任务与申诉 | 仅见本部门，包含多状态任务 | 未观察 | 未执行 | 未执行 | 无 | 应用内浏览器不可用 |
| 经理 / `FD210002` | `/tasks?scope=team`、`/interviews`、`/objectives`、`/action-items`、`/probation-reviews/manager` | 未观察 | 直属团队执行 | 仅见直属团队及可处理事项 | 未观察 | 未执行 | 未执行 | 无 | 应用内浏览器不可用 |
| 员工 / `FD210101` | `/dashboard`、`/tasks` | 未观察 | 个人绩效历史 | 仅见自己的 Q1/Q2/Q3 | 未观察 | 未执行 | 未执行 | 无 | 应用内浏览器不可用 |
| 低绩效员工 / `FD210102` | `/tasks`、`/improvement-plans` | 未观察 | 连续 C→D 与改进计划 | 可见个人历史和改进计划文本 | 未观察 | 未执行 | 未执行 | 无 | 应用内浏览器不可用 |
| 试用期员工 / `FD210103` | `/probation-reviews/mine`、`/confirmation-applications/mine` | 未观察 | 试用期与转正 | 可见当前阶段和日期 | 未观察 | 未执行 | 未执行 | 无 | 应用内浏览器不可用 |

## 故事详情证据（尚未生成）

| 故事 | 预期截图 | 实际结果 | Blocker |
| --- | --- | --- | --- |
| 已修改申诉 | 详情页证据 | 未观察、无截图 | 应用内浏览器不可用 |
| 连续 D / 改进历史 | 详情页证据 | 未观察、无截图 | 应用内浏览器不可用 |
| 绩效豁免 | 详情页证据 | 未观察、无截图 | 应用内浏览器不可用 |
| 调岗 | 详情页证据 | 未观察、无截图 | 应用内浏览器不可用 |

## 阻塞证据与恢复条件

应用内浏览器按目标 URL 初始化时返回 `No browser is available`。按技能
读取 bootstrap troubleshooting 后仅执行一次浏览器发现，结果为 `[]`；
在 Codex 浏览器面板打开目标 URL 后重试，仍返回同一错误。

恢复验收需要在 Codex 的 **Settings → Computer use / Browser** 中启用一个
可用浏览器实例，打开 `http://192.168.31.65:5173/`，然后重新执行全部
8 角色登录、路由、刷新、权限范围、console/pageerror 和 12 张截图。完成前
本报告保持 BLOCKED，且不会创建 `docs: verify` 提交。
