# 重新发行前清理业务数据

仅在用户明确授权清空数据时运行。停止网站服务、底池燃烧 timer 及 worker 后，用 `scripts/reset-business-data.cjs` 创建新数据库并把原数据目录完整移至指定备份目录。禁止覆盖旧备份；待确认燃烧交易必须先核对。

保留后台管理员会话、收款配置及服务器环境密钥。清空认购、奖励授权/批次、邀请、钱包登录、收货发货、兑换、社群成员/消息、售后、旧审计和燃烧执行配置/记录；新增一条重置审计。认购、兑换及原代币的网站 LP 入口关闭。暂停燃烧 timer，重新发行后需重新配置。

重置时读取 BSC 最新区块并将下一块记入 operations.sqlite 的 payment_epochs，认购和兑换核验拒绝此前的付款，防止清零后旧哈希再次获得额度。这个边界在新币切换后必须保留。旧链上资产、已签名授权和交易无法通过清数据库撤销。

```sh
# 先只检查表和行数；不输出订单、私钥或收货资料
CABI_DATA_DIR=/var/lib/cabi node scripts/reset-business-data.cjs --inspect
# 应用参数依次为全新备份目录、链 ID、首个允许付款的区块、旧代币、旧领取池
CABI_DATA_DIR=/var/lib/cabi node scripts/reset-business-data.cjs --apply BACKUP_DIR 56 MIN_BLOCK OLD_TOKEN OLD_POOL
```

备份根目录还应另存 `/etc/cabi.env`、当前 `.env.production` 与 RELEASE_COMMIT，权限 0600/0700。重发准备期间清空旧代币、领取池、网关及奖励池的公开地址并重新构建网站；保留 USDT、收款地址和管理员。新币六步签名完成后才配置新地址，网站业务开关仍由管理员决定何时打开。

回滚必须停止服务：将重置后的目录另行归档，将 `data-before-reset` 原目录恢复到原路径；恢复同一时期的运行包与环境配置，修正属主后启动。不要把旧订单导入新一期或清除付款起始区块。

隔离验证：`node scripts/verify-business-reset.cjs`，覆盖清理范围、管理员和配置保留、备份不覆盖、pending 拦截、完整恢复。
