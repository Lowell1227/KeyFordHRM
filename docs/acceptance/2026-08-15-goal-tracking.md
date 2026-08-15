# 目标跟进参考图改造验收记录

## 自动化结果

- API objectives tests: PASS（3 suites / 10 tests）
- Frontend contract tests: PASS（74/74）
- Frontend type-check: PASS
- Frontend production build: PASS
- Affected Playwright suites: PASS（120/120，0 flaky）
- 历史 `objectiveId` 深链定位与安全回退：由上述最终 Playwright 套件覆盖；本轮真实浏览器截图流程未另行手工重复。

## 真实角色检查

- 普通员工（张晨，1440×900）：本人/直属上级、不同周期、搜索、两组折叠与展开、自定义列隐藏与恢复、刷新持久化、浏览器前进与后退均通过；页面无“创建群聊”。
- 主管（周强，1440×900）：本人、不同周期及目标地图本地入口均通过；该真实账号没有 `directManagerId`，页面按既定规则不显示“直接上级”组，因此本轮无法观察主管的直属上级切换，不将该未观察项记为通过。
- 员工窄屏（张晨，390×844）：无文档级横向溢出；搜索、人员、周期及自定义列控件均可用。
- 权限：员工无目标地图入口；员工选择直属上级仅切换到既有可见人员，未扩大目标数据范围。
- 浏览器控制台：员工桌面、主管桌面与员工窄屏均为 0 error。
- 视觉对比：重新以原始分辨率查看参考图；三列结构、人员分组与蓝色选中态、灰蓝内容背景、白色圆角指标卡、表头密度及留白与参考结构一致，同时保留现有 HRM 全局导航壳层。

## 截图

- [员工桌面](./2026-08-15-goal-tracking/employee-desktop.png)
- [主管桌面](./2026-08-15-goal-tracking/manager-desktop.png)
- [员工窄屏](./2026-08-15-goal-tracking/employee-mobile.png)
