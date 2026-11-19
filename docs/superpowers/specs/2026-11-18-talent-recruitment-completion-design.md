# 人才库招聘闭环与简历解析

## 确认范围

用户已确认：HR经办跟进，面试参与人提交自己的反馈，HR管理员或明确获授录用确认权限的人确认录用；提交人不能确认自己的录用申请。一人一份人才资料，多岗位/多次应聘分别留痕。新增DeepSeek文件/拍照解析，人工核对后入库。允许用现有DeepSeek配置对虚构资料少量真实联调，不发送真实候选人数据。

本次只开发和隔离预览，未授权生产发布或真实数据维护。复用最新main，保护原根目录保留工作，产品版本不变。不建设职位发布、编制、完整Offer文书/薪资审批、渠道采购或腾讯会议房间；不开启真实钉钉日程。

## 流程与数据

人才资料不是员工、应聘也不生成工号。流程：资料入库 → 新增应聘 → 初筛/面试反馈 → 提交录用确认 → 独立HR确认 → 记录候选人接受 → 办理入职 → 原档案审核 → HR确认到岗 → 入职生效。

- Candidate新增ownerId、educationReferenceDataId，可空保留历史；负责人默认创建HR，选项仅当前在职/试用HR维护人员。人才学历使用基础资料的有效education ID；旧枚举/原文不批量改写。现有HR读写范围不收窄或扩大。
- TalentApplication：id,candidateId,positionName,recruitmentBatch?,deptId?,departmentNameSnapshot?,ownerId,stage,revision,expectedEntryDate?,hiringReason?,hiringRequestedById?,hiringRequestedAt?,hiringReviewedById?,hiringReviewedAt?,reviewReturnStage?,createdById,createdAt,updatedAt。
- stage：screening/interviewing/hiring_review/offered/accepted/declined/rejected/reserve/withdrawn/onboarding/hired。hired只能由原入职生效服务写入。onboarding只能由正式入职申请衔接写入。拒绝录用申请是退回经办，不等同淘汰候选人。
- TalentApplicationEvent：id,applicationId,actorId,action,fromStage?,toStage,version,note?,createdAt，业务时间线保留意见；通用audit仅写ID/状态/动作，不写简历、手机、薪资、意见正文。
- TalentInterview新增applicationId?；旧邀约保留独立可用。新应聘面试验证来源一致、应聘未关闭。HR管理面试，普通参与人仍只看本邀约和自己的反馈，不能读整个人才库或其他面试官反馈。
- TalentInterviewFeedback：interviewId+userId复合主键，status(draft/submitted),outcome?(pass/reject/pending),summary?,revision,submittedAt?,createdAt,updatedAt。仅当前在职参与人填写本人反馈；提交后不直接改写。HR可在录用提交前退回反馈，留痕后重提。录用审核及其后锁定反馈，不强制所有会议参与人都反馈，避免协调人员卡住流程。
- EmployeeDataChangeRequest新增talentApplicationId?。未来从人才发起新入职须指定已接受录用的应聘；既有带人才来源但无应聘的申请保持可办理。来源ID不可更换；取消入职后应聘回到accepted，HR确认到岗后置hired。既有身份/工号/到岗/审核/离职规则不变。
- 一个人允许多次应聘，但沿用候选人已有员工身份及原有“仅一份进行中入职”约束。不得创建重复员工或自动取消其他应聘。

## API契约

路径前缀 `/talent-recruitment`，非HR只有反馈接口按实际参与关系授权。写入均在事务内先锁候选人、再锁应聘、再锁邀约/反馈，核对expectedRevision及当前权限；有条件更新和业务事件/审计同事务。禁止仅靠前端菜单授权。

- GET /owners?keyword&page&pageSize → {items:[{id,name,employeeNo,deptName}],total,page,pageSize}
- GET /candidates/:candidateId/applications → ApplicationView[]（倒序）
- POST /candidates/:candidateId/applications → ApplicationView，body {positionName,recruitmentBatch?,deptId?,ownerId?,expectedEntryDate?}
- GET /applications/:id → ApplicationView
- PATCH /applications/:id → ApplicationView，body {expectedRevision,positionName?,recruitmentBatch?,deptId?,ownerId?,expectedEntryDate?}，仅screening/interviewing/reserve可编辑
- POST /applications/:id/actions → ApplicationView，body {expectedRevision,action,note?,expectedEntryDate?}
- action：start_interview(screening/reserve→interviewing),submit_hiring(screening/interviewing→hiring_review，note必填),approve_hiring(hiring_review→offered，独立确认人),return_hiring(hiring_review→reviewReturnStage，note必填),accept_offer(offered→accepted),decline_offer(offered→declined),reject(screening/interviewing/reserve→rejected，note必填),reserve(screening/interviewing→reserve),withdraw(未有进行中入职且非hired→withdrawn),reopen(rejected/reserve/declined/withdrawn→screening)。取消/退回不删除历史。
- ApplicationView含模型字段、ownerName/creatorName、allowedActions、events:[{...event,actorName}]、onboardingRequest:{id,onboardingStatus,recordStatus,cancelledAt}|null；不返回无关员工/薪资数据。
- GET /interviews/:id/feedback → {own:FeedbackView|null,items:FeedbackView[],canEdit:boolean,canReturn:boolean}；普通参与人items只含本人，HR可见全部。
- PUT /interviews/:id/feedback → 同上，body {interviewVersion,expectedRevision(首次0),outcome?,summary?,submit:boolean}。
- POST /interviews/:id/feedback/:userId/return → 同上，HR维护权限，body {interviewVersion,expectedRevision,note}，退回submitted为draft，录用送审后不可退回。
- FeedbackView含字段及userName，不带其他候选人资料。
- 录用确认权限为新增hrCapability `talent_hiring_confirm`；HR管理员(sysRole=hr)自带，其他人必须显式授予。系统管理员不因sysRole/canViewAll自动取得业务确认权；所有确认人不能是hiringRequestedById。用户设置UI提供该能力选项。

人才详情附应聘记录面板；面试详情附本人反馈/HR反馈列表，不增加一级菜单。列表支持“我的负责”“待跟进”，显示负责人和最新应聘进度。已关联入职显示原申请入口，不反复新建。

## 简历解析

- POST /talent-resume/parse，HR维护权限，multipart file。上传/拍照共用入口；内存解析，不先创建人才，不写正式候选人，不用公开文件URL。接受PDF/DOC/DOCX/JPG/JPEG/PNG，文件<=10MB，严格校验文件真实类型。
- GET /talent-resume/status → {configured:boolean,enabled:boolean,provider:'deepseek',modelId:string}。与绩效bot开关/模型独立，复用已有加密凭据管理，不切换全局服务商。
- 复用AiConfigService读取指定DeepSeek已测试凭据的受控方法；不把密钥返回浏览器/日志/审计。不新增任意外部URL配置，不自动调用其他服务商。
- DeepSeek OCR提取文档/照片文字，再以简历专用固定提示词和JSON结果提取字段。材料内容是不可信数据，不能改系统指令、触发工具或业务写入。拒绝/空结果/超时/响应超限明确报错，不泄露服务商响应或个人正文。
- 返回 {fields:{name?,phone?,email?,birthYear?,currentCompany?,currentPosition?,yearsOfExperience?,education?,school?,major?,appliedPosition?,expectCity?,expectSalaryMin?,expectSalaryMax?},reviewItems:[{field,reason}],source:{fileName,pageCount?}}。仅提取明确记载值；不从照片推年龄、性别、能力。字段白名单、长度、真实年月、电话邮箱、薪资范围做服务端验证，异常留空供人工补，不直接写库。
- 限并发、速率、超时、OCR页数/文本长度，默认真实调用关闭，隔离预览经用户授权临时启用；源文件/正文不写日志或持久浏览器存储。解析失败仍能手工录入和保留附件。
- 页面“上传简历/拍照”选取文件即解析；结果仅补当前空字段，已填字段须逐项确认替换，不静默覆盖；低可信项就近提示。保存仍是HR明确提交。修复创建成功但附件失败时重复创建：保留新ID、逐文件状态，仅重试失败文件，已成功文件不重传。

## 原缺陷与验收

修复分享创建/站内通知不原子与重放重复（增加requestId幂等）；标记淘汰后刷新列表；上传失败续传。默认不把已关闭/已入职的旧跟进列入当前待办；不引入招聘通知自动外发。

严格档：模块定向迭代，最终API全量一次、真实PG事务/权限/并发与旧入职兼容、Web类型/生产构建、PC/手机实际页面闭环。AI单独记录模拟测试与虚构资料真实API结果，不冒充真实候选人验收。预览只用隔离数据，使用固定5173前核查挂载及使用者，不重启生产，不提交/上线直到明确授权。
