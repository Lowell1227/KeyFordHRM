# 员工档案第一批修复接续验收

日期：2026-11-02。范围：接续已有五项本地修复，核对差异、补真实数据库与角色验证，并修复同一办理链路遗漏。

本文记录首次发布前的技术验收快照。随后用户明确要求“请将修复的上线”，已授权提交、推送及仅API/Web发布；实际发布修订、备份、回滚与外部复核以 `C:/Users/lwei/kayford-releases/personnel-daily-flow-20261102/` 的发布证据为准，不能用下表的发布前状态替代后续上线事实。

## 发布前交付结论

第一批已完成本地实现与自动化技术验证。代码未暂存、未提交、未推送、未上线；生产真人业务验收待完成。第二、三批未实施。

| 证据层级 | 当前状态 |
| --- | --- |
| 代码已实现 | 五项原修复保留；追加修复下述遗漏 |
| 代码已提交 | 否，暂存区为空，HEAD 未变化 |
| 代码已上线 | 否，生产 API/Web 仍为 `35ab97570584b5a9b0a7c616eeca01efa30f38d8` |
| 业务已验收 | 独立空库、虚构员工和角色的自动化验证通过；尚未完成生产真人验收 |

## 接续发现与修复

1. **离职/任职入口仍会改坏未传字段。** 页面请求未携带职系、职级时，`createEmploymentRecord` 会先把提案覆盖为空或岗位目录值，原审核修复随后保留的已是错误提案。同一入口还会清空无岗位ID的历史岗位文字。现改为同岗位未传字段继承原档案，显式修改/清空仍生效，真实换岗继续目录职系规则；没有只在页面补传掩盖服务端问题。
2. **离职原因未进入申请与任职记录。** 原页面虽然采集原因，服务端建提案时未保留，审核落库则写固定说明。现将原因保留在 `proposedValue.employee.reason`，人工任职变更审核后写入任职记录。其他档案审核的固定说明不变。
3. **合同日期文字与状态在海外时区不一致。** 原合同卡片将数据库日期的ISO形式按浏览器时区显示，洛杉矶浏览器会少一天。合同卡片的签订、生效、到期日期现与状态复用同一日历日期解析；没有更改全局时间格式化规则。

新增真实数据库回归先观察到职系/职级、历史岗位文字及原因缺失的失败，再修复并转绿。合同日期新增PC/手机文字断言先出现2项失败，修复后7项通过。

## 验证结果

| 验证 | 新鲜结果与边界 |
| --- | --- |
| API 全量 Jest | 127 套，1808 项通过，0 失败 |
| API 生产构建 | 通过 |
| 独立 PostgreSQL、JWT、HTTP 回归 | 16 项通过；真实 Nest 应用、全局认证/角色守卫、审核服务、Prisma 与 PostgreSQL |
| Web 联合 Playwright | 接续独立复跑 107 项通过，0 失败/跳过/波动；接口全部模拟 |
| 合同日期追加回归 | 修复后完整 75 用例 7 项通过，含1440/390px、洛杉矶时区、ISO三处日期文字断言 |
| Web 类型检查与生产构建 | 通过；保留依赖 PURE 注释和大包告警 |
| 最终差异检查 | 通过；生成声明噪声已恢复 |

107项联合是在追加合同文字修正前运行；该修正后执行了直接覆盖它的7项、类型检查和生产构建，不将两次运行称为同一次最终全套。

真实数据库16项具体覆盖：

- 档案岗位ID不变、目录职系为空或不同：地点修改提案、审核落库和正式查询均保留原职系；档案已通过、绩效关系退回后可继续原申请，无假冲突。
- 同岗位明确修改/清空职系继续生效；真正换岗继续按目录职系（包括空值）写入。
- 实际任职/离职请求省略职系、职级时保留原值；同ID为空时保留历史岗位文字；显式移除目录岗位仍可清空关联和职系。
- 数据库中的仅审核能力 `hr_user` 可退回并写审计；仅编辑、无能力HR及普通员工均被拒绝；未登录401；审核员不因此获得档案编辑权限。角色通过真实 AuthService 签发JWT后经真实守卫读取，未使用测试快捷登录。
- 缺部门员工保存/提交部门草稿后，正式员工和当前任职的部门仍为空；未带部门的离职审核被拒绝。部门审核生效后，使用原最后工作日与原因重新提交离职并审核；最后工作日当天保持在职，次日生效后正式状态为离职，原因写入对应任职记录。

## 隔离与生产核对

- 每轮新建专属 PostgreSQL 14 与 Redis 容器，随机回环端口，仅绑定 `127.0.0.1`。数据库名固定为 `hrm_personnel_daily_test`，专用运行标记和独立测试配置拒绝默认端口及其他库名。
- 数据目录使用新的 tmpfs；迁移前验证 public 表数量为0，只应用现有60项迁移，不导入生产数据、不执行seed，不运行默认Playwright准备程序。
- 全部员工、部门、岗位、能力身份均为虚构fixture。测试应用保留真实业务服务，消息推送、钉钉同步和附件存储使用既有测试替身，机器人及自动通知开关关闭。
- 16项通过后专属两个容器均已删除，临时内存数据随容器销毁；现场无本次标记的遗留容器。未连接先前已清理的100人环境。
- 09:04北京时间只读复核：HEAD、main、刷新后的origin/main及生产API/Web修订均为 `35ab97570584b5a9b0a7c616eeca01efa30f38d8`；正式首页与健康接口200，数据库状态ok，生产测试快捷登录关闭。
- `docs/project-memory.md` 原有+62行完整保留，SHA256仍为 `D96B48701984A9501529F9CC5979E490537E65D2C36DBDAB467BF5C6E27EC0E8`，不属于本次交付文件。

## 待评审文件清单

API实现和原回归：

- `api/src/employee-archives/employee-archives.service.ts`
- `api/src/employee-archives/employee-data-reviews.service.ts`
- `api/src/employee-archives/employee-draft-versioning.spec.ts`
- `api/src/employee-archives/employee-review-integrity.spec.ts`
- `api/src/employee-archives/employee-review-permissions-http.spec.ts`

新增真实数据库回归：

- `api/test/jest-personnel-daily-flow.config.json`
- `api/test/personnel-daily-flow/personnel-daily-flow.integration.spec.ts`

Web实现：

- `web/src/views/admin/UserManageView.vue`
- `web/src/views/admin/components/EmploymentRecordDrawer.vue`
- `web/src/views/admin/components/EmployeeChangeHistory.vue`
- `web/src/views/admin/components/employee-review-differences.ts`
- `web/src/utils/employee-contract-status.ts`

Web回归与配置：

- `web/e2e/specs/54-personnel-resignation-archive.spec.ts`
- `web/e2e/specs/74-employee-change-history.spec.ts`
- `web/e2e/specs/75-personnel-daily-flow.spec.ts`
- `web/playwright.personnel-daily-flow.config.ts`

交付文档：

- `docs/superpowers/plans/2026-11-02-personnel-hr-daily-use.md`
- `docs/acceptance/2026-11-02-personnel-daily-flow.md`

共18个任务文件；不含受保护的项目记忆文件、生成声明、构建产物或忽略目录证据。

## 证据与复跑

本地证据均在忽略目录，不纳入提交：

- `tmp/personnel-architect-20261102/real-db-tests.json`：最终16项真实库结果。
- 同目录 `red-real-db-tests.json`、`api-tests.json`、`api-tests.log`、`api-build.log`、`web-typecheck.log`、`web-build.log`。
- 同目录 `isolation-proof.json`、`migration.log`、`production-readonly.json`：空库、现有迁移、清理与生产只读证据。
- `tmp/personnel-daily-flow-20261102/architect-web-tests.json`、`architect-contract-date-red.json`、`architect-contract-date-green.json`及对应截图/结果目录。

当前工作区复跑一次性数据库验证：在仓库根目录运行 `node tmp/personnel-architect-20261102/run-isolated.cjs`。该本地辅助程序新建专属容器、校验空库、应用现有迁移、运行独立Jest配置，最后核对运行标记后只删除自己创建的容器；随机凭据仅留进程内存。不要替换为默认数据库的迁移/seed。

## 交付边界与下一步

第一批技术验收通过；真实数据库测试与模拟浏览器测试尚未合成一次真人浏览器联调，也不代表钉钉客户端或生产HR业务验收。未回填历史可能已丢失的真实职系、职级或离职原因；此类数据修正需要另行确认明确对象与来源。

后续先评审上述18个文件；提交、推送与上线继续等待用户明确下一步。发布时须重新核对最新生产和回滚基线，并进行真实角色路径验收。未新增提醒天数、导出字段、第三方渠道认证或第二三批功能。
