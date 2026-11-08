# 部署与运维（生产）

正式档目标：**4 vCPU / 8 GB / 80 GB NVMe / 30 Mbps 起 + CDN**，Ubuntu 24.04 LTS、Node.js 24 LTS、单实例。最小内测可用 2 vCPU / 4 GB（低于 4 GB 不建议在服务器上构建）。

## 1. standalone 构建产物

`next.config.ts` 已开启 `output: "standalone"`。`next build` 后：

```sh
npm ci
CABI_DEPLOYMENT_ID=当前提交哈希 npm run build
node deploy/precompress-static.mjs

# 必须手动补两个目录，否则页面与图片 404
cp -a .next/static .next/standalone/.next/
cp -a public .next/standalone/

# 本地验证 standalone（不要用 next start 验证这一份）
PORT=3000 HOSTNAME=127.0.0.1 node .next/standalone/server.js
```

`next start` 在 standalone 模式下会输出不支持警告，生产统一用 `node server.js`。

准确路径：

- 入口：`.next/standalone/server.js`
- 客户端资源：`.next/standalone/.next/static`
- 静态文件：`.next/standalone/public`
- 图片优化缓存（运行时生成）：`.next/standalone/.next/cache/images`

发布到 `/opt/cabi` 时保留图片缓存，避免发布后重新转码：

```sh
sudo install -d -o cabi -g cabi /opt/cabi /var/lib/cabi
sudo rsync -a --delete --exclude=.next/cache .next/standalone/ /opt/cabi/
sudo rsync -a .next/static/ /opt/cabi/.next/static/
sudo rsync -a public/ /opt/cabi/public/
sudo rsync -a deploy/ /opt/cabi/deploy/
sudo install -d -o cabi -g cabi /opt/cabi/.next/cache
sudo chown -R cabi:cabi /opt/cabi
```

systemd 使用 `/opt/cabi/server.js`，只监听 `127.0.0.1:3000`，公网由 Caddy/Nginx 反代。

## 2. Docker（可选）

```sh
docker build \
  --build-arg NEXT_PUBLIC_CHAIN_ID=56 \
  --build-arg NEXT_PUBLIC_TRADING_MODE=pancake \
  --build-arg NEXT_PUBLIC_TOKEN_ADDRESS=0x... \
  --build-arg NEXT_PUBLIC_USDT_ADDRESS=0x... \
  --build-arg NEXT_PUBLIC_CLAIM_POOL_ADDRESS=0x... \
  -t cabi-dapp:latest .

docker run -d --name cabi --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v cabi-data:/data \
  --env-file /etc/cabi.env \
  cabi-dapp:latest
```

- `NEXT_PUBLIC_*` 是**构建期**变量；换地址必须重新 `docker build`，不能只改 `--env-file`。
- `/etc/cabi.env` 只放运行时密钥：`ADMIN_USERNAME`、`ADMIN_PASSWORD_HASH`、`ADMIN_SESSION_SECRET`、`REDEMPTION_DATA_SECRET`、`APP_ORIGIN`、`CABI_DATA_DIR=/data`、`REDEMPTION_CONFIG_CACHE_MS`。
- `.dockerignore` 已排除 `.env*`、`.next`、`node_modules`、`deploy`、本地数据目录，密钥不会进入镜像。

## 3. systemd

```sh
sudo useradd --system --home /var/lib/cabi --shell /usr/sbin/nologin cabi
sudo install -d -o cabi -g cabi -m 0700 /var/lib/cabi
sudo install -m 0600 /dev/null /etc/cabi.env
# 编辑 /etc/cabi.env 填入运行时密钥，然后：
sudo cp deploy/cabi.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cabi
```

底池自动燃烧使用后台 `/admin/pool-burn` 配置专用钱包和启停，初次部署默认关闭。执行服务依赖 `viem`，**不能从 standalone 运行包启动**；使用完整源码目录及 `cabi-pool-burn.timer`。安装、升级和操作见 [POOL-BURN.md](POOL-BURN.md)。不要同时运行旧 CLI keeper。

## 4. 数据目录（CABI_DATA_DIR）

- 固定为 `/var/lib/cabi`，**放在项目目录之外**，发布时不会被覆盖；权限 `0700`，属主是服务用户。
- 不要放在 NFS/SMB/网络盘：SQLite WAL 需要可靠的本地文件锁与 fsync。
- **只能单实例**：三个 SQLite 文件是本地单写者；两台应用共享同一数据目录会锁冲突。需要多实例时先迁移到 Postgres。
- Docker 中固定 `/data`，必须挂载持久卷（不能只存在容器层）。

## 5. 缓存与 CDN

Next.js 自身输出（实测以 `curl -I` 为准）：

- `/_next/static/*`：`public, max-age=31536000, immutable`（内容哈希，不能也不需要覆盖）。
- 首页和公开业务页（`/subscribe`、`/token`、`/promotion`、`/team`、`/community`、`/exchange`、`/support`、`/liquidity/*`）：`private, no-store`，避免更新合约后继续读取旧配置。
- `/images/*`：`public, max-age=2678400, stale-while-revalidate=86400`（本仓库 `next.config.ts` 设置）。
- `/_next/image*`：按 `images.minimumCacheTTL`（31 天）缓存优化结果。
- `/admin`、`/admin/*`、`/api/*`：`no-store`（本仓库 `next.config.ts` 强制）。

CDN 要求：

1. 缓存键必须保留 `_rsc` 查询参数，并转发 `rsc`、`next-router-prefetch` 请求头。
2. 不回源缓存 `/admin`、`/api` 与带登录 Cookie 的请求。
3. HTML 和 `_rsc` 变体不缓存；初次迁移时刷新 CDN 中残留的 `/`、`/dapp/*` 和各短路径缓存。
4. 更换同名图片时，清理 `.next/cache/images` 并刷新 CDN，否则 31 天内仍是旧图。

公开链接已移除 `/dapp` 前缀，旧链接通过 308 跳转到短路径，保留邀请码等查询参数；后台和 API 地址保持原有路径。构建时设置 `CABI_DEPLOYMENT_ID` 为提交哈希，可让打开旧页面的用户在版本变化时自动重载。

浏览器的链上只读请求统一发送到同站 `/api/rpc`，服务器核对链 ID 后转发固定上游，支持短缓存、并发去重和节点故障切换。中转不支持签名、发送交易或任意上游地址；付款核验仍走服务端实时查询。钱包添加 BSC 网络使用公开 HTTPS RPC，钱包签名和广播仍由钱包完成。

构建后运行 `node deploy/precompress-static.mjs` 生成 Brotli / gzip 副本；示例 Caddy 配置直接提供 `/_next/static/*`，优先选择 Brotli，并给带哈希资源一年缓存。Caddy 服务用户需要能读取该目录。大陆实际延迟仍取决于源站线路，进一步提速需选择大陆可达性好的 CDN 或邻近机房，并保持动态接口不缓存。

## 6. 备份与恢复演练

```sh
CABI_DATA_DIR=/var/lib/cabi \
CABI_BACKUP_DIR=/var/backups/cabi \
node deploy/backup-sqlite.mjs
```

脚本用 `VACUUM INTO` 生成一致性快照，**不直接拷正在写的 `.sqlite` / `-wal`**；默认保留 14 份，可用 `CABI_BACKUP_KEEP` 调整。

cron 示例：

```cron
10 3 * * * root CABI_DATA_DIR=/var/lib/cabi CABI_BACKUP_DIR=/var/backups/cabi /usr/bin/node /opt/cabi/deploy/backup-sqlite.mjs >> /var/log/cabi-backup.log 2>&1
```

不要在 crontab 或脚本里写死 `REDEMPTION_DATA_SECRET`；脚本只检测环境里是否提供密钥并提示。

- 备份必须同时保存 `REDEMPTION_DATA_SECRET`（缺失时回退 `ADMIN_SESSION_SECRET`）；没有密钥，`redemption.sqlite` 中的收货信息无法解密。
- 备份目录 `0700`、文件 `0600`，复制到另一台主机或对象存储，不要只留在本机同盘。
- 每次发布前额外备份一次。

恢复演练（在预发或临时实例执行，不要在生产直接试）：

1. `systemctl stop cabi`
2. 把某份备份目录内的 `*.sqlite` 复制回 `/var/lib/cabi/`
3. 删除旧的 `*.sqlite-wal`、`*.sqlite-shm`（残留 WAL 可能让快照回到旧状态）
4. `chown -R cabi:cabi /var/lib/cabi && chmod 700 /var/lib/cabi && chmod 600 /var/lib/cabi/*.sqlite`
5. 确认 `REDEMPTION_DATA_SECRET` 与备份时一致后启动服务
6. 验证：管理员能登录、设置可读、兑换单列表和收货信息能解密、邀请关系可查询
7. 每季度演练一次并记录耗时

## 7. 安全组与端口

- 公网只开放 **443**（建议同时开 80 用于跳转和证书签发）。
- **22 只允许管理员固定 IP**。
- 应用 3000 只监听 `127.0.0.1`，不要对公网开放。
- `APP_ORIGIN` 必须是 `https://真实域名`（钱包签名消息包含 origin）；启用 HSTS。

## 8. 构建期变量提醒

`NEXT_PUBLIC_CHAIN_ID`、代币/合约地址、RPC、`NEXT_PUBLIC_TRADING_MODE` 在 `next build` 时写入产物。修改后必须重新构建并重启；只改运行环境变量不会生效。

正式 CaBi 主网配置记录在 `deploy/bsc-mainnet.env`，仅包含公开配置。构建前将其中所有配置合并到构建环境的 `.env.production`，并同步运行环境，保留其他现有配置。2026-11-08 重发的代币地址为 `0x153211c82ee4e60d96e712e9b3e50368cd91c7b0`，组 LP / 领取池为 `0x8c063f28d757246f113ab99d7aa7dc8801b009d2`，网络为 BSC 主网（56）。核验记录见 `deploy/relaunch-20261108.result.json`。新池已注入 7 亿枚储备；首次加池、领取及交易时间另行设置。切换地址时保留清理后的数据库和付款起始区块，新合约对应的网站组 LP 开关保存为暂停，业务开关由管理员决定何时开放。
