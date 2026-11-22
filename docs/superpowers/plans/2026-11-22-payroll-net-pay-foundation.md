# 扣缴与实发基础开发计划

> **For agentic workers:** Use subagent-driven-development or executing-plans. Preserve other work, use fictional inputs only, and keep production closed.

**Goal:** 落实已确认 S0，将个人社保、个人公积金、个税和实发列为首批必交付；先交付不依赖真实公司/参数的独立计算底层，再按后续业务答复接入完整正式链路。

**Architecture:** 复用模块化单体、Prisma Decimal、现有审批/快照/主体权限。首个工作包仅新增无外部副作用的纯函数及测试，不改变现有税前批次、API、数据模型、预览或生产。不是第三套算薪系统，后续由现有Sources/版本消费；未接线前明确标记为底层能力，不宣称页面可办理。

**Tech Stack:** TypeScript、Prisma Decimal、Jest；不新增依赖。

**Spec:** `docs/requirements/2026-11-22-payroll-requirements.md` 0.2版及正式启用清单；S0直接答复来源已记录。尚未确定的发薪主体/工资月、缴费地/基数/比例、税务身份、规则/专项扣除来源、正式授权不得由研发猜测。

## 当前批次和后续依赖

- [x] 验证S0直接答复、工作区/远端/生产基线；更新需求和启用清单。生产仍ae106896/0.9.2，薪酬关闭。
- [x] A1：独立扣缴/实发计算器，失败→通过回归、关联税前计算器测试、API编译及独立复核。本批交付；147项直接用例、3项组合与82项既有税前用例合计232项通过，完整流程尚未接线，见本日A1验收记录。
- [x] A1.5：公司名称暂缓期间推进共用能力。真实固定预览的批次详情接入不落库虚构扣缴试算，覆盖完整/缺项、两主体隔离、冻结全员和三尺寸交互；不代替A2/A3，不写正式参数或改变批准/付款。见[试算接线计划](2026-11-22-payroll-deductions-preview.md)及对应验收记录。
- [ ] A2：扣缴输入、规则生效版本、累计期初与更正账本，纳入既有来源指纹/批准版本，补跨批次与撤权并发。依赖S1及后续来源/规则确认；不能把税前入薪累计当个税已扣累计。
- [ ] A3：正式域维护、批准后税前至实发Excel与PC/手机明细；保持试算/验证/正式隔离。依赖A2和批准格式。
- [ ] A4：可审计/撤权的正式授权办理。谁能管理授权及兼任/自授规则仍归S5确认，不擅自让管理员或HR读取工资。
- [ ] A5：真实钉钉只读适配、身份/覆盖/分页/审批撤销/跨月分段回放。确认前只使用模拟响应，不改后台或权限；不恢复中间Excel算薪。
- [ ] A6：严格档API/真实PG事务及真实页面闭环、批准范围首月财务对照和明确启用授权。未解除全部适用阻断不得开放生产。

A2接线注意：既有工资归属键与个税按发放年度/月的累计键是不同维度；同月多笔支付不得重复应用月减除费用，累计已扣只能来自经确认的扣缴情形，不能取“导出次数”或税前入薪累计。缴费更正、税务更正与工资补差各保留来源/期间及原记录，后续依据业务确认实现，不通过更改A1参数冒充账本防重。旧验证批次五项税前合计/已付账本保持兼容，不能仅往其项目枚举塞负数后把合计标签改成实发。正式批准版本必须包含扣缴规则、事实和结果快照，并覆盖加密期间撤权/来源变化再检查。

## A1 技术契约

文件仅新增 `api/src/payroll/payroll-deductions-calculator.ts` 与同名 `.spec.ts`，另以 `payroll-deductions-composition.spec.ts` 证明既有税前计算器到扣缴底层的纯函数组合，不宣称数据库/页面端到端。导出 `calculatePayrollDeductions(input)`，结果包含 `status`、`issues`、`gross/socialInsurance/housingFund/incomeTax/net`（元为单位、精确到分的十进制字符串或null）及 `evidence`；状态为 `ready/needs_configuration/needs_review`。

输入强制显式提供：subjectId、employeeId、payDate、gross、rounding=`component_half_up`，两类个人缴费及个税规则/累计事实。所有金额按非负有限定点字符串（至多12位整数及4位小数），比例为0至1的小数；没有法规数值或0值缺省。每个规则有ruleVersion、evidenceRef、生效起止。个税规则与年度按实际发放日，不按工资归属月；两类缴费各自显式提供contributionDate并按其校验规则，不能默认缴费归属日等于发薪日。真实日期和月份的映射由后续来源及业务确认。

- 两类个人缴费结构均为 `{status:'applicable'|'not_applicable',ruleVersion,evidenceRef,contributionDate,effectiveFrom,effectiveTo,items:[{code,base,rate}]}`。适用至少一项，code不重复；不适用须明确依据并且空项目，才输出真实0。这里计算已确认个人缴费基数乘比例，不猜上下限、缴费地区、个人/单位分担或自动补齐险种。只计算个人额，不生成单位报表。
- 个税仅准备显式选择的 `resident_cumulative_wage` 算法分支，其他税务身份/计税方式进入待配置，不自动认定所有员工为居民。规则包括ruleVersion/evidenceRef/生效期与显式brackets（每项upTo/rate/quickDeduction，最后upTo=null），不内置税表或月费用。
- `tax.opening` 为确认过的同主体/员工/年度累计快照，必须有sourceVersion/evidenceRef/confirmed=true及显式income/exemptIncome/standardDeduction/specialDeduction/additionalDeduction/otherDeduction/taxRelief/taxPaid。`tax.current` 显式提供上述扣除/减免六项（不含income和taxPaid）。本次收入来自gross；专项扣除来自明确的税务事实，不默认等于本次个人缴费总额，也不擅自加上未确认的数值上限。依法税前其他扣除不同于尚未确认的“其他代扣”。
- 累计应税额按上述事实计算；采用显式分档率/速算扣除数，分档连续且有完整覆盖。累计应扣减去累计减免与确认已扣，本期负差不作为现金退税，记录待抵差额；负实发进入needs_review，金额不伪造为0。保留计算/版本证据和规范输入hash，不改传入对象。
- 原则依据核对[税务总局61号公告第6条](https://fgk.chinatax.gov.cn/zcfgk/c100012/c5194838/content.html)：居民工资薪金累计预扣使用累计事实，负余额不自动退税。本批不预设居民身份、现行法定参数或特殊待遇，也不处理税务申报/年度汇算、一次性奖金、跨主体合并。真实适用性和参数由业务确认。

## 验证和边界

先补直接失败断言，再实现。虚构单例：gross=10000，个人社保1000×0.1=100，公积金1000×0.1=100，虚构个税单档0.1且本次专项扣除200、其他显式扣除0、已确认期初全0，个税980，实发8820。此为数学夹具，不是公司制度或法定税率。

覆盖缺失/null与显式0、不适用依据、比例/金额格式、非法日历日和版本过期、同主体/人/年累计边界、多次同月计算的确认已扣抵减、跨年重置不推定、分档边界/连续性、减免、累计税负差不退现金、负实发挂起、重复缴费code、输入不变及hash随规则/来源版本变化。纯函数不是账本/幂等锁/累计来源验收；这些由A2补齐。

本批没有调用路径和数据库迁移，做模块定向测试与API构建；接入Sources/审批/导出后再走严格档，不因纯文档或本批提交重复已有全量。预览/正式页面维持现状，不将未接线纯函数说成完整薪酬流程已交付。
