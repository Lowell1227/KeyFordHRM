# 配置总览与可操作配置页

2026-11-28。用户明确要求：“展示的配置要能配”“招聘邮箱也是，有配置路径但是没有配置页面，请统一加上”；另要求招聘二级菜单按业务顺序排列。本轮实施配置与菜单，不自动扩展到招聘体验清单的其他整改，不变更生产配置，不代表获得发布授权。

## 目标与现状

管理员从总览进入后，能够填写、保存、核验及明确应用对应配置；刷新、重启后保存仍有效。不能继续在帮助和总览之间循环。总览默认完整展示，DeepSeek、简历解析等已就绪项目也能找到。

基线为 `origin/main=197651f9`，正式 API `59f79183`、Web `0f34bc22`、产品0.9.3。本轮在 `configuration-editors-20261128` 隔离树实施；旧工作树的声明改动和招聘评审、待办文档原样保留。

当前11项平台配置包括三家AI服务商、简历解析、钉钉登录/通知/面试日程/招聘需求/考勤、招聘邮箱及薪酬启用授权。AI已有真实维护API；其他多数为环境配置及说明，邮箱还在构造时缓存适配器。既有19个配置导航目标中的工资规则、档案和审核关系等属于原业务维护流程，保留原权限、历史快照及审批，不造一套平行设置。

## 方案与边界

采用既有配置回退、数据库受控覆盖、管理员明确应用的方案。只改链接或提供部署文案无法满足可配置需求；直接改服务器环境文件既难审计，也难保证预览隔离。复用 SystemConfig 保存加密JSON，无需为每项单独加表；所有秘密使用既有主密钥和独立AAD命名空间加密，API不返回秘密。

新增小型运行设置读取层，只有明确允许的业务键可覆盖，其他仍走 ConfigService。保存草稿与应用分开；启动只加载生效配置。读取异常不得静默换用另一套凭据。当前单API实例运行快照更新，测试应证明重启恢复；不声称多副本即时一致。

配置分组：

- `dingtalk-app`：共享企业应用身份、Agent ID及登录公开参数。不要在各功能重复保存另一套主应用凭据。
- `dingtalk-login`：使用共享身份的登录参数入口，可与共享应用页合并呈现；登录前端读取后端公开参数。
- `dingtalk-notifications`、`dingtalk-calendar`、`recruitment-demand`、`payroll-attendance`：对应平台开关、业务字段；通知业务总开关继续复用已有接口。
- `recruitment-mail`：用户追加明确要求多个招聘收件邮箱，并确认“也要支持 QQ、163 等常见邮箱”。管理名称、服务商、账号、客户端授权密码、准确文件夹、读取起始时间、启用及读取状态；每个账户独立配置、核验、应用和进度。固定阿里企业邮、QQ、网易163/126四个TLS预设，不开放任意主机/端口，不自动同步邮件，不新增SMTP发信。
- `ai-resume`：独立解析开关及DeepSeek凭据入口，不诱导开启目标进展机器人。
- `payroll-access`：启用与现有主体授权入口；不附送工资读取/发放权限，不绕过首月签收。

## API与交互契约

新增管理员接口 `/system/configurations/:id`：

- `GET`：公开配置视图；`PUT { expectedRevision, values }`：保存草稿。
- `POST /test { expectedRevision, sampleInstanceId? }`：核验当前草稿版本。
- `POST /apply { expectedRevision }`：明确应用当前版本。

视图 `SystemConfigurationView` 至少包含 `id/title/description/revision/appliedRevision/source/encryptionReady/fields/verification/verifiedAt/verificationMessage/testKind/requiresSample`。`source`为`deployment|database|none`；`verification`为`unknown|untested|passed|failed`；`testKind`为`connection|scope|configuration|none`。

字段 `SystemConfigurationField`：`key/label/type/required/value?/configured/help?/options?`，`type`为`text|secret|boolean|datetime|textarea|select`，options为`{label,value}[]`。秘密不返回value，省略表示保留；页面空密码不清除已有密码。表单使用服务端白名单定义，未知项目/键拒绝。缺项贴字段提示，409保留输入，刷新后核对当前版本再提交。

保存不产生外部调用；测试不应用、不导入业务；应用不自动读邮件、同步审批、发送消息、创建日程或取考勤。修改使旧测试失效，测试版本和共享身份依赖须匹配。审计只记录项目、字段名、版本及动作，不存输入值或密码。

可复用的核验：邮箱使用已有只读 `probe()`，不抓正文或附件；招聘需求只读明确获准的已知样本，不写需求台账；钉钉应用连接核验不得描述为业务日程/消息/考勤权限已验收。仅本地核验的项目明确命名为“核对配置”，不能伪称连接测试成功。

所有配置读写/核验/应用仅系统管理员；保存和应用须核实当前账号资格，不能仅依赖旧JWT。公开登录配置接口只返回公开应用参数和是否可用，不返回Secret或数据库配置。保留现有账号、绑定和需求历史。

### 多邮箱追加契约

- 管理集合 `GET/POST /system/configuration-mailboxes` 返回配置视图数组／新邮箱视图；新项稳定ID为 `recruitment-mail:<uuid>`，复用编码后的配置GET/PUT/test/apply。保留原部署邮箱为兼容项，不自动覆盖。
- 招聘经办 `GET /recruitment-intakes/mailboxes` 只返回 `id/name/enabled/configured/lastSyncedAt`，无账号密码；状态及同步按 `mailboxId` 明确选定。多账号时不静默选择一个，也不自动读取全部。
- 邮箱状态、租约、游标、失败收尾和最后读取时间都按账户及完整读取范围隔离；不得继续共享 `primary`。现有状态ID列长度20，若用短散列键必须同时核对完整scope，不能静默合并。
- 稳定账户ID不跟密码变化；凭据轮换保留读取进度，账号／提供商／目录／起始范围变更产生新的scope，保留旧历史。导入收件可追溯原邮箱。
- 一个邮箱停用或失败不影响其他邮箱；配置保存、测试与应用不替代经办的明确收件动作。预览的外部隔离不受可编辑开关解除。
- 服务商字段 `RECRUITMENT_MAIL_PROVIDER` 值为 `alimail|qq|netease163|netease126`。旧阿里私有配置、scope和primary历史兼容；接管同一范围不能重置进度或重导邮件。

预设参数依据：腾讯官方[QQ客户端协议示例](https://main.qcloudimg.com/raw/document/product/pdf/1270_46586_cn.pdf)、网易官方[客户端设置及126参数说明](https://help.mail.126.com/faqDetail.do?code=d7a5dc8471cd0c0e8b4b8f4f8e49998b374173cfe9171305fa1ce630d7f67ac25c12dcb3d46222b6)、[飞书官方第三方邮箱参数](https://www.feishu.cn/hc/zh-CN/articles/360049067809-%E7%AC%AC%E4%B8%89%E6%96%B9%E9%82%AE%E7%AE%B1-imap-smtp-%E5%9C%B0%E5%9D%80%E5%92%8C%E7%AB%AF%E5%8F%A3)。均用TLS993；账号须已开通IMAP，使用客户端授权码。参数核对不等于已登录真实邮箱验收。

## 必须一起生效的消费者

共享钉钉读取、token缓存身份快照、登录公开参数与前端；招聘需求适配器；通知平台可用性与派发；日程开关及面试结果提示；考勤/薪酬开关；简历解析；邮箱适配器。邮箱换账号/目录/起始范围沿用现有scope散列，不覆盖历史游标。不能只做保存页面而业务仍读旧值。

## 导航与总览

总览默认“全部”，保留“待处理”筛选，清楚区分已保存、上次核验、业务开关和实际就绪；未配置不是主动停用。所有平台行到真实维护页。已有业务维护目标继续走原页面及权限，不将业务记录未填写一律报成平台缺配置。

招聘顺序：招聘需求 → 简历收件 → 人才库 → 应聘与面试 → 录用确认。默认入口与首项一致，权限、原业务地址和工作台待办保持。

## 验收

严格档：完整API回归和构建、Web类型/构建；真实隔离数据库证明加密、版本、防并发、重启恢复、权限与秘密不回显；PC/手机验证完整导航、DeepSeek可见、邮箱填写保存核验应用、回读与错误输入保留。第三方外发默认关闭，真实平台权限和真实邮件样本不作为本轮虚构预览已通过的内容。

固定预览 `http://localhost:5173`，真实隔离后端与虚构身份。用户后续明确授权上线后，才核对正式配置与镜像、备份/回退并发布相应服务。
