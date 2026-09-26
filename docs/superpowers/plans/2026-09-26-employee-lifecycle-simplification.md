# 员工全生命周期简化实施与验收

依据：已确认的 `../specs/2026-09-26-employee-lifecycle-simplification-design.md`。
授权：在 main 开发、提交、同步远端并上线。不批量改写真实员工数据。

## 实施单元与所有权

1. 档案接口与申请恢复（主任务）：真实 DTO 空值合约测试、敏感响应白名单、编辑草稿敏感值保留、退回续填、申请列表、员工/草稿取消归档、详情历史。文件限 archives service/controller/DTO/view/identity lookup 及对应测试。
2. 入离职与审核（lifecycle_implementation）：按北京时间日期生效；单申请原子审核；未审关系隔离；修订与取消待生效版本；历史补录不激活。文件限 reviews/onboarding/effective-date/timeline 及对应测试。
3. 会话边界（auth_lifecycle_implementation）：新登录和已有 JWT 同时检查当前有效任职与权限；再入职不恢复旧会话/高权限。文件限 auth/guard 及对应测试。
4. 页面（personnel_ui_implementation）：四步向导、草稿断点、办理中、取消归档、分组历史、角色按钮；接口合约与主任务对齐。文件限 Web 页面、API 类型与 E2E。

并行单元不修改同一文件；跨单元接口先沟通。全程保留其他任务改动。

## 合约

- `GET /employee-archives/applications/list`：沿用档案编辑能力；分页返回 items/total/page/pageSize，待审、退回及未生效申请（不包含纯草稿及已归档）；返回脱敏申请和关联用户摘要。
- `POST /employee-archives/restore`、`POST /employee-archives/drafts/restore`：{ ids }，沿用归档权限；逐项结果；恢复展示不恢复登录。
- 档案详情和申请响应统一过滤内部敏感字段；历史按源申请及审计事件分组，不凭日期猜测任职经历。

## 验证及发布顺序

1. 每单元先重现缺口，补行为测试，实施后运行针对性回归。
2. 集成全量 API 测试与构建、Web type-check/构建和针对性 Playwright（1440/1024/390）；在隔离数据库验证真实保存/审核/入离职。
3. 独立复核权限、并发、待生效取消、敏感信息和部分审批；发现问题先修复再发布。
4. 复核 main/origin/main、最新正式镜像和健康；仅暂存本任务文件，提交并推送核对哈希。
5. 保留正式 API/Web 回滚镜像及数据库备份；只替换需要发布的服务；如有迁移先审阅再执行。
6. 验证迁移、外部健康、静态资源、实际角色路径及测试快捷登录关闭；分别记录已实现、已提交、已推送、已上线与待业务验收。
