# 钉钉目标辅导助手 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有钉钉绩效助手升级为能够理解本人指定材料、辅导制定目标、保存私有草稿并衔接既有审核流程的业务助手。

**Architecture:** 采用“确定性业务流程 + 模型分析建议 + 有限工具接口”，不是模型自由操作业务系统的通用自主 Agent。新代码集中在 `api/src/goal-coaching/`，首版在现有 `AiProgressModule` 注册，避免反向导入造成模块循环；正式目标仍由 Tasks 模块维护。钉钉负责对话和卡片，现有 Vue 页面负责长内容核对及正式提交。

**Tech Stack:** 现有 TypeScript、NestJS、Prisma/PostgreSQL、Redis、MinIO、Vue 3、Element Plus、Jest、Playwright、Docker Compose；复用已配置模型服务。首版不引入 React、LangChain/LangGraph、独立向量库或多 Agent 调度平台；文件解析/OCR 依赖通过任务 2 的适用性验证后定案。

**Spec:** `docs/superpowers/specs/2026-10-22-dingtalk-goal-coaching-design.md`（2026-10-22 用户确认）。

## Global Constraints

- 员工先拟目标，再由主管审核确认；复用现有流程，不另建审批系统。
- 起草内容不向主管展示，员工明确提交后才进入主管处理范围。
- 上级目标与本人重点工作同时存在，不要求员工二选一。
- 会议、消息、文档是目标形成与完善的依据，HRM 是正式目标留档位置。
- 采用“单聊收材料 + 按需读取指定来源”；不做文件夹持续同步或全企业知识扫描。
- 既有试点限制仍是姚瑶（工号 312）单人，不恢复此前四人范围，不向其他人发消息，不改真实绩效结果。
- 每次最多 10 份材料、单份最多 20 MiB；原始副本解析后 24 小时内清理；私有文本、会话与未保存建议连续 30 天未使用后清理。源文件与 HRM 正式数据不随之删除。
- 不执行文档指令，不用管理员代读，不把旧 `submitIndicatorProposal` 当私有保存入口，不替换原 HRM 登录凭证。
- 本计划不是上线授权；涉及新增外部权限、服务商或共享草稿权限调整时，先报告并确认。默认关闭新功能，旧查询和进展流程保持原行为。

## Review Focus

1. 同一人兼任主管/HR：自己的私有草稿可读，但角色不能赋予读取他人草稿的能力（任务 1、3、9）。
2. 撤权发生在下载后或模型处理期间：缓存、异步结果和最终消息均不得绕过重新授权（任务 5、6、8）。
3. 辅导期间员工在原页面手改、另行提交或重复点击：不丢手工内容，不重复写，不用旧卡片覆盖新版（任务 7）。
4. 多份材料混合成功/失败、含误识别数字或伪造出处：让员工选择剩余材料，保留不确定性，不编造要求（任务 4、6、9）。
5. 删除材料后继续对话及审核退回再改：删除派生摘要和陈旧建议影响，不能把新版私有内容提前暴露（任务 1、3、10）。

## 0. 当前基线、交付物与执行闸门

本计划编写时 HEAD/main 为 `26331c1`，已有 origin/main 引用为 `1661504`；未刷新远端，未访问生产。已存在的 `docs/project-memory.md` 与三份人事 Web/测试修改不属于本任务，保留且不提交。

交付的是现有 HRM 的一个业务子功能：钉钉目标辅导入口、私有材料/会话服务、专业目标辅导规则、原任务页中的核对界面、草稿写入适配以及测试/发布证据。不是单独安装的桌面软件，也不是只有提示词的演示。

依赖顺序：任务 1、2 确定真实边界 → 3 私有会话 → 4 材料接收/解析与 5 指定来源读取 → 6 目标辅导 → 7 安全保存 → 8 钉钉接入 → 9 原页面核对 → 10 全链验收及发布准备。

任务 1 是现有共享草稿行为的验证闸门，任务 2 是外部接口与解析能力闸门。若需设计变更，先修订相应设计和任务，再执行依赖任务；不能用 mock 成功或上传替代方案宣称直连接入完成。

执行前重新读取 AGENTS、设计、最新 Git 状态与已注册工作区，选择无冲突的隔离工作区。所有实现、迁移和业务角色测试先使用一次性测试数据及模拟钉钉/模型传输；不得读取本地生产 `.env` 来运行测试。每任务遵循失败测试 → 最小实现 → 通过测试 → 仅该任务文件提交，提交前 `git diff --cached --check`。

下文 `api`/`web` 命令均在对应目录执行；文件列表中的 `.spec.ts` 指同名配套测试。任务 1/2 的产物是证据和精确契约，不是生产开关操作。

## 1. 核实原目标草稿的隐私与版本边界

**Files:** 新增 `api/test/suites/goal-draft-privacy.e2e-spec.ts`、`api/test/jest-goal-draft-privacy.json`、`docs/superpowers/specs/2026-10-22-goal-draft-privacy-evidence.md`；只读追踪 `api/src/tasks/{tasks.service.ts,team-tasks.service.ts,indicator-visibility.service.ts,indicator-version.service.ts}`、`api/src/objectives/objectives.service.ts` 及其控制器/导出调用方。

**Interfaces:** 输入真实控制器和隔离角色；输出每个读取路径的 `owner / manager / unrelated / hr / admin` 矩阵、泄露复现、现有已提交快照是否可复用的结论。未达标时 `draftSaveReady=false`，不得启用任务 7 的正式保存。

- [ ] 创建独立 Testcontainers 配置，参照 `api/test/jest-ai-progress.json` 和既有隔离集成测试；显式断言没有外部数据库、真实模型或钉钉出站。
- [ ] 写 `privateDraftIsOwnerOnly`：员工保存含唯一标记的未提交目标，主管/HR/管理员/同部门其他人通过详情、列表、参考目标、地图、历史、导出均不得得到该标记；合法业务元数据可保留。角色兼任不能扩大范围。
- [ ] 写 `returnedDraftDoesNotReplaceSubmittedView`：提交版本 A 后退回，本人私改 B；非本人不能看 B，已提交 A 按既有授权可见。包括原页面编辑，不只助手保存。
- [ ] 运行 `npx jest --config test/jest-goal-draft-privacy.json --runInBand`，记录每条实际结果，失败是风险证据而非可忽略历史债务。
- [ ] 对失败路径写明最小修复影响：统一内容投影、必要的草稿/已提交版本分离和历史兼容；若现有模型不足，提出迁移方案并取得单独确认。不得只隐藏前端或用空数组造成主管覆盖目标。
- [ ] 通过隐私修复的独立批准与验证后才能解除闸门；本任务先提交测试/证据，不把未知修复包装成已完成。保存标记的历史数据迁移不得凭状态猜历史内容。

## 2. 验证指定来源及解析能力，固定可执行契约

**Files:** 新增 `docs/superpowers/specs/2026-10-22-goal-material-contracts.md`；新增 `api/src/goal-coaching/source-contracts.spec.ts` 及纯虚构协议 fixtures，放 `api/test/fixtures/goal-coaching/`。

**Interfaces:** 输出各来源 `CapabilityReceipt={kind,status,identityMode,resourceLocator,readEndpoint,requiredPermissions,revocationCheck,limits,evidence}`。`status` 为 `verified | needs_authorization | unavailable`；不存在的接口不得填写猜测 URL。

- [ ] 查阅钉钉官方机器人消息、下载、文档和纪要接口，记录 API/SDK 版本及操作人身份；不要以 DWS 命令目录存在替代服务端认证契约。无新增权限时先用公开协议和虚构 HTTP 响应验证适配。
- [ ] 写 `cannotUseAdminTokenToReadSelectedSource`、`unknownMergedForwardIsNotFullConversation`、`minutesMetadataIsNotTranscript`，锁定身份不降级和未支持资源明确报错。
- [ ] 运行 `npm test -- --runInBand source-contracts.spec.ts`，确认测试先拒绝缺失契约，再以验证后的 fixtures 通过；只约束已验证协议，不伪造产品可用性。
- [ ] 为 DOCX/PDF/XLSX、PNG/JPEG 和语音转写建立有中文、表格、扫描件、损坏/加密文件的虚构样例。XLSX 优先现有 ExcelJS；评估 DOCX/PDF/OCR 的维护状态、许可证、Node/容器适用性和 CPU/内存边界，形成唯一依赖选型及版本锁定记录，不自己写不可靠的通用解析器。
- [ ] 新服务商、OCR/多模态外发、应用权限和真实资源读取范围需单独确认；此时只列清所需动作。获授权后用姚瑶明确指定的非敏感测试资源验证读取及撤权，记录脱敏回执，不持久保存凭据或原文。
- [ ] 提交契约与样例。若某项不能实现，向用户报告对首版范围的影响；相关连接器任务暂停，不自动扩大到整库搜索、人工浏览器代读或个人 CLI 登录态部署。

## 3. 建立本人私有会话、版本和材料元数据

**Files:** 新增 `api/src/goal-coaching/{goal-coaching.types.ts,goal-coaching-session.service.ts,goal-coaching-session.service.spec.ts,goal-coaching-access.service.ts,goal-coaching-access.service.spec.ts}`；修改 `api/prisma/schema.prisma`、`api/src/ai-progress/ai-progress.module.ts`；新增经本地隔离数据库生成的命名迁移 `goal_coaching_private_sessions`。

**Interfaces:** `GoalCoachingAccessService.assertOwner(viewer:AuthUser,sessionId:string):Promise<CoachingSession>`；`GoalCoachingSessionService.create(viewer:AuthUser,corpId:string,taskId?:string):Promise<SessionView>`、`append(viewer:AuthUser,sessionId:string,expectedRevision:number,text:string):Promise<SessionView>`、`excludeMaterial(viewer:AuthUser,sessionId:string,materialId:string,expectedRevision:number):Promise<SessionView>`。

会话保存 owner/企业/任务、递增 revision、阶段、活动及到期时间；材料保存归属、来源、来源验证状态、选择状态、位置、解析警告与清理时间；轮次保存版本和最小上下文；建议保存输入材料版本、候选、任务基线。辅助记录不参与正式评分。通过数据库唯一约束控制入站 deliveryId 和保存操作键；响应不返回凭据、对象内部 key 或他人内容。

- [ ] 写 `onlyOwnerCanResume`、`employeeWithoutApprovedGoalsCanStart`、`staleTurnCannotOverwrite`、`excludedMaterialInvalidatesDerivedSummary`、`disabledUserCannotRead`。预期跨人/错企业 403、旧版本 409，排除材料后所有派生上下文失效。
- [ ] 运行 `npm test -- --runInBand goal-coaching-session goal-coaching-access`，记录失败。
- [ ] 实现上述接口；复用 `BotEligibilityService.resolveIdentity/resolveRecipient` 及员工身份检查，但不复用要求已有可更新进展目标的 `resolve`。无任务可先辅导，绑定任务时必须本人、有权且无歧义。
- [ ] 使用事务与版本条件更新序列化同会话变更；跨日会话存 PostgreSQL，不沿用短期 Redis 进展草稿作为唯一存储。内存/Redis 锁不是持久幂等证明。
- [ ] 运行相关测试、`npx prisma validate`、`npm run build`；用临时库迁移并验证重启后数据及归属不变，再提交本任务文件。

## 4. 接收、隔离存储和解析多种材料

**Files:** 新增 `api/src/goal-coaching/{goal-material.service.ts,goal-material-parser.ts,goal-material.types.ts}` 及配套测试；修改 `api/src/storage/{storage.service.ts,storage.controller.ts,storage.controller.spec.ts}`；新增任务 2 定案的解析依赖到 `api/package.json`/lockfile。

**Interfaces:** `GoalMaterialService.ingest(viewer:AuthUser,sessionId:string,input:MaterialInput):Promise<MaterialView>`；`parseMaterial(input:ParseInput):Promise<ParsedMaterial>`。`MaterialInput` 是文字、经验证下载码、受控文件或来源引用的判别联合；`ParsedMaterial={segments:[{id,text,locator}],warnings,complete}`，locator 是真实页码/段落/工作表单元格或图片编号，不是模型编造值。

- [ ] 写 `maxTenMaterialsAndTwentyMiB`：10 份和 `20*1024*1024` 字节可接收，第 11 份及超 1 字节拒绝；并发上传也不能越限，拒绝前不调用模型。
- [ ] 写 `privateObjectCannotUseGenericDownload`、`privateObjectCannotUseAnonymousMinioUrl`、`zipBombAndMimeSpoofRejected`、`partialParseIsVisible`、`voiceWithoutTranscriptNeedsInput`；普通 `/storage/download` 即使知道 key 也必须拒绝新私有前缀；同时核实并测试 MinIO 策略，不能仅保护 API 而允许匿名直读对象。
- [ ] 运行 `npm test -- --runInBand goal-material storage.controller`，确认失败；实现 `goal-coaching-private/` 隔离前缀、材料归属后的下载接口，不给公共永久 URL，不复用无归属通用上传作为读权限。
- [ ] 实现任务 2 已验证解析器；解析在受限 worker 中运行并可终止，初始工程上限为解压 100 MiB、1000 个条目、30 秒，超限提示选择范围。入站流和解压过程都执行上限，不能先全量解压后检查；这些为技术保护参数，不是平台配额声明。
- [ ] OCR/扫描件仅在已验证且获授权的能力下处理；转写缺失保留输入并说明，中文数字不可靠时标注。删除材料必须清除其片段、摘要和关联有效建议，不仅改列表显示。
- [ ] 在目标 Docker 运行时验证解析样例、异常边界和峰值资源，相关测试及 API 构建通过后提交；未通过的类型不能标记已支持。

## 5. 按本人权限读取指定文档与纪要

**Files:** 新增 `api/src/goal-coaching/{dingtalk-source.service.ts,dingtalk-document.reader.ts,dingtalk-minutes.reader.ts,dingtalk-source.service.spec.ts}`；按任务 2 记录的最小契约扩展现有钉钉调用服务，不复用管理员个人会话。

**Interfaces:** `DingtalkSourceService.readSelected(viewer:AuthUser,ref:SelectedSource):Promise<SourceReadResult>`、`revalidate(viewer:AuthUser,ref:SelectedSource):Promise<void>`；`SelectedSource={corpId,kind,resourceId}` 只由受支持 URL/资源标识解析而来，`SourceReadResult` 提供任务 4 的片段、验证出处和读取时间。HTTP 认证形式严格来自任务 2 receipt。

- [ ] 写 `revokedAfterDownloadBlocksAnalysis`、`redirectToLoopbackDenied`、`wrongCorpDenied`、`noLinkFollowingFromDocument`、`expiredLinkIsActionable`；在模型调用前与会话恢复时重新验证，而非只下载时校验。
- [ ] 运行 `npm test -- --runInBand dingtalk-source`，确认失败；实现固定允许域名、协议、DNS/IP/重定向校验，下载大小及请求期限，令牌不回传、不进日志或模型。
- [ ] 实现文档与纪要读取，分别保留能力状态；纪要未生成不是空成功，部分块读取失败不是完整成功，拒绝悄悄用另一个操作人重试。
- [ ] 核对源内容引用与改版时间；必要时提示重新读取。撤权后禁止再次分析缓存原文，已生成正式 HRM 数据不因此擅自删除。
- [ ] 运行契约测试及 API 构建，获授权的受控样例实读证据完整后提交。单元 mock 通过只证明实现，不证明企业授权或真实可读。

## 6. 目标辅导能力与受控模型调用

**Files:** 新增 `api/src/goal-coaching/{goal-coaching.service.ts,goal-coaching-context.service.ts,goal-coaching-provider.ts,goal-coaching.rules.ts,goal-coaching-response.ts}` 及配套测试；从 `api/src/ai-progress/provider-client.ts` 提取同目录 `provider-transport.ts` 并补测试，保持 `recognize` 签名、错误和五字段解析不变。

**Interfaces:** `GoalCoachingService.analyze(viewer:AuthUser,sessionId:string,expectedRevision:number,selectedMaterialIds:string[]):Promise<CoachingResult>`、`revise(viewer:AuthUser,sessionId:string,expectedRevision:number,instruction:string):Promise<CoachingResult>`；`CoachingResult={revision,summary,questions,candidates,conflicts,warnings}`。候选有稳定 suggestionId、目标字段、`evidence:[{materialId,segmentId,claimKind}]`、missingFields；claimKind 区分原文要求、助手建议、本人确认。

- [ ] 写 `canStartWithoutMaterials`、`upperGoalsAndOwnWorkCoexist`、`noInventedBaseline`、`qualitativeGoalNotForcedPercentage`、`rejectUnknownSourceCitation`、`injectionCannotSubmit`；虚构岗位事实、第三人信息、隐藏分数不得进入模型上下文。
- [ ] 运行 `npm test -- --runInBand goal-coaching-provider goal-coaching-response goal-coaching.service provider-client`，记录失败。
- [ ] 提取共享 HTTP 传输但不共享业务提示词/响应 schema；沿用 `AiConfigService.getActiveRuntimeConfig()`，明确无启用服务商时报错，不硬编码当前服务商或密钥，不新建自动 fallback。
- [ ] 实现版本化目标辅导规则、确定性来源校验、最多一个优先澄清问题及字段校验；目标权限、可编辑阶段、任务选择始终由服务端决定。材料与用户文字是数据，模型不能返回任意工具调用直接执行。
- [ ] 限制模型预算：单次总请求投影最多 262144 UTF-8 字节，超过时让员工选材料/章节；HTTP 最长 60 秒、响应最多 262144 字节、候选输出最多 8192 tokens；不静默截断、不无界循环。供应商不支持时显式报告配置兼容问题。
- [ ] 调用前复核选定材料、供应商与会话版本；结果提交时再次比较版本，过期结果不得进入当前会话；失败保留原建议和输入。传输异常只返回安全错误代码。
- [ ] 运行辅导测试、原进展识别回归和构建；固定合成评测样例覆盖定量、定性、冲突、无材料、退回修改，记录结果后提交。

## 7. 草稿差异预览和原业务服务内原子保存

**Files:** 新增 `api/src/goal-coaching/{goal-draft-bridge.service.ts,goal-draft-bridge.service.spec.ts}`；修改 `api/src/tasks/{tasks.service.ts,tasks.service.spec.ts,tasks.module.ts}`，新增 `api/src/tasks/employee-indicator-draft-save.service.ts` 及测试；操作回执模型随本任务迁移加入 `api/prisma/schema.prisma`。

**Interfaces:** `preview(viewer:AuthUser,sessionId:string,revision:number,changes:GoalDraftChange[]):Promise<DraftPreview>`；`save(viewer:AuthUser,previewId:string,idempotencyKey:string):Promise<DraftSaveReceipt>`。`GoalDraftChange` 为 add(candidateId)、replace(indicatorId,candidateId)、remove(indicatorId) 判别联合；预览存完整基线、候选版本、差异和指纹，不接受客户端未展示字段的任意覆盖。Receipt 返回 taskId、保存后版本、操作编号，不含提交动作。

- [ ] 前置：任务 1 隐私闸门已通过，且所需共享改动获批准；否则只提供私有建议，禁止称“已保存 HRM 草稿”。
- [ ] 写 `saveNeverNotifiesManager`、`duplicateSaveHasOneReceiptAndOneWrite`、`sameKeyDifferentPayloadRejected`、`manualEditCauses409`、`taskSubmittedDuringPreviewRejected`、`preservesUnselectedGoalsAndAlignments`、`crashAfterWriteRetriesSafely`。
- [ ] 运行 `npm test -- --runInBand goal-draft-bridge employee-indicator-draft-save tasks.service`；并在隔离 PostgreSQL 中做双请求和故障注入，不以单进程锁代替证明。
- [ ] 将现有员工 save 分支的校验/规范化/版本认领/审计抽成 Tasks 内部可组合事务方法，原 HTTP 入口继续调用它；新桥接不能直接写 IndicatorInstance，也不能先调用独立事务再另外落幂等回执。
- [ ] 在同一数据库事务内验证归属与任务状态、claimTaskVersion、合并完整草稿、执行合法 save、写唯一回执。显式 `action='save'`；旧 DTO 默认 submit，不能依赖默认值。无通知、无自动提交、无评分变化。原规范化逻辑会补默认权重：预览必须呈现其最终效果并标明默认建议，不能在员工看见的差异之外暗填；未知目标数值保持未知。
- [ ] 现有保存会替换指标实例：专项验证未选择目标的内容、对齐和被引用关系。若已存在进展/版本/外部引用，不能直接套用删建；先定界最小稳定 ID 更新方案并确认，不以复制字段假装保全关系。
- [ ] 全量 API 测试、构建及隔离幂等测试通过后提交。未完成的数据保护和隐私测试必须继续阻断正式保存开关。

## 8. 钉钉消息分流与明确动作

**Files:** 修改 `api/src/dingtalk/{dingtalk-bot.gateway.ts,dingtalk-bot.gateway.spec.ts}`、`api/src/ai-progress/ai-progress.module.ts`；新增 `api/src/goal-coaching/{goal-coaching-bot.handler.ts,goal-coaching-bot.handler.spec.ts,goal-coaching-card.presenter.ts}`。

**Interfaces:** `GoalCoachingBotHandler.handle(sender:BotSender,event:VerifiedBotEvent):Promise<CoachingReply|null>`；null 表示继续原流程；回复/卡片统一通过原发送边界再次验证接收人。新操作标识 `coach_analyze`、`coach_continue`、`coach_preview`，不占用原进展 `save`。

- [ ] 写 `queriesStillRouteBeforeCoach`、`progressStillRecognized`、`ambiguousIntentAsksNotWrites`、`revokedBeforeDeliverySendsNothing`、`groupNeverDownloadsMaterial`、`plainOkayNeverSavesOrSubmits`。
- [ ] 运行 `npm test -- --runInBand dingtalk-bot.gateway goal-coaching-bot.handler`，记录失败；在原身份/应用/单聊检查后再分流，非文字不再一律拒绝，但只支持任务 2/4 已验证类型。
- [ ] 新配置 `DINGTALK_GOAL_COACHING_ENABLED` 默认 false；关闭时旧流程完全兼容。会话输入需要选择/继续，模糊进展与目标意图只询问一次，不强吞全部文字进入辅导。
- [ ] 输出材料清单、明确分析动作、候选摘要和原页面核对链接；卡片仅放不敏感摘要，材料不进入可转发的公共卡片参数。实际模板新增/发布独立申请，不在本任务直接发布。
- [ ] 使用虚构回调与模拟传输验证卡片契约/旧五类模板回归；通过后提交。测试脚本必须断言所有其他员工和群投递次数为零。

## 9. 同一个任务页面内核对材料、建议与差异

**Files:** 新增 `web/src/api/goal-coaching.api.ts`、`web/src/views/task/components/GoalCoachingPanel.vue`、`web/src/types/goal-coaching.ts`、`web/e2e/specs/goal-coaching.spec.ts`、`web/playwright.goal-coaching.config.ts`；修改 `web/src/views/task/TaskDetailView.vue`；新增 `api/src/goal-coaching/{goal-coaching.controller.ts,goal-coaching.controller.spec.ts}` 和该目录 `dto/` 中精确请求 DTO。

**Interfaces:** 登录后继续现有 `/tasks/:id`，query `coachingSession` 只选择本人私有面板，不授予权限；未绑定任务的对话仍在钉钉继续，选定任务后才进入原页。REST `/goal-coaching/sessions` 下提供本人会话、材料、分析、修订、预览和保存接口；所有身份来自 JWT/已验证回调而非 body.ownerId。

- [ ] 写 PC 1280 与手机 390 宽用例：材料逐项状态、长名称/文本滚动、失败字段旁提示、排除材料、来源与建议区分、版本冲突不丢输入、明确保存后的“草稿未提交”；无材料仅对话起步也能展示候选。
- [ ] 写 `forwardedSessionLinkShowsNoPrivateContent`、`loginReturnsToOriginalTaskAndSession`；测试身份失效后再次加载，不能短暂显示其他用户缓存。新增 Playwright 配置只 mock HTTP，不调用默认真实账号 globalSetup。
- [ ] 运行 `npx playwright test --config playwright.goal-coaching.config.ts` 确认失败；API 先写 owner/跨人/错误版本控制器测试再实现。
- [ ] 实现原页面展开面板及差异预览，复用现有编辑组件/字段校验。不得出现另一个“目标制定”路由和第二套正式表单；不改登录应用凭证、原提交审核按钮及流程。
- [ ] 运行 API 相关测试/构建、`npm run type-check`、`npm run build` 和专用 Playwright；检查 PC/手机实页截图后提交。网页命中不等于真实手机钉钉免登通过。

## 10. 清理、全链隔离验收与受控发布准备

**Files:** 新增 `api/src/goal-coaching/{goal-coaching-cleanup.service.ts,goal-coaching-cleanup.service.spec.ts}`、`api/test/suites/goal-coaching.e2e-spec.ts`、`api/test/jest-goal-coaching.json`、`docs/runbooks/dingtalk-goal-coaching-pilot.md`；在已有模块注册清理任务，运行证据保存在忽略目录而非仓库。

**Interfaces:** `GoalCoachingCleanupService.purgeExpired(now:Date):Promise<{rawRemoved:number,sessionsRemoved:number,failed:number}>`，只处理数据库确定归属的辅助对象，不使用广泛路径删除；失败可重试，派生摘要和建议同步失效。审计只记操作编号/主体/时间/结果。

- [ ] 写 `parsedRawRemovedWithin24h`、`inactiveSessionExpiresAt30d`、`deleteRemovesDerivedContext`、`cleanupNeverDeletesOfficialGoalsOrDingtalkSource`、`expiryNoticeDoesNotMessageOtherPeople`；用虚拟时钟测试边界，失败解析材料也必须有 24h 临时副本清理期限。
- [ ] 运行清理测试失败后实现定时清理和本人页面到期提示；不为到期提醒新增后台钉钉自动通知。备份淘汰按核实后的政策，不声称立即擦除所有备份。
- [ ] 实现隔离端到端：收混合材料→本人选材料→澄清→改建议→原页预览→保存→重复点击→再提交并由模拟主管审核；验证原通知存在但传输是 fake，无真实员工结果变化。
- [ ] 运行 `npm test -- --runInBand`、`npm run build`、`npx jest --config test/jest-goal-coaching.json --runInBand`；Web 运行类型检查/构建、专用辅导测试及原登录/AI 进展/绩效查询针对性回归。测试失败如实归因，不改业务需求迁就测试。
- [ ] 自查设计 1–12 项验收与本计划 Review Focus；做独立代码审查，修复阻塞项再记录代码提交与未验收项，提交测试/运行手册。此次计划不承诺全部外部能力必然通过。
- [ ] 另行请求生产授权：精确提交、生产最新基线、迁移与配置差异、可识别回滚镜像、备份恢复验证、只替换 API/Web；新能力起初关闭，不重建数据库/Redis/MinIO。
- [ ] 获授权后按原受控发布流程实施，先外部健康/迁移/资源，再只姚瑶验证对话、材料读取、页面和免登；任何真实草稿写入、正式提交或新增收件人另行明确。不得全局关闭正常员工通知来实现单人测试。

## 完成定义与计划自查

- 当前完成：设计获确认，实施计划文件形成；未实现新功能，未迁移，未安装依赖，未调用真实材料/模型，未访问或变更生产。
- 代码完成：上述本地测试及审查通过，源接口证据/未支持能力明确；不等于已上线。
- 首版业务完成：已授权功能在姚瑶真实客户端按设计验收，其他人零投递；真实主管链路若未授权测试，继续标记未验收。
- 覆盖核对：材料入口→2/4/5；无材料及专业辅导→3/6；隐私与原任务写回→1/7；钉钉和页面体验→8/9；安全、期限、角色与生产限制→各任务及10。全部设计范围均有任务或明确闸门，没有把受阻项算完成。
- 执行方式待用户选择：主代理连续实施并在阶段末独立审查，或逐任务由子代理实施/独立审查。两种方式都先过任务 1/2，不开始生产操作；计划批准与执行方式确认后才进入开发。
