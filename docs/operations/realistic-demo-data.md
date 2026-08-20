# 真实演示数据运行手册

本手册用于尚未上线的本机 Docker `hrm` 环境。数据生成器会创建一套固定、可重复加载的演示数据；它只清理和重建生成器清单中拥有的确定性 ID，不按名称、日期或前缀进行宽泛删除。

## 数据规模与验收账号

验证成功时，关键业务数量应为：128 名在职人员、4 名离职历史人员、384 个考核任务、7 条申诉、23 个改进计划、11 条试用期评审和 48 条通知。另有 1 个不计入人员数量的系统管理员账号。

八个验收工号如下，均使用运行时安全提供的共享验收密码：

| 角色 | 工号 |
| --- | --- |
| 系统管理员 | `FD900001` |
| HR | `FD100001` |
| 分管领导 | `FD100002` |
| 部门负责人 | `FD210001` |
| 经理 | `FD210002` |
| 员工 | `FD210101` |
| 低绩效员工 | `FD210102` |
| 试用期员工 | `FD210103` |

密码不得写入仓库、命令历史、日志或截图。操作前应由操作者在当前 PowerShell 会话中安全设置 `REALISTIC_DEMO_ACCOUNT_PASSWORD`；本文不提供默认值。

## 预览、写入与验证

先确认当前连接目标确实是 Docker `hrm` 的 API 与 PostgreSQL，并完成备份或确认该未上线环境可以重建。禁止把命令指向 `kayford-deploy`、测试容器或其他数据库。

在 PowerShell 中按以下顺序执行：

```powershell
Set-Location C:\Users\lwei\Documents\Claude\KeyFord\HRM\api
npm run db:seed:realistic:preview
if (-not $env:REALISTIC_DEMO_ACCOUNT_PASSWORD) { throw 'REALISTIC_DEMO_ACCOUNT_PASSWORD must be supplied securely before write' }
$env:ENABLE_REALISTIC_DEMO_SEED = 'true'
npm run db:seed:realistic
npm run db:seed:realistic:verify
Remove-Item Env:ENABLE_REALISTIC_DEMO_SEED
```

- `db:seed:realistic:preview` 是只读预检，不需要密码，不生成密码哈希，也不写数据库。若报告 foreign collision，必须停止并调查，不得直接清理覆盖。
- `db:seed:realistic` 是写入命令。它同时要求 `ENABLE_REALISTIC_DEMO_SEED=true` 和非空的 `REALISTIC_DEMO_ACCOUNT_PASSWORD`。写入门只在命令执行期间设置，命令结束后立即移除。
- `db:seed:realistic:verify` 是只读核验。它检查清单数量、确定性 ID、归属证据和关键关联；返回非零退出码即视为失败。
- 再执行一次相同的写入和核验，应得到完全相同的 ID 与数量，用于证明实际目标上的幂等性。

如果写入命令异常退出，也应执行：

```powershell
Remove-Item Env:ENABLE_REALISTIC_DEMO_SEED -ErrorAction SilentlyContinue
```

## 清理与回滚

清理默认只有预览，不会删除数据：

```powershell
Set-Location C:\Users\lwei\Documents\Claude\KeyFord\HRM\api
npm run db:seed:realistic:clean
```

只有明确确认要删除全部生成器自有数据后，才临时打开清理门：

```powershell
$env:ENABLE_REALISTIC_DEMO_CLEAN = 'true'
npm run db:seed:realistic:clean
Remove-Item Env:ENABLE_REALISTIC_DEMO_CLEAN
```

清理只删除清单拥有的行，并在遇到归属证据不匹配时拒绝继续。清理不是数据库备份的替代品：若要回到加载前的完整状态，应使用操作前的 PostgreSQL 备份恢复。写入本身在单个事务中执行；事务失败会回滚本次变更。

## 轮换共享验收密码

在当前 PowerShell 会话中安全更新 `REALISTIC_DEMO_ACCOUNT_PASSWORD`，然后按“预览、写入与验证”章节重新执行写入与验证。生成器会重新计算八个验收账号的 bcrypt 哈希，其他确定性数据保持不变。轮换完成后从当前会话移除密码环境变量：

```powershell
Remove-Item Env:REALISTIC_DEMO_ACCOUNT_PASSWORD -ErrorAction SilentlyContinue
```
