# 花名册精简与银行卡导出实施计划

> 执行方式：本会话直接执行，使用superpowers:executing-plans，保留已有未提交工作。

**Goal:** 默认9个常用字段，银行卡号复用敏感导出，补齐favicon。
**Architecture:** 扩展现有字段目录、导出服务及弹窗，不新增依赖或数据模型。
**Tech Stack:** NestJS/Prisma、Vue/Element Plus、ExcelJS/officecrypto-tool。
**Spec:** ../specs/2026-11-19-roster-bank-export-design.md

## 约束与评审重点
- 不扩大角色可见性，不读取正式身份证或银行卡，不改账号密码。
- 单选银行卡不读身份证；任何敏感GET必须拒绝；损坏密文不能降级明文。
- 默认不含合同/敏感字段；组织维护权限维持原列集合。
- 同时选择或切换敏感字段时清理逻辑不能漏验；前导零按文本保存。
- 本轮仅准备隔离预览，发布另需明确授权。

## Task 1：目录与敏感导出
- [x] 修改roster-export-data.spec.ts与sensitive-roster-export.http.spec.ts，断言9个默认列、银行卡目录/权限、GET及缺凭据拒绝、只读所选密文、正确加密及审计。
- [x] 先运行相关测试观察预期失败。
- [x] 修改roster-export-catalog.ts、users.service.ts、roster-sensitive-export.service.ts及RosterExportDialog.vue；复用解密并让错误明确指向对应资料。
- [x] API关联/全量测试、API构建、Web类型检查通过。

## Task 2：图标与真实预览
- [x] 增加PC/手机真实预览用例，API先观察缺银行卡/默认列导致失败，浏览器先观察ICO404失败。
- [x] 从现有品牌PNG生成ICO，校验文件头；不重新设计品牌。
- [x] 更新隔离预览API，运行身份证/银行卡真实下载及既有普通导出用例，独立解密校验。
- [x] 生产Web构建含ICO，核对无其他工作区文件被覆盖，记录验证与待真人验收边界。

## 执行记录
- 基线253d8278，现有招聘WIP保留。默认字段为档案权限9项，组织维护权限保留旧默认，避免扩大资料可见性。
- API93项关联通过；全量201套3504项通过。独立复核未发现阻断，追加银行卡损坏HTTP断言后该文件14项通过，生产逻辑未再变化。
- 真实预览最终12项通过/4项按原配置跳过（普通导出用例只跑desktop项目，内部已覆盖390px）；API/Web构建及类型通过。
- 初次页面运行因本机API构建与预览容器共享dist发生编译目录冲突，登录请求失败后定位超时；恢复后端健康并完整重跑上述12项通过。未扩大超时掩盖失败，生产未变。
- 仅新增验收文档，不把其他任务的project-memory未提交修改混入本轮；当前保持未提交、未上线的预览状态。
