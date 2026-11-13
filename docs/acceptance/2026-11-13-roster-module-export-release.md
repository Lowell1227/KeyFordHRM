# 花名册模块导出：生产发布记录

- 授权：用户明确“好 上线”。
- 代码提交：`00721ab32a80a825f75157986eeecf5346ce2f6b`，已推送 `origin/main`，远端哈希核对一致。
- 发布时间：2026-11-13 14:15（Asia/Shanghai）。产品版本保持 `0.8` / 包版本 `0.8.0`。
- 生产：`https://1260cw31az927.vicp.fun`，Compose 项目 `kayford-deploy`。
- 仅替换 API/Web；PostgreSQL、Redis、MinIO 容器 ID 不变。没有数据库迁移、依赖变更或正式人事数据修改。

## 本次行为

- 导出字段按 8 个模块组织，共 68 个可选项，支持模块全选、取消和半选。
- 弹窗只显示“预计导出 N 条记录”；导出范围继续跟随已执行的查询条件。
- Excel 参考原花名册的双层分组表头、配色和字段顺序，补充列宽、冻结、筛选及日期格式。最新合同和历史合同分开，历史合同独立工作表，不限定续签次数。
- 保持既有权限边界；仅组织维护能力仍限原 10 项。身份证、银行卡只提供录入状态，不增加明文读取能力。导出保留审计。

## 验证与边界

- 发布前模块档验证见 [预览验证记录](2026-11-13-roster-module-export-preview.md)：API 4 套 56 项、API/Web 构建、Web 类型检查、模拟 UI 13 项及真实隔离预览 4 项通过。最终源码未变化，复用可追溯的验证结果。
- 固定提交通过 `git archive` 提取。依赖锁文件、Prisma、Dockerfile、构建配置与原生产 `5a2447a6` 一致；API 使用固定原生产依赖重新编译，Web 使用同锁文件依赖与正式 API/钉钉参数重新构建。候选 API 语法、Nginx 配置及最终镜像版本均通过。
- 发布前后 63 条数据库迁移均已应用，待执行/失败均为 0。
- 外网健康 JSON `status=ok`、`db=ok`；运行镜像 ID 与已验证候选一致，环境配置保持一致，测试快捷登录关闭，API 日志未发现 ERROR 或未处理异常。
- 线上只读检查通过：外网 index、入口及人员页资源的 SHA-256 与运行容器一致；未登录字段目录返回 401，既有非员工管理员的五分钟会话读取到 8 模块、68 字段、9 个默认字段。1440×900、1024×768、390×844 均通过模块全选/半选、全局选择、重新打开保留选择、目录刷新、人数预告及底部按钮可见性检查，无横向溢出、错误消息、页面异常或失败响应。没有提交人事修改、下载真实花名册、保存截图或凭证；其他角色和实际 XLSX 内容以隔离预览证据为准。
- 首轮线上脚本误把同一路由的“未分配人数”响应作为列表总数，计数断言失败；精确匹配正式列表查询后全部通过，无产品修改。原失败和诊断报告均保留，未掩盖失败。
- 原生 Excel 人工阅读效果及真实业务验收仍待用户完成；隔离预览下载和文件回读不替代用户的业务验收。辅助 XLSX 渲染器的限制已在预览验证记录中说明。

## 证据与回退

- 发布目录：`C:/Users/lwei/kayford-releases/00721ab3-roster-module-export`。
- 证据：`baseline.json`、`preflight.json`、`backup.json`、`dependency-baseline.json`、`offline-build-evidence.json`、`built-images.json`、`candidate-smoke.json`、`deployment.json`、`migration-status.json`、`postflight.json`、`verify-roster-release.json`、`verify-roster-release.initial.json`、`verify-roster-release.diagnostic.json` 及构建日志。
- 数据库备份：`D:/CodexTaskBackups/roster-module-export-20261113/release-backup/hrm-before-00721ab3.dump`，2,229,777 字节，`pg_restore --list` 校验通过，文件权限受限；SHA-256 为 `b16c3d309ddaea55c6569d34bc676efa53f39248b08ac4aaf5ce1c4518aba9cb`。
- 运行镜像：API `sha256:7cf536a70bd156a6052fc1decf9f3682dc5fb20030915e91a7ce5fc3a51d8d17`；Web `sha256:6af150010008675da7ff8d2cc81319a16c04be05c71d3b5e1254fc1b3489c96c`。
- 回滚标签：`kayford-deploy-api:rollback-before-00721ab3`、`kayford-deploy-web:rollback-before-00721ab3`，均指向原 `5a2447a6`。发布目录保留 `docker-compose.rollback.json`；需要回退时使用相同项目、环境文件、base/prod 配置和该 override，仅执行 `up -d --no-deps --no-build api web`。本轮无迁移，不恢复整库覆盖后续业务。
- Docker Desktop 代理和容器外网异常未根治；沿用临时官方 CLI/raw socket 通道完成发布，没有重启 Docker 或基础设施。后续操作仍须重新核对现场状态。
