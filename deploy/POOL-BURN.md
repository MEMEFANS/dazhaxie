# 后台底池燃烧

管理员登录后打开 `/admin/pool-burn`，或从侧栏选择“底池燃烧”。此模块只调用当前网站代币的 `burnPool()`，不会转出 USDT 或 LP 凭证，不需要代币 owner 权限。

## 使用

1. 新建专用 BSC 执行钱包，在后台填写其 `0x` 私钥。不要使用管理员、收款或领取签名钱包。GAS 单价上限默认 1 Gwei，最大 5 Gwei。
2. 点击“保存配置并暂停”。钱包地址自动推导，私钥保存后不回显。
3. 向页面显示的执行钱包转入少量 BNB，例如 0.003 BNB。最低启用余额为 0.0001 BNB；实际交易前还会核对本次预估网络费。
4. 确认“定时服务在线”，点击“启用自动执行”。如果已到期，下一次检查就可能发送不可撤销的燃烧交易。
5. 页面显示 BNB 余额、北京时间、预估和累计燃烧量、最近 20 笔自动执行记录。配置、启停及执行结果也记入后台审计。

服务器每分钟检查一次。合约每满 8 小时允许燃烧执行时底池 CaBi 余额的 1%，下一次从实际执行时间重新计时。筹备期尚未开启计时、流动性不足、储备未同步时不会执行；错过的时段不补烧。低余额或 GAS 单价过高会等待条件恢复。链上交易回滚或回执异常会自动暂停，核对后需要再次启用。

“暂停任务”只停止创建新交易。已签名或已广播的交易仍会继续核对，可能完成燃烧；它们不能靠暂停撤回。存在待确认交易时不能更换钱包配置。同一个执行钱包不要同时用于其他任务。

## 服务安装与升级

自动执行器依赖完整源码的 `viem` 与 Node 24，不能只部署 Next standalone。`/opt/cabi-worker` 指向已发布提交的完整源码目录。每次发布保留该工作树及 node_modules，切换后再恢复 timer；不要删掉当前 worker 指向的版本。

```sh
# 网站新版本已切换，且该版本已保留完整 node_modules：
systemctl stop cabi-pool-burn.timer cabi-pool-burn.service
ln -sfn /opt/cabi-builds/site-COMMIT_PREFIX /opt/cabi-worker
install -m 0644 deploy/cabi-pool-burn.service /etc/systemd/system/
install -m 0644 deploy/cabi-pool-burn.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now cabi-pool-burn.timer
systemctl start cabi-pool-burn.service
```

运行身份为 `cabi`。服务读取 `/etc/cabi.env` 的服务器密钥及 `/opt/cabi/.env.production` 的公开链配置，数据目录与网站共用 `/var/lib/cabi`。如指定 `POOL_BURN_RPC_URL`，应使用可信 BSC RPC。不要同时运行旧的 `pool-burn-keeper.cjs --execute` 定时任务。初次部署没有执行钱包，自动执行默认关闭。

故障检查：

```sh
systemctl status cabi-pool-burn.timer cabi-pool-burn.service
journalctl -u cabi-pool-burn.service -n 30 --no-pager
```

## 存储与恢复

钱包用 AES-256-GCM 加密，独立密钥域与 AAD 绑定链、代币、USDT 和钱包。根密钥为 `REDEMPTION_DATA_SECRET`，缺失时使用 `ADMIN_SESSION_SECRET`。密文、任务状态和交易记录保存在 `operations.sqlite`，随现有 SQLite 备份保存；恢复时必须保留原加密根密钥。修改该密钥后旧钱包和待处理交易无法解密。

广播前先将已签名交易及其哈希持久化（交易字节也加密）。网络超时或进程重启后只核对、重发相同字节，不创建不同 nonce 的替代交易。两区块确认并校验交易目标、发送人、calldata 和 `PoolBurned` 事件后才记录成功。SQLite 租约和唯一待处理记录防止并发重复创建交易。

如果状态提示“执行钱包发生其他交易”，不要删除 pending 记录强行重发。维护人员需先在浏览器核对原 hash 和同 nonce 的实际交易，再处理记录。网站更换代币后旧配置自动失效，必须重新保存并启用。
