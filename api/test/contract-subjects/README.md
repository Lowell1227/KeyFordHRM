# 合同主体真实接口与数据库验证

本目录使用真实 Nest HTTP 守卫、DTO、档案审核服务及 Prisma/PostgreSQL，数据均为合成记录。它不包含在默认全量单元测试中。

仅接受回环地址、数据库名严格为 `hrm_contract_subject_test` 的一次性测试库；不使用生产数据、不运行 seed、不修改正式人员。运行前先在该空测试库执行 `prisma migrate deploy`，并确保 Prisma Client 已生成。

在 `api/` 下配置指向该测试库的 `DATABASE_URL` 和独立测试 Redis 的 `REDIS_URL`，运行：

```powershell
$env:NODE_ENV = 'test'
$env:DINGTALK_BOT_STREAM_ENABLED = 'false'
$env:DINGTALK_BOT_PREFLIGHT_CONFIRMED = 'false'
$env:DINGTALK_NOTIFICATION_ENABLED = 'false'
npx jest --config test/contract-subjects/jest.config.json --runInBand
```

测试会使用合成账号和临时令牌，并在进程内生成随机测试密钥，不需要真实密码或钉钉身份。覆盖目录读写权限、名称校验、严格布尔值、名称快照、旧 JSON 缺字段、停用引用、仅关联变化、显式清空、未来任职和再入职。

完成后由启动者销毁自己创建的一次性测试服务。测试通过是开发验证，不替代真实 HR 操作验收或生产发布。
