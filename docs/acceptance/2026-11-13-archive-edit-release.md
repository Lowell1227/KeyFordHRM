# 员工档案编辑提示修复发布记录

- 授权：用户于 2026-11-13 明确要求“上线”。
- 产品仍为 0.8；功能提交 `c8c744edb9c4713b1a4139d313e35343f564eaa0` 已推送 main，实时远端哈希一致。
- 2026-11-13 11:46:54（北京时间）仅替换生产 `kayford-deploy` Web。API 仍为 `5247cb5b`；API、PostgreSQL、Redis、MinIO及固定预览容器的 ID 全部保持不变。
- Web 镜像 `kayford-deploy-web:c8c744ed`，ID `sha256:3d8feb6f2a40c3a5373ff81fa739676245f58b5924e387bbd5332cc8c7236aee`，revision 为完整功能提交号。运行正常、重启数0，保留80端口映射。
- 生产测试快捷登录保持关闭。没有迁移、后端规则变化或真实员工资料写入。

## 范围与验证

修复范围及预览证据见 [编辑入口验收记录](2026-11-13-archive-edit-entry.md)。复用源码及配置相同的8项定向回归、4项既有编辑回归、PC/手机真实隔离预览结果；没有重复API全量测试。

从固定提交 `git archive` 导出干净源码，仅构建一次正式Web镜像。钉钉生产构建参数校验、`vue-tsc -b`、Vite构建均通过。候选镜像独立启动验证Nginx、SPA路由、API反代健康、新交互文案及旧重复冲突文案删除后，复用同一镜像上线。

公网健康接口返回真实JSON：`code=0/status=ok/db=ok`。公网首页、入口JS和员工管理JS的SHA256均与生产容器一致；新交互文案存在，旧重复冲突文案不存在，匿名人员接口返回401。

11:50完成生产只读页面检查：使用已有非员工管理员身份，桌面1440×900、移动390×844均正常打开档案并进入编辑，编辑前重新读取最新资料；没有自动写入、导出、外部请求、错误提示、失败响应、页面异常或横向溢出。此次线上样本为正常编辑入口，待处理原单及并发冲突沿用隔离预览证据，未在生产制造申请或冲突。没有保存认证信息或生产员工截图；真实HR提交及业务验收仍待用户确认。

## 证据与回退

- 发布目录：`C:/Users/lwei/kayford-releases/c8c744ed-archive-edit-entry`。包含源码副本、三份Compose配置、构建日志、`baseline.json`、`candidate-smoke.json`、`deployment.json`、只读检查脚本及`verify-archive-edit-release.json`。
- 原Web回滚镜像：`kayford-deploy-web:rollback-archive-edit-20261113`，对应 `5247cb5b`，ID `sha256:d3bb324c6e652b64667a9026a5b4007a3bf7c8e2c3ef670f3f4c300fa1d074ec`。
- 回退仅将本发布目录的Web镜像指向该回滚标签，以正式仓库为project-directory/正式`.env`、本目录三份Compose及项目名`kayford-deploy`执行 `up -d --no-build --no-deps --force-recreate web`。先核对实时生产状态；不恢复数据库或替换API。
- 两处原有 `e2e-artifacts/` 保留在本地，未提交或打包。
