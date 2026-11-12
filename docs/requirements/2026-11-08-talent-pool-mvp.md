# 人才库（MVP）产品需求 v2

日期：2026-11-08　状态：口径已锁定，可进开发评审　提出：HR
关联模块：人员 › 人员档案（现有「员工档案」同级新增入口）
v2 变更：按 HR 5 项答复改写——仅 HR 可见 + 定向只读转发、资料永久留存、以纸质/扫描件为主、来源词表确认、期望薪资改数值区间。

---

## 0. 一句话结论

在「人员 › 人员档案」下新增**人才库**页面，用**独立的候选人表**管理未入职简历，解决四件事：**存得进、找得到、跟得上、能转员工**。本期不改动员工主数据、不复活招聘流程。

## 1. 背景与边界

现有员工档案只覆盖已入职员工（`users` / `employee_profiles` / `employment_records`），线下收到的简历散落在邮箱、微信和纸质档案里，无法检索、无法判断是否已联系过、同一个人被重复沟通。

八个决策，请开发按此执行，不要自行扩大：

| 编号 | 决策 | 理由 |
| --- | --- | --- |
| D1 | 候选人**不写 `users` 表**，新建 `talent_candidates` 独立表 | 候选人没有账号、部门、工号、绩效关系。塞进 `users` 会污染组织架构、绩效评分名单和工号分配逻辑。 |
| D2 | **不复活招聘模块**（不改 `/recruitment` 占位页） | 本期只做「人」的库，不做职位发布、面试流程、Offer 审批。入口挂在人员模块下。 |
| D3 | **不做简历自动解析**，附件存原件 + 人工填关键字段 | 解析准确率不可控，返工会比手填更慢。单份录入目标 60 秒内。 |
| D4 | **模块仅 HR 可见可搜**（`hr` / `system_admin` / 具备档案权限的 `hr_user`）。部门负责人**没有入口、不能搜索、不能翻列表** | 避免负责人绕过 HR 私下联系候选人、避免库内数据被无序扩散。 |
| D5 | 负责人只读通过**HR 定向单条分享**实现（指定人 + 有效期 + 固定脱敏） | 需求是"能发给部分负责人看"，不是"给负责人开一个库"。分享单条最省权限模型，也能留访问痕迹。 |
| D6 | **资料永久留存**，不设到期自动清理 | HR 明确要求长期储备。合规上靠"仅 HR 可见 + 候选人可要求删除"控制，检索页提供"超 18 个月未联系"筛选项代替到期管理。 |
| D7 | 附件支持**最多 3 个文件 + 手机拍照上传** | 存量以纸质和扫描件为主，必须能用手机拍完就传；一页一张图，3 个文件覆盖绝大多数简历。 |
| D8 | 期望薪资存**数值区间**（min/max，单位 K/月） | HR 明确"以后要按区间筛人"。现在存文本，后面必然要做数据迁移。 |

## 2. 目标用户与主场景

**用户**：HR（招聘/人事专员）、HRD（查看库内人才储备）。**不包含**部门负责人（仅接收分享链接）。

| 场景 | 期望结果 |
| --- | --- |
| 收到一份纸质简历 | 手机拍照 3 张 + 填姓名手机职位，1 分钟内入库 |
| 要找一个"懂供应链的杭州人" | 关键词搜岗位/公司/姓名，能筛状态/标签/薪资，2 秒出结果 |
| 不知道这周该联系谁 | "仅看待跟进"筛出下次跟进日期 ≤ 今天的人 |
| 业务负责人想看某个候选人 | HR 点转发，选人 + 7 天有效期，对方登录后只能看这一条 |
| 某人确定录用 | 一键跳人事办理，姓名手机已预填，不重复录入 |

## 3. 范围

### 3.1 本期做（P0）

1. 候选人新增 / 编辑 / 软删除
2. 简历附件：最多 3 个文件，支持手机拍照上传、单文件可删可换
3. 列表：关键词搜索 + 状态/来源/标签/薪资区间筛选 + 分页
4. 手机号查重（新建时拦截，提示已有记录）
5. 跟进记录时间线（含下次跟进日期）
6. 状态流转（6 个状态，手动切换）
7. 一键「办理入职」跳转人事办理并预填姓名/手机
8. **单条只读转发**：选人、设有效期、固定脱敏、可撤销、留访问记录
9. 权限：仅 HR 可见；负责人无任何列表/搜索权限

### 3.2 本期明确不做

简历解析/OCR/AI 打标签、职位发布与招聘需求、面试安排与评价表、Offer 生成与审批、渠道对接（BOSS/猎聘/内推系统）、短信邮件自动触达、人才地图、重复候选人合并、候选人自助投递、Excel/CSV 批量导入（降为 P1，见 §11）、看板报表、自动清理到期数据。

## 4. 数据模型

四张表：`talent_candidates`（候选人）、`talent_resume_files`（简历文件）、`talent_follow_ups`（跟进）、`talent_shares`（转发授权）。

### 4.1 `talent_candidates`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | uuid | 是 | 主键 |
| name | varchar(50) | 是 | 姓名 |
| phone | varchar(20) | 是 | 手机号，**软删范围内唯一** |
| email | varchar(100) | 否 | 邮箱 |
| gender | varchar(10) | 否 | 男 / 女 / 未知，默认未知 |
| birth_year | int | 否 | 只存年份，不存生日（降敏） |
| current_company | varchar(150) | 否 | 当前公司 |
| current_position | varchar(100) | 否 | 当前职位 |
| years_of_experience | int | 否 | 工作年限（整年） |
| education | varchar(20) | 否 | 高中及以下/大专/本科/硕士/博士/其他 |
| school | varchar(200) | 否 | 毕业院校 |
| major | varchar(150) | 否 | 专业 |
| expect_city | varchar(100) | 否 | 期望城市 |
| expect_salary_min | int | 否 | 期望月薪下限，单位 K；与 max 同时为空=面议 |
| expect_salary_max | int | 否 | 期望月薪上限，单位 K |
| source_channel | varchar(20) | 是 | 见下方固定词表 |
| applied_position | varchar(100) | 否 | 意向岗位（自由文本，不关联岗位表） |
| status | varchar(20) | 是 | 见 §8，默认 `new` |
| tags | varchar(20)[] | 否 | 标签，最多 5 个，固定词表 |
| note | text | 否 | 备注，≤500 字 |
| last_follow_up_at | date | 否 | 由跟进记录回写，供"仅看待跟进"和"长期未联系"排序用 |
| converted_user_id | uuid | 否 | 转入职后的员工 ID，唯一 |
| converted_at | timestamptz | 否 | 转入职时间 |
| created_by_id / updated_by_id | uuid | 是/否 | 操作人，落审计 |
| created_at / updated_at / deleted_at | timestamptz | — | 软删除，列表默认过滤 |

**来源词表**（已确认，前后端共用常量）：内推 / 招聘网站 / 校招 / 猎头 / 社媒 / 线下活动 / 邮箱投递 / 其他。存英文 key，展示中文。

**标签固定词表**（前后端共用常量，本期不做标签维护页）：销售 / 设计 / 供应链 / 职能 / 管理岗 / 应届生 / 同行业 / 可即刻到岗 / 高潜 / 已面未录。

**索引**：`unique(phone) where deleted_at is null`、`(status, updated_at desc)`、`(created_at desc)`、`(expect_salary_min)`、`(converted_user_id)`。首期 `ILIKE` 做关键词匹配，库内超 1 万条再评估 trgm 索引。

### 4.2 `talent_resume_files`

一个候选人最多 3 条，删除候选人时级联。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| candidate_id | uuid | 关联候选人，`onDelete: Cascade` |
| object_key | varchar(500) | MinIO 对象键，`talent-resume/` 前缀 |
| file_name | varchar(255) | 原始文件名（拍照上传时自动生成，如 `扫描件_20261108_1.jpg`） |
| mime_type | varchar(100) | `application/pdf` / `image/jpeg` 等 |
| file_size | int | 字节，≤10MB |
| sort_order | int | 展示顺序，0–2 |
| uploaded_by_id | uuid | 上传人 |
| created_at | timestamptz | — |

### 4.3 `talent_follow_ups`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | uuid | 是 | 主键 |
| candidate_id | uuid | 是 | 关联候选人，级联删除 |
| occurred_at | date | 是 | 沟通日期，默认今天 |
| channel | varchar(20) | 是 | 电话/微信/邮件/面谈/其他 |
| summary | text | 是 | 沟通内容，≤500 字 |
| next_follow_up_at | date | 否 | 下次跟进日期 |
| created_by_id | uuid | 是 | 记录人 |
| created_at | timestamptz | — | — |

列表「下次跟进」列取**该候选人最新一条跟进记录的非空 `next_follow_up_at`**；保存跟进时同步回写 `talent_candidates.last_follow_up_at = occurred_at`。

### 4.4 `talent_shares`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| candidate_id | uuid | 被分享的候选人 |
| token | varchar(64) | 随机串，唯一，URL 用 |
| recipient_ids | uuid[] | 被授权查看的用户，**最多 5 人** |
| include_resume | boolean | 是否附带简历原件，默认 false |
| message | varchar(100) | HR 留言，可选 |
| expires_at | timestamptz | 有效期，默认创建 +7 天 |
| revoked_at | timestamptz | 撤销时间，非空即失效 |
| view_count | int | 打开次数，默认 0 |
| last_viewed_at / last_viewed_by_id | timestamptz / uuid | 最近查看 |
| created_by_id | uuid | 分享人 |
| created_at | timestamptz | — |

## 5. 页面与交互

新增路由 `/talents`，导航位置：人员 › 人员档案 › 人才库，order 15（排在员工档案之后、组织架构之前）。分享页为 `/talents/s/:token`，**不进导航**。

### 5.1 列表页

- 顶部工具条：关键词搜索（姓名/手机/公司/职位，模糊匹配）、状态下拉、来源下拉、标签下拉、期望薪资区间（两个数字框 K）、快捷开关「仅看待跟进」「超 18 个月未联系」、重置；右侧「新增人才」。
- 表格列：姓名｜手机｜意向岗位｜当前公司·职位｜年限｜学历｜期望薪资｜来源｜状态｜下次跟进｜更新时间｜操作（编辑 / 打开）。
- 交互：点击行打开右侧详情抽屉；20 条/页；默认按更新时间倒序。
- 空态：「还没有人才记录。点「新增人才」开始，纸质简历可以直接拍照上传。」
- 状态彩色 pill：新入库灰、沟通中蓝、面试中橙、已入职绿、已淘汰浅灰、储备紫。
- 手机上打开时表格降级为卡片流（姓名 + 状态 + 岗位 + 手机），不做横向滚动。**录入是移动端高频场景，必须能单手完成。**

### 5.2 新增 / 编辑抽屉

三组字段，单列表单，不搞多步骤：

1. **基本信息**：姓名\*、手机\*、邮箱、性别、出生年份、当前公司、当前职位、工作年限
2. **求职意向**：意向岗位、期望城市、期望薪资（min–max K，可勾「面议」置空）、学历、院校、专业、来源\*、标签
3. **简历与备注**：简历文件（≤3 个）、备注

关键交互：

- **手机号查重**：输入框失焦调用查重接口。命中时红字提示「该手机号已在库：张三（沟通中）」，给「打开已有记录」按钮，**阻止提交**。同一手机号不新增第二条。
- **简历上传**：支持 PDF/DOC/DOCX/JPG/PNG，单文件 ≤10MB，最多 3 个。移动端提供「拍照上传」按钮（`input type=file accept=image/* capture=environment`），图片前端压缩到长边 ≤2000px、≤2MB 再上传。
- **文件管理**：每个文件显示缩略图/图标 + 文件名 + 大小，可单独删除、可调整顺序；替换即"删旧加新"，旧对象不主动删。
- 必填项内联校验，不弹窗堆叠。

### 5.3 详情抽屉

- 头部：姓名 + 状态 pill + 来源 + 最近更新；按钮：编辑 / 转发 / 办理入职 / 标记淘汰 / 删除。
- 信息区：只读两列，空值显示"—"。
- 简历区：文件列表（点开预览/下载，走受控下载接口，不给对象存储裸链），底部「+ 添加文件」。
- 跟进记录：倒序时间线（日期、方式、内容、记录人），顶部「记一条」展开行内表单（日期 + 方式 + 内容 + 下次跟进）。
- 转发记录：列出历史分享（授权给谁、有效期、是否已看、查看次数），支持「撤销」。
- 已转员工：显示「员工档案：李四」可点击跳 `/users?keyword=姓名`。
- 删除：二次确认，软删除；简历文件保留在对象存储，列表与详情均不可见。

### 5.4 单条只读转发（新增）

HR 在详情页点「转发」→ 抽屉内：

| 项 | 规则 |
| --- | --- |
| 选择接收人 | 多选，最多 5 人；可选范围 = 在职且为 `dept_head` / `manager` / `hr` / `vp` 的账号；不带部门批量选择 |
| 有效期 | 7 天（默认）/ 30 天 |
| 附简历原件 | 默认关闭。开启时提示"简历原件可能含手机号和邮箱，请确认可外发" |
| 留言 | ≤100 字，可选 |
| 结果 | 生成链接 `/talents/s/<token>`，可一键复制；同时写入站内通知（复用现有 `NotificationLog`），**不自动发钉钉** |

接收人打开链接：

- 必须登录；后端校验 `当前 userId ∈ recipient_ids`，且未过期、未撤销；任一不满足返回 403，页面显示「链接已失效或无权查看」，不暴露候选人姓名。
- 页面只读单条，**没有列表入口、没有搜索、没有编辑、没有导出**。
- 展示字段：姓名、性别、年龄（由 birth_year 计算）、当前公司、当前职位、工作年限、学历、院校、专业、期望城市、意向岗位、标签、状态、HR 留言、简历（仅在 `include_resume=true` 时可下载）。
- **隐藏字段**：手机号、邮箱、期望薪资、来源渠道、备注、跟进记录。原因：负责人直接联系会绕过 HR，联系方式必须由 HR 中转。
- 打开时后端累加 `view_count` 并更新 `last_viewed_at`。

### 5.5 办理入职联动

点「办理入职」→ 校验状态不为已入职 → 跳转 `/personnel-processing?name=xxx&phone=xxx&fromTalent=<id>`，人事办理页读取 query 预填姓名与手机。**不自动创建员工、不写回员工表**；员工生效后由 HR 回到人才库把状态改为「已入职」，该操作要求选择对应员工并写 `converted_user_id`。

## 6. 接口清单

沿用现有 NestJS + Prisma 风格，前缀 `/talents`。除分享查看接口外，全部要求登录 + 人才库权限。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/talents` | 列表；`keyword` `status` `source` `tag` `salaryMin` `salaryMax` `dueOnly` `staleOnly` `page` `pageSize` |
| POST | `/talents` | 新增；手机号重复返回 409 `{ code: 'TALENT_PHONE_EXISTS', existingId }` |
| GET | `/talents/:id` | 详情（含跟进、简历、分享记录） |
| PATCH | `/talents/:id` | 编辑 |
| DELETE | `/talents/:id` | 软删除 |
| GET | `/talents/check-phone?phone=` | 查重 |
| POST | `/talents/:id/files` | 绑定已上传文件（入参 objectKey/fileName/mimeType/fileSize）；超过 3 个返回 409 |
| DELETE | `/talents/:id/files/:fileId` | 移除附件记录（对象存储不删） |
| POST | `/talents/:id/follow-ups` | 新增跟进，同时回写 `last_follow_up_at` |
| GET | `/talents/:id/follow-ups` | 跟进列表 |
| POST | `/talents/:id/shares` | 创建分享；入参 `recipientIds` `expiresInDays` `includeResume` `message`；返回 `{ token, url }` |
| DELETE | `/talents/shares/:shareId` | 撤销分享 |
| GET | `/talents/shares/:token` | **被分享人查看**：校验登录态 + 接收人白名单 + 有效期 + 未撤销，返回脱敏视图 |
| GET | `/talents/shares/:token/file/:fileId` | 被分享人下载简历（仅 `includeResume=true`） |
| PATCH | `/talents/:id/convert` | 标记已入职，入参 `userId` |

附件复用现有存储：`POST /storage/upload?purpose=talent-resume`，在 `storage.controller.ts` 的 purpose 白名单新增该值，并补下载侧校验——`talent-resume/` 前缀必须校验人才库权限或有效 share token，禁止裸 key 下载。

## 7. 权限与安全

| 项 | 规则 |
| --- | --- |
| 完全权限 | `hr`、`system_admin`；`hr_user` 需具备 `employee_archive_edit` 或 `employee_archive_review` |
| 无入口 | 普通员工、`dept_head`、`manager`、`vp` 全部不渲染「人才库」菜单，`GET /talents` 返回 403 |
| 只读例外 | 仅通过 `/talents/s/:token` 访问单条，需在 `recipient_ids` 白名单内 |
| 导航 | 走现有 `canAccessRoute` 机制，加 `hrCapabilities` 约束 |
| 接口 | 服务层二次校验，不能只靠前端隐藏菜单 |
| 附件 | 受控下载，前端不持有对象键直链 |
| 字段最小化 | **不采集**身份证号、银行账号、家庭成员、住址；只存简历原件与求职必需字段 |
| 留存 | 永久留存，不做到期清理。检索页提供「超 18 个月未联系」筛选，用于人工复核该不该继续留 |
| 删除请求 | 候选人要求删除时，HR 软删除记录并由系统管理员清理对象存储文件（运维动作，不开发功能） |
| 导出 | 本期不做列表导出（避免资料外流） |

**合规提醒（需 HR 确认对外告知口径）**：永久留存需要在候选人授权/隐私告知中写明"简历将存入公司人才库长期保留，可随时联系 HR 要求删除"。建议在收简历的渠道（招聘平台自动回复、内推邮件、前台登记表）加上这句话，否则长期留存缺少合法性基础。

## 8. 状态流转

```
new(新入库) ──► contacted(沟通中) ──► interviewing(面试中) ──► hired(已入职，终态，必填 converted_user_id)
   │               │                      │
   └───────────────┴──────────────────────┴──► rejected(已淘汰，终态)
   │               │                      │
   └───────────────┴──────────────────────┴──► reserve(人才储备) ──► contacted
```

- 全部手动切换，不做自动流转、不做审批。
- 进入「已入职」必须选择对应员工记录，否则不允许保存。
- 「已淘汰」不强制填原因，表单提示建议在备注中写明。

## 9. 验收标准

| # | 场景 | 通过标准 |
| --- | --- | --- |
| 1 | 手机录入一条（拍照 2 张） | 1 分钟内完成；两张图压缩后均 ≤2MB；列表与详情可见 |
| 2 | 上传第 4 个简历文件 | 前端提示最多 3 个，接口返回 409，不产生第 4 条记录 |
| 3 | 用已存在的手机号新增 | 提交被拒，提示已有记录姓名与状态，可一键打开原记录；库内不新增行 |
| 4 | 上传 10MB 以上或 exe | 前端拦截并提示；对象存储无新文件 |
| 5 | 关键词搜"供应链" | 命中意向岗位、当前职位、当前公司中含该词的记录 |
| 6 | 薪资筛 15–25K | 返回 `expect_salary_min/max` 与区间有交集的记录；面议记录不被误纳 |
| 7 | 筛选「仅看待跟进」 | 只返回最新跟进 `next_follow_up_at ≤ 今天` 的记录 |
| 8 | 记一条跟进 | 时间线新增；列表「下次跟进」与 `last_follow_up_at` 同步更新 |
| 9 | 转发给 2 位负责人，其中 1 人打开 | 两人登录后均可看单条；第三人（非白名单）打开同一链接返回 403 且不显示候选人姓名；`view_count` 只增 2 |
| 10 | 分享页字段校验 | 页面不出现手机号、邮箱、期望薪资、来源、备注、跟进记录；默认无简历下载入口 |
| 11 | 撤销分享 / 过期 7 天 | 撤销后立即 403；把 `expires_at` 改为过去时间后 403 |
| 12 | 部门负责人访问 `/talents` | 导航无入口；直接访问 URL 被路由拦截；`GET /talents` 返回 403 |
| 13 | 点「办理入职」 | 跳转人事办理页，姓名手机已预填；人才库记录状态未被自动修改 |
| 14 | 标记「已入职」未选员工 | 保存失败并提示需选择对应员工 |
| 15 | 删除候选人 | 二次确认后列表消失；同手机号可重新入库；分享链接随之失效 |
| 16 | 现有员工档案回归 | 员工列表、组织架构、人事办理、绩效流程无变化（不新增 `users` 记录） |

## 10. 工作量与排期建议

| 项 | 人日 |
| --- | --- |
| 后端：4 张表 + 迁移 + CRUD + 查重 + 跟进 + 多附件 + 分享授权 + 单测 | 5–6 |
| 前端：列表 + 详情抽屉 + 表单（含拍照/压缩）+ 分享抽屉 + 只读分享页 + 路由/导航/权限 | 5–6 |
| 联调 + 验收（按 §9 逐条走） | 1–2 |
| 合计 | **约 11–14 人日**，建议 3 周内交付 |

比 v1 增量的原因：加了转发授权（+1.5 人日）、多文件与移动端拍照压缩（+1 人日）、去掉 CSV 导入（−1.5 人日）。
回归面小：不动 `users` / 组织 / 绩效表，人事办理页只多读一段 query（无 query 时行为不变）。

## 11. P1（第二迭代，本期不做）

1. **CSV / Excel 批量导入**：固定 8 列模板（姓名/手机/邮箱/意向岗位/当前公司/当前职位/来源/标签），预览 → 确认，仅新增不覆盖。纸质为主的情况下优先级低于拍照录入，但存量名单仍需要它。
2. 简历 OCR 辅助填表（先只做姓名/手机/公司/职位四项，人工确认后落库）。
3. 分享链接支持"按岗位批量转发"与钉钉工作通知自动推送。
4. 人才库看板：库内总量、各状态分布、来源转化、储备覆盖率。
5. 沉睡人才定期复核任务、重复候选人合并。

## 12. 口径确认记录

| 项 | HR 确认结论 |
| --- | --- |
| 可见范围 | 只给 HR 看；可定向转发给部分负责人，只读；负责人不能主动搜索或翻列表 |
| 留存期限 | 永久留存（合规告知口径见 §7，需在收简历渠道补一句授权说明） |
| 存量形态 | 纸质、电子扫描件居多 → P0 做拍照/多文件上传，批量导入降到 P1 |
| 来源词表 | 内推/招聘网站/校招/猎头/社媒/线下活动/邮箱投递/其他，确认可用 |
| 期望薪资 | 改数值区间（K/月），列表本期即支持区间筛选 |

**开发前唯一待补**：存量纸质简历的录入节奏（建议先录近 2 年仍在联系的，其余按批次补录，不要一次性全量录入，否则首周就积压）。

---

## 附录 A：Prisma 模型草案

```prisma
model TalentCandidate {
  id               String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name             String    @db.VarChar(50)
  phone            String    @db.VarChar(20)
  email            String?   @db.VarChar(100)
  gender           String    @default("unknown") @db.VarChar(10)
  birthYear        Int?      @map("birth_year")
  currentCompany   String?   @map("current_company") @db.VarChar(150)
  currentPosition  String?   @map("current_position") @db.VarChar(100)
  yearsOfExperience Int?     @map("years_of_experience")
  education        String?   @db.VarChar(20)
  school           String?   @db.VarChar(200)
  major            String?   @db.VarChar(150)
  expectCity       String?   @map("expect_city") @db.VarChar(100)
  expectSalaryMin  Int?      @map("expect_salary_min")
  expectSalaryMax  Int?      @map("expect_salary_max")
  sourceChannel    String    @map("source_channel") @db.VarChar(20)
  appliedPosition  String?   @map("applied_position") @db.VarChar(100)
  status           String    @default("new") @db.VarChar(20)
  tags             String[]  @default([]) @db.VarChar(20)
  note             String?   @db.Text
  lastFollowUpAt   DateTime? @map("last_follow_up_at") @db.Date
  convertedUserId  String?   @unique @map("converted_user_id") @db.Uuid
  convertedAt      DateTime? @map("converted_at") @db.Timestamptz(6)
  createdById      String    @map("created_by_id") @db.Uuid
  updatedById      String?   @map("updated_by_id") @db.Uuid
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
  deletedAt        DateTime? @map("deleted_at") @db.Timestamptz(6)

  files     TalentResumeFile[]
  followUps TalentFollowUp[]
  shares    TalentShare[]

  @@index([status, updatedAt(sort: Desc)])
  @@index([createdAt(sort: Desc)])
  @@index([expectSalaryMin])
  @@index([deletedAt])
  @@map("talent_candidates")
}

model TalentResumeFile {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  candidateId  String   @map("candidate_id") @db.Uuid
  objectKey    String   @map("object_key") @db.VarChar(500)
  fileName     String   @map("file_name") @db.VarChar(255)
  mimeType     String   @map("mime_type") @db.VarChar(100)
  fileSize     Int      @map("file_size")
  sortOrder    Int      @default(0) @map("sort_order")
  uploadedById String   @map("uploaded_by_id") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  candidate TalentCandidate @relation(fields: [candidateId], references: [id], onDelete: Cascade)

  @@index([candidateId, sortOrder])
  @@map("talent_resume_files")
}

model TalentFollowUp {
  id             String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  candidateId    String    @map("candidate_id") @db.Uuid
  occurredAt     DateTime  @map("occurred_at") @db.Date
  channel        String    @db.VarChar(20)
  summary        String    @db.Text
  nextFollowUpAt DateTime? @map("next_follow_up_at") @db.Date
  createdById    String    @map("created_by_id") @db.Uuid
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  candidate TalentCandidate @relation(fields: [candidateId], references: [id], onDelete: Cascade)

  @@index([candidateId, occurredAt(sort: Desc)])
  @@map("talent_follow_ups")
}

model TalentShare {
  id             String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  candidateId    String    @map("candidate_id") @db.Uuid
  token          String    @unique @db.VarChar(64)
  recipientIds   String[]  @map("recipient_ids") @db.Uuid
  includeResume  Boolean   @default(false) @map("include_resume")
  message        String?   @db.VarChar(100)
  expiresAt      DateTime  @map("expires_at") @db.Timestamptz(6)
  revokedAt      DateTime? @map("revoked_at") @db.Timestamptz(6)
  viewCount      Int       @default(0) @map("view_count")
  lastViewedAt   DateTime? @map("last_viewed_at") @db.Timestamptz(6)
  lastViewedById String?   @map("last_viewed_by_id") @db.Uuid
  createdById    String    @map("created_by_id") @db.Uuid
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  candidate TalentCandidate @relation(fields: [candidateId], references: [id], onDelete: Cascade)

  @@index([candidateId, createdAt(sort: Desc)])
  @@map("talent_shares")
}
```

迁移中需手写补充：

```sql
CREATE UNIQUE INDEX uq_talent_phone_active ON talent_candidates(phone) WHERE deleted_at IS NULL;
ALTER TABLE talent_candidates ADD CONSTRAINT chk_talent_status
  CHECK (status IN ('new','contacted','interviewing','hired','rejected','reserve'));
ALTER TABLE talent_candidates ADD CONSTRAINT chk_talent_tags CHECK (cardinality(tags) <= 5);
ALTER TABLE talent_candidates ADD CONSTRAINT chk_talent_salary
  CHECK (expect_salary_min IS NULL OR expect_salary_max IS NULL OR expect_salary_min <= expect_salary_max);
ALTER TABLE talent_shares ADD CONSTRAINT chk_share_recipients CHECK (cardinality(recipient_ids) BETWEEN 1 AND 5);
```
