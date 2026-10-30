# 人员基础资料隔离接口验证

此套件使用真实 Nest HTTP、JWT 会话、权限守卫、DTO、Prisma 和 PostgreSQL，只创建合成账号、目录和档案。测试配置不包含 globalSetup、全局 seed、建库或自动连接脚本，不会加载默认 E2E 初始化。

执行前必须显式准备一次性 PostgreSQL，地址只允许 `127.0.0.1` / `localhost` / `[::1]`，数据库名严格为 `hrm_basic_data_test`；Redis 也必须显式指向回环地址上的独立测试服务。先在该测试库执行全部迁移并生成 Prisma Client，再在 `api/` 执行：

```powershell
# DATABASE_URL / REDIS_URL 必须由拥有一次性容器的启动者显式设置，不复制业务 .env。
npx jest --config test/personnel-reference-data/jest.config.json --runInBand
```

套件在连接数据库前拒绝不符合条件的连接地址；启动时生成临时 JWT/档案密钥，关闭快捷登录、钉钉通知和 Stream。无密码、密钥、令牌或个人资料写入日志。完成后由启动者销毁自己创建的服务。

覆盖空目录、两种目录隔离、严格名称及布尔校验、UUID、同类唯一/跨类同名、并发创建冲突、并发PATCH的审计连续性、改名与启停、读写角色、组织编辑用户只读职系、员工伪带能力拒绝、真实审计及失败回滚、旧名称快照和原档案/岗位审核兼容。此为开发验证，不代表生产上线或真实 HR 业务验收。
