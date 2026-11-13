# 员工档案直接提交：生产发布记录

- 授权：用户明确“提交上线”。
- 代码提交：`5a2447a65a9d7c14547af5bf938304c7c45b1cab`，已推送 `origin/main`。
- 发布时间：2026-11-13 13:16（Asia/Shanghai）。
- 产品版本保持 `0.8` / 包版本 `0.8.0`。
- 生产：`https://1260cw31az927.vicp.fun`，Compose 项目 `kayford-deploy`。
- 只替换 API/Web；PostgreSQL、Redis、MinIO 容器 ID 不变。无数据库模型、迁移或依赖变化，未主动修改真实档案/申请/绩效数据。

## 本次行为

所有档案可编辑字段（含合同、绩效直属上级）在有编辑权限的操作员提交后直接生效。自动暂存仍为草稿。旧手工待审/退回单可继续编辑，部分已生效内容保留原历史；既有待审单不自动批量应用。入离职、到岗确认保留原流程，系统权限及已启动绩效任务快照不变。

## 验证

- 发布前严格档验证及真实隔离预览见 [实施验证](../superpowers/plans/2026-11-13-archive-immediate-submit-verification.md)。源码未变化，沿用本轮通过证据，无机械重复全量测试。
- 从固定提交 `git archive` 提取源码。在线依赖安装因容器到 npm 仓库不可达而取消；未重启 Docker 或生产基础设施。
- API 在固定原生产镜像的相同 Linux/Prisma 依赖上清空旧 dist 后重新编译；最终运行镜像仍为 appuser，保留原启动命令。Web 以相同锁文件依赖执行钉钉配置校验、类型检查和正式构建，使用同源 API 与正式 HTTPS 回调；未使用预览产物。镜像构建禁用网络，候选 API 语法/Nginx 配置通过。
- 发布前后 63 条数据库迁移均已应用，无失败或待执行项。
- 外网健康 JSON `status=ok`、`db=ok`；API/Web revision 和已验证镜像 ID 一致。生产环境配置一致，测试快捷登录关闭。
- 外网 index 和主入口/员工档案 JS 的 SHA-256 与运行容器相同，新直接提交文案存在，旧档案审核说明不存在；未鉴权员工接口返回 401。
- 使用既有非员工测试账号的五分钟会话，线上检查普通档案和已有手工待审单的“详情→编辑”，1440/390 视口各一次：可直接编辑、无横向溢出、无错误消息/页面异常/失败响应；没有触发任何写入、导出或外站请求。未截图、保存凭证或输出员工信息。
- API 发布后日志检查未发现 ERROR/未处理异常。真人实际提交及业务验收待用户完成；此只读线上检查不等于真实员工资料已被修改。

## 证据与回退

- 发布目录：`C:/Users/lwei/kayford-releases/5a2447a6-archive-immediate-submit`。
- 证据：`baseline.json`、`preflight.json`、`backup.json`、`offline-build-evidence.json`、`built-images.json`、`candidate-smoke.json`、`deployment.json`、`migration-status.json`、`postflight.json`、`verify-immediate-release.json` 及三个离线构建日志。
- 数据库备份：`D:/CodexTaskBackups/archive-immediate-20261113/release-backup/hrm-before-5a2447a6.dump`，2,229,096 字节，`pg_restore --list` 可读；SHA-256 `5f50531c7e5141f8e2c0bf3a6f1ed34380ac68a039d6d7ddb17773a36f936980`。已限制文件权限。
- 回滚标签：`kayford-deploy-api:rollback-before-5a2447a6`（原 `5247cb5b`）、`kayford-deploy-web:rollback-before-5a2447a6`（原 `c8c744ed`）。发布目录的 `docker-compose.rollback.json` 保留旧镜像/版本；使用相同项目、环境文件、base/prod 配置，仅以该 override 执行 `up -d --no-deps --no-build api web`。没有数据库迁移，不恢复整库覆盖后续业务。
- Docker Desktop 代理及容器外网异常未根治；本轮使用临时官方 CLI/raw socket 通道完成发布。后续发布应先复核当前容器/镜像、网络和 C 盘容量，不能把本次快照当作永久状态。
