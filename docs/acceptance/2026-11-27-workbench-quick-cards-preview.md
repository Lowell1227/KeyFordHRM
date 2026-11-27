# 常用入口卡片恢复预览

## 范围与状态

- 用户要求恢复原卡片样式，继续放在工作台顶部。基线`3a16cbda`，产品版本保持0.9.3；本轮仅Web局部展示，走快速档，不改API、业务数据、授权、查询或刷新机制。
- 复用原有常用入口和路由资格，恢复卡片标题、简短业务说明及“进入”图标提示；电脑四列、窄屏两列、手机一列。整张卡片仍可点击，独立可访问名称保持原业务名称。
- 恢复原白色面板、边框和间距。页面实测发现原`--app-border-color`未定义，为本区域加现有Element Plus边框色兜底，不扩大全局样式改造。
- 命名决定：用户明确仍叫“删除”，语义为逻辑删除，不改称“移入历史”；恢复入口另议。本轮不新增周期删除或恢复，也未改造既有草稿周期实体删除接口，不能把命名确认写成全系统删除已统一。

## 验证

- 新增卡片结构回归先失败后修复；`node --test tests/navigation-workbench-entrypoints.test.cjs tests/dashboard-section.test.cjs`共18项通过，覆盖顶部顺序、描述、进入提示、原路由和不同角色入口、折叠偏好及刷新稳定性。
- `docker exec hrm-web-1 env NODE_OPTIONS=--max-old-space-size=1536 npm run type-check`完整Web类型检查通过。
- 使用原固定预览、真实隔离后端和虚构HR/窄人员经办，Playwright电脑/手机4组通过。核对卡片数量、描述、纵向布局、文字不越界、外框实际样式、顶部顺序、原页面跳转、菜单和原绩效待办；无业务写入。
- 首轮4项失败保留：HR两项实测发现缺失边框；经办两项是测试在路由切换后未等待卡片挂载。分别修正本区域边框兜底及等待可见，未删除断言或放宽业务权限检查。
- 最终命令：`node node_modules/@playwright/test/cli.js test --config playwright.preview.config.ts e2e/preview/navigation-workbench-entrypoints.spec.ts --grep 'HR001: peer navigation|fictional personnel operator starts' --output ../test-results/quick-cards-restored-final-20261127 --workers 1`。经办仅复用受控虚构夹具认证，路径用环境变量传入，凭据不记录。
- 最终截图在`test-results/quick-cards-restored-final-20261127`；已人工查看电脑和手机的窄经办截图，无横向溢出或文字重叠。浏览器手机尺寸不等于真机验收。

## 交付

固定入口`http://localhost:5173/dashboard`，选择`HR001`进入预览，即可看到顶部恢复的常用入口卡片。仅前端热更新，不重启后端、Docker或生产；本轮按已有授权只回收WSL干净文件缓存，未删除文件或调整长期配置。

已实现、预览验证通过；本轮尚未提交、未上线、待用户验收。生产API/Web仍为上一批`e75ceeae`，不能将本轮卡片预览冒称已上线。API、全功能压测、真实员工办理和删除/恢复机制不在本轮新增验证范围。

## 追加发布授权

用户随后明确“开发上线”。按本轮已说明的卡片恢复范围，只发布Web、沿用0.9.3，复用未变源码的预览证据，单独验证固定提交的正式构建、资源和真实角色入口；不修改API、数据库、授权或删除/恢复规则。实际发布结果后续补记，当前授权不等于已经上线。
