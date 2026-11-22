# 首批月度绩效来源核查

日期：2026-11-22。对象：源码d5242516、生产API镜像ae106896（产品0.9.2）。本次只读核查/需求记录，不是新门禁已实现、真实工资试算或业务签收。

## 决定与边界

- 第4题用户选正式月度最终公示，来源回合01a2033c-f8e9-7c93-ba6f-7d9599093bbc；员工＋工资归属月唯一经核定来源，不以季度过程月评或季度总评替代。
- 同回合第5题用户消息01a2033d-e77f-7e61-90f6-f4474d5a6e00：前提为11月绩效在工资封账前已公示，随11月工资批，计划2026-12-10发放。晚公示、更正、重复来源与等级系数未因此确认。
- 第6题回合01a20340-d12a-7861-b406-cd2adedd5af8明确晚公示暂留空，待HR/财务；不默认后批/补发/预发/零，也不让未公示入已审批实发，基础工资正常办理边界另核。第7题回合01a20341-d749-7433-9726-54b9e08d3f30确认有统一正式系数表，仅确认存在/统一性，实值/批准依据/有效期未读，等级无匹配待核。
- 第8题用户消息01a20343-6e28-7c11-a3a6-aed557d3c8a8选择先核公司已有来源再定接入。本记录只证HRM当时状态，不证明公司其他渠道无正式结果；不能据此默认需要新建周期。
- 仅授权范围内核对生产周期类型/日期覆盖和公示聚合数量。未读员工姓名、个人等级/分数/明细、工资标准或薪酬表，没有改周期/任务/公示、创建工资批或支付。

## 现场证据

核对容器归属kayford-deploy/api，NODE_ENV=production、非HRM_PREVIEW，数据库身份匹配当前容器配置；Prisma事务`SET TRANSACTION READ ONLY`后验证`SHOW transaction_read_only=on`，RepeatableRead、单语句5秒限时。仅输出周期类型/频率计数，以及monthly类型且日期与下列自然月有任意交集的周期、任务、个人公示数量，不输出记录ID或个人值。

| 工资归属月 | monthly周期候选 | 任务 | 公示事实一致候选 |
|---|---:|---:|---:|
| 2026-10 | 0 | 0 | 0 |
| 2026-11 | 0 | 0 | 0 |

公示候选仅计active且非免评，任务状态published/confirmed/closed、任务与GradeResult公示时间一致且已发布、有最终等级、无未解决申诉的数量。全库有1个monthly周期，但不覆盖10/11；另有非monthly周期使用monthly打分频率，不据此推定月度正式来源。由于候选周期已为0，当前不能声称HRM覆盖首批；主体/人员资格尚未给，未核真实名单。公司其他渠道未知，不能说公司没有；此为HRM当时快照，改变后重核，不视为永久缺失。

## 代码核查

- [schema.prisma](C:/Users/lwei/.codex/worktrees/ia-align-20261122/HRM/api/prisma/schema.prisma:145)：CycleType.monthly与ScoringFrequency.monthly是两个维度；[cycle-scoring-plan.ts](C:/Users/lwei/.codex/worktrees/ia-align-20261122/HRM/api/src/cycles/cycle-scoring-plan.ts:36)允许季度/年度按月过程评分，不等于独立月度公示。
- [payroll-performance-source.ts](C:/Users/lwei/.codex/worktrees/ia-align-20261122/HRM/api/src/payroll/payroll-performance-source.ts:15)：登记指定周期、核对个人一致公示与申诉并留hash；只排除probation，尚不强制monthly，也不接收工资归属月用于核验。
- [payroll-sources.service.ts](C:/Users/lwei/.codex/worktrees/ia-align-20261122/HRM/api/src/payroll/payroll-sources.service.ts:74)：按月要求一个登记周期和official/fictional类型，但未校验周期月度类型/对应工资月；当前主体月单周期映射不证明每名适用人员已核定唯一正式来源。
- [payroll-data.service.ts](C:/Users/lwei/.codex/worktrees/ia-align-20261122/HRM/api/src/payroll/payroll-data.service.ts:186)：周期选择仍仅读预览夹具ID，正式选择未接通。“工资封账前”发布切点接线亦待明确，不把考勤封账自动当工资封账。
- 定向复核旧契约：`npm test -- --runInBand src/payroll/payroll-performance-source.spec.ts --testNamePattern 'reads an individually published result before'`，1 passed / 46 deliberately skipped，5.615秒。现有该例fixture是quarterly且返回ready，证明旧契约仍可接受季度个人最终公示；这是新月度约束待实现的证据，不是新约束验收通过，未删改断言或跑全量。

## 交付依赖与验收

1. 先由HR/绩效负责人核公司已有渠道，具体核实人待指定。最小信息为是否已有、记录类型/渠道线索、公示时间、是否最终且对应2026-11、适用覆盖能否核对；先反馈状态/元数据，不需姓名、等级或工资明细。未获授权不联系外部或读取新渠道，本次只完成HRM内部核查，其他渠道待核。
2. 依据核实结果再定正式接入契约、月度/归属月/个人唯一来源及最终公示验证；复用HRM周期还是其他受控方式未定，不先新建周期/公示或灌入临时数据。错月/未登记/冲突/未公示待核，不选最新或用0兜底。现有HRM读取monthly限定缺口保留，不能冒充已支持外部来源。
3. 按时公示随对应归属月工资批，冻结来源、个人基数、工资系数及审批版本。定义工资封账切点并在正式流程接线；晚公示和正式更正待后续答复，不擅自排批或扣回。
4. 新接口/共享来源变更按严格档验API/事务/直接下载和PC手机；证明薪酬只读、原绩效流程与权限不变。旧4312项不覆盖新增月度限定，交付后补直接回归，不以本次诊断冒充完成。

已完成HRM内部核查、公司其他渠道待HR核实；未修代码、未部署、未启用。真实工资/基数金额、统一表实值/依据/有效期、用户暂缓的晚公示、正式权限和对账仍待确认。T09未解除不得正式计发个人绩效。

第9题关联固定工资审查：用户消息01a20344-2786-7a73-b60b-4381cbbd677e选同月应出勤工作日折算，仅限月中入/离职固定工资。现有PayrollSources读取显式monthlyUnits和在职day.units，Calculator也验证共同非零分母/单位和不超分母；但尚未证明分母来自完整月同一适用日历，而非仅在职排班。现有固定与绩效共用units/monthUnits，不能把新固定工资口径自动应用绩效。日历来源/版本、全月覆盖、调休/假日、日期边界和精度列为T05/P05依赖；只有虚构数学比例证据不是正式日历验收。本轮不改代码或实际计薪。
