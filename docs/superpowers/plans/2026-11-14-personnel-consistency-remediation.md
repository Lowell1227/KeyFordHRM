# 员工全生命周期一致性评审与修缮计划

> **For agentic workers:** 用户已接受本计划，并确认 D01。当前执行到隔离预览，尚无提交或发布授权。使用 superpowers:subagent-driven-development 或 superpowers:executing-plans，按任务更新复选框，不并行改同一文件。最新证据见 `docs/acceptance/2026-11-14-personnel-consistency-audit.md`。

**Goal:** 收拢入职、档案、任职、离职和再入职之间的入口、数据、状态、权限及日志差异，使同一业务从不同入口办理时结果一致。

**Architecture:** 保持模块化单体及现有员工身份、申请、任职、审计模型。复用现有服务和组件，以后端业务约束为准，不建设第二套审批、字典或日志系统。

**Tech Stack:** NestJS、Prisma、PostgreSQL；Vue 3、Element Plus；Jest、Playwright；既有隔离 Docker 预览。

**Spec:** 本次用户要求“扩大评审范围，把问题显现出来列出修缮计划”；既有边界依据 `AGENTS.md`、`docs/project-memory.md`、`docs/superpowers/specs/2026-11-12-talent-personnel-lifecycle-design.md`、`docs/acceptance/2026-11-13-archive-immediate-submit-release.md`、`docs/acceptance/2026-11-13-onboarding-company-release.md`。旧设计中与后续用户确认不一致的内容，以后续已确认规则为准。

## Global Constraints

- 计划编写阶段仅复核；用户确认后允许本范围代码修缮和隔离预览验证。不改数据库结构、真实数据、授权规则和生产服务，不提交或推送。
- 员工档案可编辑字段显式“提交”即生效；自动保存仅为草稿。不得重新引入普通档案审核或宽松审核开关。
- 入离职沿用既有审核；新人须 HR 确认到岗，不能仅因日期到达而启用。
- 离职只涉及人员状态及 HRM 权限停用；最后工作日次日北京时间零点起生效，晚审核按既有规则处理。
- 再入职复用原人员身份及历史，通过既有机制生成新任职工号；取消归档不等于再入职或恢复登录。
- 所属公司来自合同主体目录，内部公司代码显式映射；不推测真实映射、不批量改历史快照。
- 不扩大审核、日志、附件或导出权限；不改变已启动绩效周期的关系快照。
- 只用隔离虚构数据，默认关闭外部通知、日程及其他外部副作用。不能用 API 代办绕过页面缺陷后宣称页面验收通过。
- 固定验收入口 `http://localhost:5173`；生产 `https://1260cw31az927.vicp.fun` 的发布另等明确授权。
- 保留所有非本任务改动和既有测试产物，不清理 `walk/`、环境文件或凭据。

## Review Focus

1. 同一人跨人才、入职、任职、归档、再入职入口，不能生成重复身份或绕过生效门槛。对应 T1、T2、T6。
2. 北京时间零点、未来排期、迟到审核、失败重试时，计划状态不能冒充实际完成。对应 T2、T5、T6。
3. 双窗口、重复点击、自动暂存迟到响应、审核与编辑并发，不能覆盖新数据或重复发号。对应 T1、T6。
4. 字典改名/停用、长文本、非法日期、空值和旧数据缺项，应分别保留历史、拒绝不合法新输入。对应 T3、T4、T6。
5. 只有编辑权、只有审核权、普通员工及失权人员访问页面/API/日志/附件/导出时，结果和范围一致。对应 T1、T5、T6。

## 1. 基线与证据等级

- 2026-11-14：工作区及远端 `main` 为 `80147044f98a71cf08ad9c354966e97d8f798660`；生产 API/Web 镜像标签均为 `c7e92f19`。两者之间为发布说明，无业务源码差异。
- 开始本轮时仅有未跟踪 `e2e-artifacts/`、`web/e2e-artifacts/`，均保留；后续修缮改动另在执行记录登记。
- 上一轮专项复核完成代码路径追踪、真实服务的纯内存复现及 4 套/60 项既有内存单测。本轮仅补充有限代码与测试覆盖阅读、Git/容器事实复核，未重新执行完整页面流程。
- 以下 F 项是已确认的代码/内存层问题，不表示已在正式员工账号复现；R 项是待核实风险，不是新增缺陷。
- 已有 Web 时间线两项测试失败另记 V01，须判定测试夹具问题还是产品问题，不能删除断言或混称全项目全绿。
- 计划起点状态：问题及计划已整理，修缮未实施。用户确认后的当前进度与证据单独记录，未提交、未上线、未业务验收。

## 2. 扩展范围

主线：`人才转入职 / 直接办理 / 历史离职人员 -> 审核 -> 确认到岗 -> 员工档案 -> 任职变动 -> 离职 -> 归档 / 再入职`。

横向只检查这条主线使用的基础资料、候选选择器、权限、草稿、合同、日志、列表与花名册导出。人才库只扩到身份关联和入职交接；绩效只检查关系变动不污染冻结快照。

不纳入本轮：薪酬结算、资产交接、招聘渠道/Offer、审批引擎重建、真实钉钉/腾讯集成、全站性能改造、绩效算分规则、真实历史数据自动清洗。

## 3. 已确认问题台账

路径均相对于仓库根目录；行号为本次基线定位，实施时重新核对。

| 编号 | 级别 | 问题与业务影响 | 证据位置 | 修缮包 |
| --- | --- | --- | --- | --- |
| F01 | P1 | 普通新增任职可选已离职，并保留 transfer 类型、空最后工作日；审核后立即改离职并禁用绑定，绕开正常离职日期约束，但没有绕过审核权限 | `web/src/views/admin/components/EmploymentRecordDrawer.vue:203`；`api/src/employee-archives/employee-data-reviews.service.ts:701`、`:920`；真实服务内存复现得到 resigned、loginDisabled=true、leaveDate=null | T2 |
| F02 | P2 | 新人选岗位后仍能编辑岗位名称、职系；提交提案却被岗位目录值覆盖，填写内容与实际结果不一致 | `web/src/views/admin/components/EmployeeCreateDrawer.vue:805`；`api/src/employee-archives/employee-archives.service.ts:370` | T3，先确认 D01 |
| F03 | P2 | 档案绩效上级未使用 direct_manager 资格过滤，可选待入职人员，提交时后端拒绝 | `web/src/views/admin/components/EmployeeArchiveInlineEditor.vue:470`；`api/src/users/users.service.ts:156`；`api/src/employee-archives/employee-data-reviews.service.ts:1036` | T3 |
| F04 | P2 | 再入职预填历史岗位 ID，停用后下拉没有对应项；缺少可理解的回显/提示，提交才报错 | `web/src/views/admin/components/EmployeeReentryDrawer.vue:86`；`api/src/positions/positions.service.ts:34`；`api/src/employee-archives/employee-onboarding.service.ts:626` | T3 |
| F05 | P2 | 学历/民族新人入口限制 50 字，档案提交只检查 profile 为对象；超长输入存在落库失败风险 | `api/src/employee-archives/dto/employee-archive.dto.ts:48`、`:248`；`api/prisma/schema.prisma:675`；51 字 DTO 内存比较 | T4 |
| F06 | P2 | 手机号、学历等直接修改已记审计，但档案 history 未取这些 user 事件；申请前后快照又同步为相同值，用户看不到完整变更 | `api/src/employee-archives/employee-archives.service.ts:919`、`:1344`、`:1886` | T5 |
| F07 | P2 | 更换已有身份证/银行卡，脱敏前后均为 Configured=true，展示层无法辨认具体哪个敏感字段更换 | `api/src/employee-archives/employee-data-change-view.ts:35`；`web/src/views/admin/components/employee-review-differences.ts:67` | T5 |
| F08 | P2 | 档案日志与办理日志动作映射不同；确认到岗显示为记录更新，退回重提后档案日志未展示历史退回原因 | `web/src/views/admin/components/EmployeeChangeHistory.vue:44`、`:67`；`EmployeeApplicationDetail.vue:324` | T5 |
| F09 | P2 | 重提节点没有每轮字段差异，顶部仅最终提案；后端 revisionHistory 未被日志视图用于还原每轮审核资料 | `api/src/employee-archives/employee-onboarding.service.ts:119`；`web/src/views/admin/components/EmployeeApplicationDetail.vue:333`；`EmployeeChangeHistory.vue:15` | T5 |
| F10 | P2 | 离职抽屉依据浏览器日期推算已生效，不以 appliedAt/实际状态为准；计划时刻后可能与详情状态不同 | `web/src/views/admin/components/EmploymentRecordDrawer.vue:43`；`EmployeeApplicationDetail.vue:204` | T2 |

F03/F04、F06-F09 是上一轮汇总问题的细分，不把细分数量描述为本轮新增缺陷。

## 4. 待核实风险矩阵

| 编号 | 核查范围 | 必须核实的结果 | 状态 |
| --- | --- | --- | --- |
| R01 | 身份与入口 | 同名、同人才重复点击、待到岗人员重复办理、已归档再入职；关联到同一正确 ID，工号不重复/不复用旧任职号 | 真实隔离主线通过；不处理正式历史身份冲突 |
| R02 | 状态与生效 | 普通编辑、任职补录、未来任职、取消/恢复、延期到岗、晚审核、归档；不得覆盖当前任职或提前开关账号 | 页面主线及技术边界通过；未跨真实零点或操作正式旧排期 |
| R03 | 并发与恢复 | 草稿迟到响应、双窗口、重复审核/到岗、编辑与审批冲突、提交中断；事务回滚、版本提示、保留输入均有效 | N08 已修复并通过真实 PC/手机与并发 HTTP；O01 偶发重载失败未归因 |
| R04 | 权限与数据范围 | HR 经办与审核分别验，普通员工/主管不能越权，角色撤销后旧页面不能继续写；日志、附件、导出不扩大读取 | 分工、旧页撤权及同 token 日志/导出拒绝通过；附件旧 URL 重放待独立验证 |
| R05 | 基础资料全生命周期 | 新增、重名、改名、停用、重新启用、旧值回显与页面返回刷新；历史名称快照保留，新选受启用状态控制 | PC/手机真操作全链通过，N07 已修复；N09 查询竞态技术红绿通过 |
| R06 | 输入与清空 | 边界长度、真实日历、空串/null/未传、必填关系、历史缺项；页面就近校验和 API 校验一致 | 真实长度/修正/清空重开与导出通过；日期/type/null 技术覆盖 |
| R07 | 读取与导出 | 同一虚构员工在列表、档案、办理详情及 Excel 的当前任职、公司、主管、合同、日期一致；导出跟随已应用筛选 | 关键字段及筛选范围真实通过；不宣称全部 68 字段穷举或原生 Excel 人工验收 |
| R08 | 日志与移动端 | 正式事件不漏不重复、分轮可追溯、敏感标记安全、草稿不混成生效；PC/手机操作和错误可达 | 真实 PC/手机及截图通过；旧缺失操作者不补造 |

每项记录“入口/角色/输入/实际结果/预期/证据/结论”；证据不足标待核实。停止条件是矩阵覆盖及已确认问题有处置，不是不断扩大模块。

## 5. 需确认的业务决策

- **D01 岗位与职系（已确认）：**2026-11-14 用户确认随岗位只读，特殊情况先维护岗位目录。新选目录岗位后名称、职系随目录；不批量改写旧任职快照，无目录 ID 的历史值保留。执行证据见本轮验收记录。
- **D02 通用字典：**学历、民族、婚姻状况等目前是自由文本，不是两套字典。建议本轮只统一校验；若改成受控字典，另确认选项、旧值兼容和维护权限，不自动转换存量。
- **D03 审核组织方式：**当前按明确能力授权审核，不是自动只派给某位 HR，也未全面禁止自审。本轮核实权限边界，不新增审批角色、节点或自审禁令。
- **D04 历史数据：**合同重复、缺失旧审计和旧排期只做只读清单。修代码不等于批准清洗正式数据；清理需 HR 逐项确认、备份、可追溯方案。

## 6. 分批实施任务

三批交付：A 数据与生效安全（T2）；B 表单和下拉一致性（T3/T4）；C 日志与完整闭环（T5/T6）。T1 先锁定问题范围，每批完成后更新同一预览，不新增环境。

### T1：补齐评审证据并冻结本轮范围

**Files:** 本文；拟新增 `docs/acceptance/2026-11-14-personnel-consistency-audit.md`。只读检查 `api/src/employee-archives/`、`api/src/users/`、相关人事页面和基础资料组件。

**Interfaces:** 输入为 F01-F10、R01-R08；输出为每项明确结论、复现用例和修复归属，不能用“未发现”替代“未验证”。

- [x] 核对届时 Git、未提交改动、预览隔离及现有测试证据，保护其他工作。
- [x] F01-F10 已补服务/组件失败用例并修缮；真实后端页面证据与技术层证据分开登记，不称正式员工已复现。
- [x] 以 R 矩阵逐项补证并标明未验证范围；新缺陷有独立编号、文件、输入和实际结果，无实证不列缺陷。
- [x] 记录 D01 决策；对未批准新功能/历史数据处置保持冻结。

### T2：堵住生命周期旁路，统一实际生效判定

**Files:** `api/src/employee-archives/employee-archives.service.ts` 的 `createEmploymentRecord`；`employee-data-reviews.service.ts` 的 `applyProfile`；必要时 `employee-effective-date.service.ts`；`web/src/views/admin/components/EmploymentRecordDrawer.vue`；`web/src/views/admin/UserManageView.vue`。

**Tests:** `employee-lifecycle-boundaries.spec.ts`、`employee-effective-date.service.spec.ts`、`employee-archive-submit-apply.spec.ts`；`web/e2e/preview/personnel-lifecycle.spec.ts`。

**Interfaces:** 保留既有 API/DTO；普通任职不得成为新的入离职入口。离职提交返回既有申请 ID，复用 `openSubmittedApplication(requestId)`；显示实际结果使用后端 `appliedAt` 和现有进度解释，不把浏览器日期当成完成证明。

- [x] 补 F01 回归：在职人员 transfer + resigned + 空最后工作日不能提交/批准成当前离职；校验失败不得写任职、改账号、禁用绑定。
- [x] 补边界技术回归：正式离职最后工作日全天有效、次日生效；晚审批；待到岗不能靠普通任职启用；结束历史补录不改当前状态/任职；重复请求幂等。
- [x] 在提交及批准路径补最小必要约束，保留合法历史补录和原审批权限。旧待审问题单明确提示修订，不静默改其类型或日期。
- [x] 移除普通任职中诱导生命周期变更的选项；离职提交后打开同一申请详情，状态读取后端 appliedAt；未来日期只作预计信息。
- [x] 模块回归及严格档 API、真实集成通过；未写正式排期。正式旧排期仍需独立只读核对，不宣称生产存量已验收。

### T3：统一字段主从关系、候选资格和历史值回显

**Files:** `EmployeeCreateDrawer.vue`、`EmployeeArchiveInlineEditor.vue`、`EmployeeReentryDrawer.vue`、`EmploymentRecordDrawer.vue`；`web/src/components/common/UserSelect.vue`、`PersonnelReferenceSelect.vue`、`EmployeeCompanySelect.vue`；仅在确认必要时修改对应 API。

**Tests:** `api/src/users/users.service.spec.ts`、`api/src/personnel-reference-data/personnel-reference-data.spec.ts`、`api/src/employee-archives/employee-company-mapping.spec.ts`；`web/e2e/specs/68-personnel-reference-data.spec.ts`、`web/e2e/preview/onboarding-validation.spec.ts`、`unified-onboarding.spec.ts`。

**Interfaces:** 延用 `eligible-for="direct_manager"` 和既有共源目录。目录历史值可回显但不能因此开放停用项新选；岗位名称/职系覆盖行为严格按 D01 记录。

- [x] 先写 F02-F04 对应用例：最终保存值与页面承诺一致；待入职/归档/离职人员不能作为不合格上级候选；停用岗位能解释并要求重新选用有效值。
- [x] 统一各入口资格参数、旧值标签、字段关联和刷新行为，保持岗位/直属主管/权限不同概念。
- [x] 用虚构基础资料验证新增、重名、改名、停用、显式申请启用并审核、返回表单刷新及旧快照保留；公司映射缺失保持明确阻断。N07/N09 与证据分层见执行记录。
- [x] 检查 PC/手机长名称、下拉搜索、加载失败重试与不丢已填值；拦截接口测试只算交互层证据，新人/再入职目录值保存另有真实后端验证。

### T4：统一字段校验和空值语义

**Files:** `api/src/employee-archives/dto/employee-archive.dto.ts`、`employee-archives.service.ts`；`web/src/utils/employee-archive-fields.ts`、`onboarding-validation.ts` 及上述表单。复用现有日期校验，不顺手重构无关字段。

**Tests:** `dto/employee-archive.dto.spec.ts`、`employee-direct-apply.spec.ts`、`employee-archive-submit-apply.spec.ts`；`web/e2e/preview/onboarding-validation.spec.ts`、`archive-immediate-submit.spec.ts`。

**Interfaces:** 不改现有持久化结构；长度按现有字段模型。对每个可空字段区分未传/保持、显式清空、必填禁止清空；不把草稿可保存等同正式提交合法。

- [x] 先补 F05 的 50/51 字边界及非字符串输入；针对 R06 已证实差异补真实日历、空串/null/未传回归。
- [x] 同一字段采用一致的服务端规则和字段旁错误；新人在当前步骤点下一步即检查，档案提交失败保留输入并定位字段。
- [x] 正式提交、重开、导出三处核对学历清空结果；非法日期由共享校验及既有真实日期控件回归覆盖，不声称所有字段逐一页面穷举。
- [x] 不扩大数据库列，不借校验变更强制补齐所有旧缺项；旧值兼容与新输入校验分别测试。

### T5：统一正式日志数据与展示

**Files:** `api/src/employee-archives/employee-archives.service.ts` 的 `history`/直改写点；`employee-data-reviews.service.ts`、`employee-data-change-view.ts`、必要的 `employee-onboarding.service.ts` 留痕；`web/src/api/employee-archives.api.ts`；`web/src/views/admin/components/EmployeeChangeHistory.vue`、`EmployeeApplicationDetail.vue`、`employee-review-differences.ts`、既有 `PersonnelProcessTimeline.vue` 及 `personnel-process-timeline.ts`。

**Tests:** `employee-direct-apply.spec.ts`、`employee-data-change-view.spec.ts`、`employee-arrival-confirmation.spec.ts`、`employee-onboarding-recovery.spec.ts`；`web/tests/personnel-lifecycle.test.cjs`、`personnel-recovery.test.cjs`；拟新增 `web/e2e/preview/personnel-history.spec.ts`。

**Interfaces:** 复用现有审计与申请事件，通过白名单纳入 `employee_profile_direct_update`；展示统一为时间、操作者、动作、业务状态、字段差异、原因。敏感字段仅增加安全变更标记，例如可选 `changedFields: string[]`，不得传号码、密文、指纹；兼容无新标记的旧记录。

- [x] 补 F06：学历、手机及混合提交技术用例通过；正式历史能找到操作，同一提交不重复记生效动作；学历修改有真实页面证据。
- [x] 新事件明确携带可验证的提交/版本关联；旧直改事件没有申请关联时独立展示，不按相邻时间硬挂申请。未知操作者标未记录，不冒充系统操作；只有 appliedAt 的旧记录不补造审计事件。
- [x] 补 F07：更换已有敏感字段可辨认“已更换”，接口/日志/截图不含原值或新值；旧记录未知则显示未记录，不推测。
- [x] 补 F08/F09：退回后连续两轮重提，原因不丢、每轮差异对应当时快照，确认到岗及实际生效动作命名一致。
- [x] 共用动作/状态/时间格式和差异渲染规则；保留现有权限。自动草稿显示“未提交”中性节点，不混成正式提交或生效，不删除审计来源。
- [x] 草稿保留为独立中性节点；本轮不引入可选的连续草稿折叠，避免吞掉正式事件。重复到岗及投影边界技术回归通过；跨真实零点重复调度/审计未单独实测，列为剩余验证边界。
- [x] 处理 V01：真实时间排序、版本快照和稳定排序分别验证；旧断言与新日志规则逐项对齐，未删断言；PC/手机已检视展开、长文本和操作人可读性。

### T6：整链验收、证据汇总和交付

**Files:** 复用 `web/e2e/preview/personnel-lifecycle.spec.ts`、`unified-onboarding.spec.ts`、`archive-immediate-submit.spec.ts`、`linked-archive.spec.ts`、`roster-module-export.spec.ts`；API 使用对应权限、版本、身份和生效用例。汇总到 T1 的验收报告。

**Interfaces:** 消费 T2-T5 的同一候选版本；输出缺陷对照、验证对象/命令/结果、PC/手机截图、已知剩余风险及四类交付状态。

- [x] 使用不同虚构账号完成 HR 经办提交、HR 审核、确认到岗；只有编辑权者不能执行审核/到岗，未以自办自审代替分工证明。
- [x] PC/手机真实页面完成人才或直接入职、建档、编辑、离职、归档、再入职；选人、选字典、确认及打开准确档案均用页面，不 API 代办。
- [x] 回归退回重提、取消恢复、历史停用值、重复办理、双窗口冲突及越权请求；核对工号、身份、正式档案、任职历史、日志和账号状态。北京时间边界为技术层，未跨真实零点调度。
- [x] 导出只用虚构员工，比较列表筛选人数及当前公司/任职/主管/合同字段；历史合同仍须主动选择。原始 Excel 结果与页面截图分开留证，未做原生 Excel 人工验收。
- [x] 最终候选完成严格档 API 全量/关键集成、API 构建、Web 类型检查/构建及针对性 Playwright。全量 2653 项中 8 项旧夹具失败，补齐后两套 26 项通过，业务源码未再变；复用其余通过证据。N09 仅 Web 修改，补对应验证及构建，不再跑 API 全量。
- [x] 给用户固定预览 `http://localhost:5173/entry-exit`、`/users`，说明本批改变和短试用步骤；用户业务验收未完成，生产发布另等明确授权。

## 7. 验证命令与安全门槛

以下为验证命令模板，已执行的精确命令和结果见本轮验收记录。真实集成前按 `docs/development-preview.md` 核对 `HRM_PREVIEW=true`、库/文件隔离、虚构身份及外部副作用关闭，禁止继承生产环境连接。

```powershell
# api 目录：迭代示例，按任务替换为直接覆盖的文件
node node_modules/jest/bin/jest.js --runInBand --no-cache --coverage=false --runTestsByPath src/employee-archives/employee-lifecycle-boundaries.spec.ts src/employee-archives/employee-effective-date.service.spec.ts
# api 目录：最终严格档候选
npm test -- --runInBand
npm run build
# web 目录：最终候选
npm run type-check
npm run build
node --test tests/personnel-lifecycle.test.cjs tests/personnel-recovery.test.cjs
npx playwright test --config playwright.preview.config.ts personnel-lifecycle.spec.ts unified-onboarding.spec.ts onboarding-validation.spec.ts archive-immediate-submit.spec.ts linked-archive.spec.ts roster-module-export.spec.ts
```

集成证明必须是真实后端与隔离数据库，Jest 内存替身或 Playwright 拦截接口仅标技术/交互证据。新增 `personnel-history.spec.ts` 后加入最终命令。预览 desktop/mobile 均执行；手机尺寸模拟不冒充实体 Safari 验收。

## 8. 协作、完成条件与发布边界

- 项目经理维护台账、D 项决策、范围和证据；API 负责人串行管理 `employee-archives.service.ts` 等共享文件；Web 负责人管理复用表单/日志；独立验收复核角色和异常路径。可并行分析，不多方同时覆盖同一文件。
- 每批以最小可验收结果交付。仅暂存该批文件；提交前检查 `git diff --cached --check` 和清单，不因写计划自动提交。
- P1 修复有直接回归；F 项逐项标已复现/已修复/已验证/遗留，R 项全部有结论或明确阻塞。不用百分比宣称完备。
- 日志可回答“谁在何时改了什么、为什么退回、哪轮通过、何时真正生效”；保存草稿、提交成功、审核通过、实际生效分别显示。
- 待业务决定的 D 项不由智能体擅自落地；发现需要修改真实数据、扩大权限或迁移模型时另行确认。
- 文档完成不等于业务代码完成；预览通过不等于已提交/上线/业务验收。生产发布沿 AGENTS.md，固定目标提交、按受影响服务发布并保留回退点，不恢复整库覆盖后续业务。

## 9. 本轮文档交付检查

- [x] 读取规则，核对 Git、远端及生产镜像事实。
- [x] 整理既有确认问题、补充有限源代码和测试覆盖复核。
- [x] 将扩展范围分为已确认 F、待核实 R、待业务决定 D。
- [x] 形成三批任务、文件归属、回归断言及验收/发布门槛。
- [x] 用户确认修缮范围及 D01，已开始执行；记录见 `docs/acceptance/2026-11-14-personnel-consistency-audit.md`。

计划编写阶段仅新增本文；用户确认后进入实施和预览，不更新生产、不代用户完成业务验收。扩展真实页面评审按 T1/T6 执行并逐项记录。
