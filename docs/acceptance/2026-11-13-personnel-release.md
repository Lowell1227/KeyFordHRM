# 人员全流程修复发布记录

## 发布状态

- 授权：用户于 2026-11-13 明确要求“请提交上线”。
- 产品版本：仍为 `0.8`，API/Web 包版本 `0.8.0`，本次不另升产品版本。
- 发布源码：`5247cb5b23e9f8af4a880fb318ba5a801337cf5c`，提交并推送 `origin/main` 后，从该提交 `git archive` 导出构建；实时远端哈希已核对。
- 生产切换：2026-11-13 07:57:58（北京时间），只重建 `kayford-deploy` 的 API/Web；旧版 `26580d94` 保留。
- 业务已验收：待用户确认。已发布和技术冒烟通过不等于真人完整流程验收。

## 范围

发布七项人员验收修复及取消入职后恢复入口修复，详见 [修复对照及测试证据](2026-11-12-personnel-acceptance-fixes.md)。包含已协调停止写入、共同验证的统一入职入口依赖：姓名匹配历史离职员工、明确选择再入职、草稿交接与迟到响应保护。未混入测试产物、环境文件或凭据。

没有修改数据库结构、审核规则、确认到岗门槛、员工身份复用、工号规则、离职时间或权限边界；没有修复或改写真实员工业务数据。钉钉面试日程开关与正式测试快捷登录继续关闭，其他运行配置逐键比对无变化。

## 验证策略

源码、依赖与测试配置未改变，复用上一轮严格档证据：API 154 套/2383 项，真实数据库集成 40 项，PC/手机真实预览完整链路 10 项及最终 4 项补验，日期、面试与关联档案专项。没有因为提交或发布再机械重复 API 全量。

本轮补充正式构建与发布验证：

- API 正式镜像编译通过；Web 正式镜像完成钉钉构建参数校验、`vue-tsc -b` 及 Vite 构建。两镜像均标记完整源码 revision，各构建一次。
- 候选 API 镜像在无网络容器中完成 14 项编译产物检查：四个用户布尔查询字段的 true/false/非法值及日期合法性；全部通过。
- 候选 Web 的 `nginx -t` 通过。候选及上线 API 均显示 63 个迁移、数据库已是最新，无待执行迁移。
- 本机和公网 `/api/v1/health` 返回真实 JSON：`code=0/status=ok/db=ok`。
- 公网 `index.html` 及四个关键 JS（入口、员工管理、人才列表、人才共享组件）SHA256 与正式容器一致，不仅检查 HTTP 200。
- 正式只读 API 检查：未归档在职列表非空；试用/归档查询过滤正确；非法布尔参数返回400；按员工 ID 读取准确档案；未认证用户查询返回401。未执行正式花名册导出，避免产生导出审计与敏感文件。
- 公网 Playwright 1440/390 宽度：按 ID 自动打开准确员工档案；入离职主入口只有“办理入职”；抽屉标题一致，第一步无未来流程块；人才库可打开；无横向溢出、页面脚本错误或失败响应。
- 只读页面校验使用既有服务管理员的短期内存会话，未更改密码、开快捷登录或持久化令牌；禁止写请求、导出与外部请求，三者实际均为0。不截取真实员工页面、不记录员工字段。不等同于真实HR/员工扫码及提交业务的验收。
- API/Web 运行正常，重启计数0；PostgreSQL、Redis、MinIO 和固定预览 API/Web 容器 ID 与发布前一致。

## 发布证据与回退

- 正式源码及 Compose：`C:/Users/lwei/kayford-releases/5247cb5b-personnel-acceptance`。
- 只读检查脚本/脱敏结果：同目录 `verify-personnel-release.cjs`、`release-smoke.json`；检查于 08:00:00 结束，`passed=true`。`baseline.json` 保留发布前容器身份。
- API 镜像：`kayford-deploy-api:5247cb5b`，ID `sha256:d7114f13fb65cadc8c6b89c9f17a6467d01927593f9d44cf547d834e8f90a70f`。
- Web 镜像：`kayford-deploy-web:5247cb5b`，ID `sha256:d3bb324c6e652b64667a9026a5b4007a3bf7c8e2c3ef670f3f4c300fa1d074ec`。
- 备份：`C:/Users/lwei/kayford-backups/personnel-acceptance-20261113/database.dump`，2,228,618字节，`pg_restore --list` 通过；SHA256 `4c09c3ab6cab8d7e11d65da5bbe7229e0646dac9751d6b78748b69d5f8c7adf4`。未将包含真实数据的备份提交仓库。
- 回滚镜像：`kayford-deploy-api:rollback-personnel-20261113`、`kayford-deploy-web:rollback-personnel-20261113`，均指向原 `26580d94` 镜像。
- 如需回退，仅以原发布目录 `C:/Users/lwei/kayford-releases/26580d94-archive-quality` 的三份 Compose 配置执行 `up -d --no-build --no-deps --force-recreate api web`，先重新核对实时版本。无结构变化，不应恢复整库覆盖发布后业务数据。

## 剩余风险

- 保留上一轮一次未再复现的草稿暂存异常观察项，未声称修复；真实扫码、实体手机/Safari、钉钉投递及腾讯会议入会不计作本轮验证。
- 正式 Web `npm ci` 报告现有锁定依赖的16项安全告警（7 moderate / 9 high），未做逐项可利用性确认，也没有在本次发布中擅自升级依赖。另有既有 PURE 注释和大分包警告。
- 仓库剩余未跟踪项仅 `e2e-artifacts/`、`web/e2e-artifacts/`，保留本地证据，不纳入发布。

## 用户试用

正式入口：<https://1260cw31az927.vicp.fun/entry-exit>。重新刷新页面后，检查统一入职入口；人才库检查参与人选择、邀请链接提取、跟进日期和“查看员工档案”。完整破坏性试用仍用隔离入口 <http://localhost:5173>，不要为了验收随意创建或变更真实人员。
