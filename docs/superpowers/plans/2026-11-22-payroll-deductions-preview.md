# 虚构扣缴试算接线计划

**Goal:** 公司名称暂缓时继续共用开发，将A1接到已有真实预览工资批次，直接查看税前→个人缴费→个税→实发，而非另建静态页或伪造已审批实发。
**Architecture:** 复用既有PayrollBatchesService、主体授权/事务锁/来源检查、A1纯函数及批次详情；无新模型/迁移/依赖。新动作严格限已有虚构预览，不保存/提交/导出/入薪，不影响正式通道。使用当前工作区，保留其他工作，不部署生产。
**Spec:** S0、S1a、S1b最新直接答复及本日正式启用清单。实际公司/员工映射、工资月份、实际缴费/个税参数和正式授权不推断。

## 范围与接口

- API `POST /payroll/batches/:id/deductions-preview`，DTO仅 `expectedVersion:number`、`payDate:YYYY-MM-DD`、`mode:'complete'|'missing'`，不接收客户端工资/人员/公司/税务事实。真实日历日并且处于该虚构批次payMonth；不可缺省日期或滚动非法日期。
- 先按批次头校验既有payroll_edit，再验证用途非formal、既有preview-guard及local/payroll虚构标记。主体和所有工资人员必须是payroll_preview_fixture_v1或专用payroll_deductions_preview_fixture_v1（fictional=true、state=ready）中明确登记的虚构资料，并核对虚构名称/工号和无钉钉绑定；不得靠名字猜身份或把生产伪装成preview。专用夹具仅新增自己的虚构资源/授权，不能改原预览标记、标准或业务历史。
- 复用主体事务锁及ReadCommitted锁后重读/撤权检查；校验批次expectedVersion、最新版本、完整五项/金额、来源新鲜度。calculated/pending要复用assertFresh；approved用冻结考勤冲突检查，不因普通入薪累计变化误判。其他状态或缺项不能以0试算。
- 按最新已核算行的employeeId汇总本批amount作为本次税前，不读客户端gross/entitlement替代；应核人员不能省略。不要求真实公司名称，两个已登记虚构主体分别算且隔离。
- 完整样例用独立fixture helper明确生成虚构个人缴费、虚构单档税表和确认零期初；缺项样例只使一人缺少税务参数，真实返回needs_configuration。无正式默认规则或配置持久化。缴费归属日用虚构归属月，个税年用显式发薪日，跨年独立。
- 返回 `{batchId,batchVersion,calculationVersion,calculationVersionId,subjectId,sourceHash,payDate,payMonth,mode,basis:'fictional',approvalStatus:'not_submitted',rows,totals}`。每行 `{employeeId,employeeName,...A1Result}`；totals为`{gross,socialInsurance,housingFund,incomeTax,net}`，仅全部ready才有，否则null。元为单位、两位小数字符串。请求不创建/修改审批、工资、配置、事件、入薪或导出记录。
- 原正式导出仍只含批准的税前版本，不接纳本试算结果；不能将新试算明细当正式工资单。

## 前端

- 在现有PayrollBatchDetail增加专用无卡片嵌套区域，提取组件PayrollDeductionsPreview.vue。不新建路由/导航。仅VITE_PREVIEW_MODE、非formal、payroll_edit、当前可试算版本可见。
- 组件props为`batch`、`disabled`，事件`busy:boolean`绑定父忙碌/离开保护；无自动请求。`data-testid=payroll-deductions-preview`，日期输入aria-label=试算发薪日，初始空值，就近校验；两个模式“完整参数”“缺项检查”，按钮“试算”。显示“虚构试算 · 未纳入审批”。
- 改日期/模式、批次/版本/主体、切换历史或卸载时清除旧结果并丢弃迟到响应；失败有就近错误/可重试，禁止重复请求。父动作忙碌时禁用，无权限不能触发请求。
- PC表格、手机复用MobileResultCard，展示姓名、税前、个人社保/公积金/个税/实发及待配置/待核对状态；缺项不能显示0。依据按需展开，不默认铺满JSON；只在隔离页展示虚构计算证据。

## 分工与验收

- [x] API工作包：BatchesService及spec、Controller、DTO/spec、虚构helper；4套186项定向回归通过，含冻结应核员工完整性及既有批次回归。
- [x] Web工作包：专用组件、BatchDetail、payroll.api/types；新8项及既有15项定向交互/契约回归，类型检查通过。替代HTTP不冒充真实集成。
- [x] 主集成：真实HTTP/PG19项、真实页面1440/1024/390三个尺寸通过；日期/完整/缺项/重试/已审批版本/换主体与只读权限均验证，所有薪酬表及3项标记前后指纹一致。历史版本/迟到响应另由定向组件覆盖。
- [x] 严格档：集中API全量230套4312项及API/Web构建通过，固定预览API更新一次。新接口主体能力、锁后撤权、formal/非虚构、日期/版本/输入覆盖由直接单测与真实集成分层证明；未碰生产。
- [x] 限域独立复核无可复现P1/P2；验收与状态记录已形成。提交/远端同步以本轮Git交付回执为准，未开启薪酬。

最终证据和未决正式项见[验收记录](../../acceptance/2026-11-22-payroll-deductions-preview.md)。不是生产启用或人事/财务签收。
