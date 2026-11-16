# 公司目录统一隔离集成

从 `api` 执行 `node test/unified-company-directory/run-isolated.cjs`。该命令只创建带随机名称和专用标签的一次性 PostgreSQL 14 / Redis 7，Docker 自动分配未占用的回环端口；不会使用正式或固定预览环境。PostgreSQL 主版本与现场生产环境对齐。

- 拒绝存在 `api/.env` 的工作树；数据库名称强制为 `hrm_company_directory_test`，Redis 与数据库都须为回环地址及非默认端口。
- 先部署本次公司 nullable 和资料 ID 迁移之前的完整迁移，写入虚构的旧公司代码/名称，再部署两项迁移，验证旧值未变、旧分类可空且新资料关联保持空值，不推断回填。
- HTTP 用例使用 `test/test-app.ts` 的真实 Nest 应用、JWT 守卫、业务服务和 Prisma/PostgreSQL。仅存储、消息推送和钉钉同步复用已有测试替身；真实通知、机器人流及面试日历关闭，定时任务停止。
- 用例覆盖无映射目录、草稿恢复、入职审核/确认到岗、档案直接生效、合同与所属公司独立、改名/停用快照、旧草稿、再入职、实际 Excel 下载解析和普通 HR 的当前任职公司目录范围。
- 可选 `--browser` 会在独立 Vite `127.0.0.1:5190` 和动态回环 API 端口启动真实 Web 源码，使用临时 JWT，在 1440 / 390px 页面新增公司并提交入职，随后审核/确认到岗并核对数据库；不替换或拦截 API 响应，禁用自动类型声明生成。结束时关闭本轮 Web / API / Chromium。
- 此证据是自动化技术集成，不是固定预览、真人业务验收或第三方消息送达证明。

运行会保留拥有明确标签的容器，以便故障修复后只重跑受影响的集成。随机凭证仅写入被 Git 忽略的 `tmp/company-directory-integration/session.local`，不得打印或提交；Jest 结果位于同目录 `jest-result.json`。

- 继续运行：`node test/unified-company-directory/run-isolated.cjs --reuse`
- 同时运行真实 PC/手机页面：`node test/unified-company-directory/run-isolated.cjs --reuse --browser`
- 仅复验真实 PC/手机页面：`node test/unified-company-directory/run-isolated.cjs --reuse --browser-only`（结果单独保存为 `browser-result.json`，保留完整套件结果）
- 仅准备迁移环境：`node test/unified-company-directory/run-isolated.cjs --prepare-only`
- 已有隔离环境应用新增迁移：`node test/unified-company-directory/run-isolated.cjs --reuse --migrate --prepare-only`
- 仅复验字段与转正真实接口：`node test/unified-company-directory/run-isolated.cjs --reuse --consistency-only`
- 最终检查后清理：`node test/unified-company-directory/run-isolated.cjs --cleanup`

清理前逐个核对精确容器名和本轮标签，只删除本轮容器及其匿名卷。

公司统一初轮 66 个迁移和 19 项用例通过。后续资料 ID/转正一致性修复增加第 67 个迁移及 8 项真实接口用例；2026-11-16 当前完整套件 **27/27 通过**（其中 2 项为真实 PC/手机页面）。全新数据库已验证两项迁移保留历史原值。`tmp/company-directory-integration/jest-result.json` 为当前完整结果；历史 `verification.json` 的源码哈希只代表其记录的那次验证，不能套用于后续修改，本轮源码清单改存 `tmp/personnel-consistency-verification.json`。通过截图为 `browser/directory-{1440,390}.png`、`browser/onboarding-company-{1440,390}.png` 和 `browser/onboarding-submitted-{1440,390}.png`。

用户确认公司范围规则后新增 12 项真实 HTTP 角色测试，当前完整套件 **39/39 通过**（含 2 项真实 PC/手机页面）。覆盖相同目录不同旧代码、相同旧代码不同目录、缺 ID、过去/未来/重叠任职、能力边界、管理员及跨公司指派。重复运行时岗位名称带本轮唯一标识，避免隔离库保留多次虚构岗位导致定位歧义。

验证曾复现旧格式档案草稿在公司停用后被误判新选，以及新入职/再入职缺公司仍能提交；业务实现修复后完整复验通过。浏览器准备过程的模块加载/定位器调整与截图过渡动画问题属于测试环境/脚本调整，最终页面用例使用真实后端，没有接口响应替换。
