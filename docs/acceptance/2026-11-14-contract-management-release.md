# 合同管理修复发布记录

日期：2026-11-14，北京时间。产品版本保持 0.8。

## 状态与范围

- 已实现、已提交并推送、已上线；业务验收待用户确认。
- 功能提交：`c7e92f1910a03f4f705ef0a823ab0182ea94e347`，发布于07:07:51。
- 正式入口：[员工档案](https://1260cw31az927.vicp.fun/users)；固定隔离预览：[员工档案预览](http://localhost:5173/users)。
- 只发布 `kayford-deploy` 的API/Web，无新迁移。PostgreSQL/Redis/MinIO及预览容器ID不变，生产环境配置哈希不变，快捷登录及面试日程仍关闭。
- 页面与导出统一当前合同选择，当前可待生效，历史默认折叠；类型为首签/续签/转签。合同输入、提交及上传防护修复见 [验收对照](2026-11-14-contract-management-fixes.md)。
- 未删除、合并或修改实际历史合同；既有重复和旧版本仍保留，不称为存量去重完成。

## 验证证据

- 最终API全量158套2505项、模块40套535项及构建通过。Web合同技术35项、真实日期控件PC/手机8项、真实后端合同维护PC/手机8项通过；后者含真实下载XLSX回读、重复拒绝及附件字节验证。
- 固定提交归档构建，不读取工作树未提交业务代码；依赖锁、Prisma schema/migrations、构建配置与原线上基线相同。API复用原镜像依赖离线编译，Web用同锁依赖及正式参数构建，不声称热更新预览与正式镜像相同。
- 最终API镜像在隔离预览网络及数据库启动健康；临时Web候选以正式参数连接旧生产API仅做GET页面校验，所有写请求拦截，未发生写请求。临时候选容器已移除。
- 上线后外部健康JSON `status=ok/db=ok`；64条迁移状态完整，无新增迁移。
- 外网首页及每个尺寸47个已加载JS/CSS资源哈希与固定构建一致；1440×900和390×844的真实档案只读检查通过：当前合同类型/生效日、历史初始折叠/展开/再折叠、无横向溢出、无页面或API错误。
- 导出字段目录匿名401；既有授权身份读到当前合同默认勾选、历史未勾选。线上不下载真实花名册、不提交合同、不保存含真实人员的截图。登录使用既有非员工管理身份的短时令牌，仅内存使用；不冒称重新验证了钉钉扫码或真人HR办理。
- 本轮虚构fixture及上传文件清理确认完成。两项既有Web时间线Node测试失败未改，原生Safari与原生Excel及真实HR验收仍待完成。

## 镜像、备份与回滚

- API：`kayford-deploy-api:c7e92f19`，`sha256:a9434d646809981b23675013a8d7ab1ab74603cece25b04b498cc62c90da05ed`。
- Web：`kayford-deploy-web:c7e92f19`，`sha256:fab20ff99e5c573c88814231e91a0da3d05931fc6c0e03326d590d324c6108ee`。
- 回滚基线：API/Web均为`919905ec78a6f21f7eb832ecd949ecbe4cb3810e`，保留`kayford-deploy-api:rollback-before-c7e92f19`及`kayford-deploy-web:rollback-before-c7e92f19`。
- 发布目录：`C:/Users/lwei/kayford-releases/c7e92f19-contract-management`，包含受限ACL配置、baseline/build/backup/deployment/postflight/candidate/readonly-smoke等JSON证据及回滚overlay，不入库私密配置。
- 发布前备份：`D:/CodexTaskBackups/contract-management-c7e92f19/hrm-before-c7e92f19.dump`，2,241,618字节；SHA256 `2D6E63BA0483F6B27B1850E8432093DE17B83BE7A421FA70517D72E5EAACFFAC`，已通过pg_restore目录检查。本轮无迁移，不声称重新做过整库恢复演练。
- 回滚仅替换对应应用镜像；不可恢复整库覆盖发布后的业务操作。

## 试用步骤

1. 打开正式员工档案，进入合同材料，核对当前合同是否为最近生效日期的主合同，历史默认收起。
2. 编辑合同，类型应为首签/续签/转签；待生效是当前合同状态，不是另一分类。日期错误应在字段旁提示。
3. 导出花名册，默认包含当前合同；需要历史时再主动勾选合同历史。

自动化和只读上线检查通过不等于HR业务验收完成。历史重复数据后续必须先只读核对并获用户明确授权，才能清理。
