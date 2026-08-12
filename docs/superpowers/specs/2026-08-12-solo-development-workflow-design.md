# 个人开发极简环境设计

## 目标

项目尚未上线且由一人开发，优先减少分支和运行环境切换，让每次修改都能快速在浏览器和局域网设备中看到效果。

## 最终结构

- 唯一长期开发分支：`main`。
- 唯一运行环境：本机 Docker Desktop 中的 `hrm` Compose 项目。
- `hrm` 保留五个服务：Web、API、PostgreSQL、Redis、MinIO。
- 本机访问：`http://localhost:5173`。
- 同一局域网访问：`http://192.168.31.65:5173`；IP 由当前 WLAN 分配，变化后重新查询。
- Web 通过开发代理访问 API；API 继续监听 `0.0.0.0:3000`。

## 收敛动作

1. 在确认 `codex/realistic-demo-data` 没有相对 `main` 的独有提交和未提交业务文件后，移除该工作树并删除该本地分支。
2. 停止 `kayford-deploy` Compose 项目的五个容器，但不删除镜像、卷或数据库数据。
3. 保留 `hrm` Compose 项目及其数据卷，不重建、不清空数据库。
4. 保留宿主机原有 `tmp/` 临时文件，不将其纳入 Git。
5. 不处理 Codex/宿主环境创建的 detached 临时工作树，避免越权清理外部管理资源。

## 日常开发方式

1. 所有修改直接提交到 `main`。
2. Docker 中的 Web 开发服务器继续使用源码挂载和热更新，页面修改后直接刷新浏览器验收。
3. API 或依赖发生变化时，只重启对应服务；不再维护第二套生产模式容器。
4. 每个业务改动至少运行相关 API 测试、Web 合同测试或真实浏览器流程；以页面刷新后的行为为准。

## 数据与回退

- 停止 `kayford-deploy` 使用 `docker compose stop`，不使用 `down -v`，因此卷和数据保持可恢复。
- 如以后需要部署形态验证，可基于现有 Compose 文件重新启动 `kayford-deploy`，无需长期保持运行。
- 真实模拟数据只写入保留的 `hrm` 数据库，并继续使用已确认的精确范围清理和幂等保护。

## 完成标准

- `git branch` 只保留 `main` 作为日常本地开发分支。
- Docker 中仅 `hrm` Compose 项目处于运行状态。
- `http://localhost:5173` 和当前局域网 IP 地址均返回 Web `200`。
- `http://localhost:3000/api/v1/health` 返回 API 和数据库 `ok`。
- `main` 工作区除原有 `tmp/` 外无意外修改。
