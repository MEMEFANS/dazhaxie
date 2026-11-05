# 蟹比特 · CaBi DApp

Next.js 16 / React 19 / Node.js 24 应用。认购、基于认购记录的定时双模式领取、实物兑换及后台管理使用真实合约/API；代币买卖跳转外部交易页面，不在 DApp 内提供买卖表单。

## 本地运行

```sh
npm ci
npm run admin:setup
npm run dev
```

首页 http://localhost:3000/，管理入口 /admin/login。管理员初始化资料写入本机私有文件，终端不打印密码；Windows 默认 %LOCALAPPDATA%/CaBi/admin/login-credentials.txt。已有配置不会覆盖。

## 正式配置

参照 .env.example；默认 BSC 主网56。所有未部署的地址留空，不会自动使用历史测试网合约。NEXT_PUBLIC_ 修改后重新构建；服务器设置 APP_ORIGIN=https://实际域名。

| 配置 | 说明 |
| --- | --- |
| NEXT_PUBLIC_CHAIN_ID | 56主网 / 97测试网 |
| NEXT_PUBLIC_TRADING_MODE | pancake（新版 CaBiPancakeToken）/ gateway（旧网关版） |
| NEXT_PUBLIC_TOKEN_ADDRESS | 与所选模式对应的 CaBi 合约 |
| NEXT_PUBLIC_USDT_ADDRESS | 当前链 USDT，业务界面支持6/18位精度 |
| NEXT_PUBLIC_SALE_ADDRESS | **已废弃并移除读取**。认购改为用户直接向后台配置的收款地址转 USDT，由服务器核验记账；不要填写或重新引入 |
| NEXT_PUBLIC_CLAIM_POOL_ADDRESS | CaBiMerkleClaimPool(token, owner)，Merkle 自领领取池；owner 发布 root，用户带 proof 自领，支付 30% USDT 组 LP、70% 到账 |
| NEXT_PUBLIC_REWARD_POOL_ADDRESS | 可选历史 XBTRewardPool（50% / 金库模式），新定时领取方案留空 |
| NEXT_PUBLIC_GATEWAY_ADDRESS | 仅旧 gateway 模式填写；薄饼模式留空 |
| NEXT_PUBLIC_SWAP_URL | 可选薄饼 HTTPS 地址，默认官方 swap 路径；网站会追加当前代币及 BSC 参数 |
| NEXT_PUBLIC_RPC_URL | 可选公共 RPC，进入浏览器，不要填写含私钥的地址 |
| REDEMPTION_DATA_SECRET | 至少32字符的固定服务端订单加密密钥，与数据库一并安全备份 |
| CABI_DATA_DIR | 固定持久磁盘目录，单实例 SQLite |
| REDEMPTION_CONFIG_CACHE_MS | 服务端兑换配置缓存毫秒数，默认 60000，0 关闭，最大 300000 |

ADMIN_USERNAME、ADMIN_PASSWORD_HASH、ADMIN_SESSION_SECRET、REDEMPTION_DATA_SECRET 仅服务端使用。不要添加 NEXT_PUBLIC_ 前缀，不放 public，不提交版本库。当前兑换兼容回退使用 ADMIN_SESSION_SECRET；生产应固定独立 REDEMPTION_DATA_SECRET，已有订单时不能随意更换，否则旧收货资料无法解密。

## 部署（生产）

**服务器选型**：最小可跑 2 vCPU / 4 GB / 40 GB SSD / 5 Mbps；推荐 4 vCPU / 8 GB / 80 GB NVMe / 30 Mbps + CDN。系统 Ubuntu 24.04 LTS + Node.js 24 LTS。

- 构建使用 `output: "standalone"`，发布 `.next/standalone/server.js`，并手动复制 `.next/static` 与 `public`；完整命令见 [deploy/README.md](deploy/README.md)。
- 服务只监听 `127.0.0.1:3000`，由 Caddy/Nginx 提供 HTTPS；安全组只开 443（80 用于跳转与签发），22 限管理员 IP。
- 三个 SQLite 文件必须放在项目目录外的持久磁盘（建议 `/var/lib/cabi`，0700、属主为服务用户），不可用网络盘；**保持单实例**，多实例需先迁移 Postgres。
- `NEXT_PUBLIC_*` 在构建期固化，换合约地址或链 ID 必须重新构建。
- 发布前先备份；备份脚本、恢复演练、systemd 单元与反代示例见 [deploy/README.md](deploy/README.md)。

## 已实现流程

- 钱包：账户/网络同步，错误网络阻止写入，真实余额使用 bigint，不恢复本地演示记录。
- 认购（服务器记账）：进入 DApp 前先完成邀请绑定；用户直接向后台配置的认购收款地址转入 USDT，金额 = 份数 × 50。服务端复用兑换核验：交易成功、至少 2 个确认、from = 用户、tx.to = USDT、transfer 参数与 Transfer 事件一致、金额与份数匹配，且同一哈希只登记一张认购单。单账户 1–2 份、全局硬顶 20000 由服务端复核；globalSold、直推业绩、团队业绩全部由认购单聚合，前端不再模拟。
- 领取（Merkle 自领领取池）：CaBiMerkleClaimPool(token, owner) 不依赖任何认购合约，也不需要逐人写入额度。后台按认购单 + 直推每 3 份 1 份 + 团队极差算出每人累计额度，生成 Merkle root 与每人 proof；owner 用自己的钱包调用 setMerkleRoot(root, epoch) 发布批次，用户带 proof 调用 claim(累计额度, proof) 自领。服务器不持有任何私钥，只返回 proof 与导出 CSV。领取只有一条路径：支付 30% USDT 等值，30% CaBi 与这笔 USDT 一并进入项目 LP 接收地址，70% CaBi 到账用户。
- 领取保护：nonReentrant、迷你 SafeERC20、零地址校验、余额不足整体 revert；累计额度绑定 epoch，claimedOf 只允许领取差额，重复提交同一额度或使用旧批次 proof 都会 revert。比例固定 70 / 30 / 30，LP 接收地址或 USDT 未配置时领取直接 revert，不存在 50% 兜底路径。
- 历史独立奖励池：仅填写 NEXT_PUBLIC_REWARD_POOL_ADDRESS 时显示旧版 XBTRewardPool 的 50% / 金库模式；它只转账到金库，不自动创建 LP，不会迁移到新池。
- 实物兑换：不依赖兑换合约。用户按 3500 CaBi / 份把代币直接转入后台配置的收款地址（默认黑洞地址，可改为任意项目地址），确认转账后页面锁定「已转账待提交」，再填写收货信息。服务端按代币合约核验转账：发起钱包、收款地址、金额、Transfer 事件与回执成功，同一交易哈希只能绑定一张兑换单。
- 订单物流：订单状态仅「待发货 / 已发货 / 已完结」；用户仅查看本人订单，管理员只能给待发货订单填物流并备注，用户确认收货后完结。
- 交易反馈：区分钱包确认、授权、业务交易、待确认和失败。钱包/链变化后不会显示前一个账户的成功状态。
- 后台：服务端 HttpOnly 会话及 SQLite 审计，链上管理仍需对应 owner 钱包签名。

客服聊天、工单及完整团队关系/历史索引尚未接入，继续明确关闭或显示未知，不编造人数和流水。

## 推广奖励与累计团队结算

### 邀请绑定入口

总览及所有 DApp 路由要求先连接钱包、免费签名登录邀请账户，然后绑定服务器生成的 8 位邀请码。没有链接须手填邀请码；链接带唯一 ref 参数时自动预填，仍须本人确认。只签登录消息，不请求代币授权、不发送绑定交易、不消耗 Gas。推荐关系保存在 CABI_DATA_DIR/referrals.sqlite，不依赖链上绑定接口、认购资金或 RPC。只有服务器确认已绑定（或管理员初始化的项目邀请账户）才挂载业务页面；刷新或换设备后登录同一钱包恢复。数据库启用 WAL 和原子事务，拒绝自邀、循环、无效/未启用邀请码及更换上级。前端只显示短码，不把钱包地址当邀请码。

首次运营：管理员在 /admin/community 的“项目初始邀请码”中填写项目真实钱包，启用并获取首个邀请码。该钱包作为无上级的项目根账户，普通用户不需要后台逐个登记。系统不预置演示邀请码，不会把第一位访问者自动设为项目方。服务器需要持久磁盘并备份 referrals.sqlite（运行中采用 SQLite 一致备份）；不要部署到临时文件系统或用多实例各自独立的 SQLite。邀请登录与兑换订单会话各自隔离，Cookie 为 HttpOnly/SameSite Strict，仅数据库存登录令牌哈希。

绑定本身完全在服务器完成。直推奖励由服务器按认购单聚合，不再读取任何认购合约的 referrer；用户认购只是向收款地址转 USDT，提交前再次核对服务器关系、当前钱包和同区块认购记录，上级不一致或未绑定则阻止认购。不会静默更换历史上级或追补历史奖励。项目根账户无上级。入口强制邀请是网站规则，不等于所有外部合约调用都强制邀请码。

直推按认购份数计算，不按人数：同一推荐钱包带来 2 份后再带来 1 份，累计增加 1 份奖励；达到 6 份累计为 2 份。每次只记新跨过的整档，奖励计入服务器累计可领额度，实际到账仍遵守下述强制 30% LP / 70% 领取规则。

团队档位按所有下级无限代的成功认购份数取档，不含本人；100 / 200 / 500 / 1000 / 2000 份分别为 1% / 2% / 3% / 4% / 5%。已确认的每个直接下级分支奖励为：本人的团队档位比例 × 该直接下级本人认购份数，加上 max(本人团队档位比例 − 该下级团队档位比例, 0) × 该下级团队份数。下级自己的团队档位仍不包含其本人认购，不能遗漏这部分给上级的奖励。

例如 100 名直接下级各认购 1 份，或 50 名各认购 2 份，上级团队都为 100 份、档位 1%，团队奖励都为 1 份；这与自动直推奖励分别计算，不重复录入直推。按整棵关系树逐人汇总后向下取整到整数份，每份对应 35,000 CaBi 完整配额，不对每个分支先分别取整。

后台「认购管理」的领取池卡片由服务器直接计算：按同一邀请关系树展示认购、直推、极差与合计份数，每份对应 35,000 CaBi。点击「生成 root 与 proof」会按当前累计额度生成 Merkle 批次（root、epoch、每人 proof）并落库，同时给出 owner 上链所需的 setMerkleRoot calldata 与 CSV 导出。

批次号、epoch、root、地址数、总额、交易哈希与状态落库。owner 用自己的钱包发布 root 后回后台登记 txHash；重复登记不会重复发布。用户领取时由 `/api/claim/proof` 返回当前批次的 proof，合约按 `claimedOf` 只发累计额度的差额，重新生成更高的累计批次不会重复发放；团队加减档规则不变，链上只保存最终累计额度，不保存团队累计。

## 底池周期销毁

新版 CaBiPancakeToken 已加入固定每 8 小时销毁唯一绑定 V2 池内当前 CaBi 余额 1% 到黑洞，保留报价资产 USDT / WBNB 及 LP 凭证，并同步池子储备。按实时余额三次约 2.9701%，不是日初余额精确 3%；不补扣错过的时段。正常买卖税和认购领取规则独立。后台“代币与交易税管理”提供到期执行与状态；scripts/pool-burn-keeper.cjs 提供默认只读检查和显式 --execute 执行模式。自动执行需要部署新版合约后配置真实地址、专用 keeper 钱包及持久目录，并在服务器调度；当前未部署、未启动定时任务。详见 contracts/DEPLOYMENT.md 的“底池固定周期代币销毁”。

## 薄饼交易税（50% 分配 / 50% 回购池）

新版 CaBiPancakeToken 用于直接 V2 Router 交易：买入输出扣 3% CaBi，累积后卖成 USDT，固定按 50% / 50% 分发——一半进入分配地址，一半进入回购池；卖出 3% CaBi 直接入黑洞；普通转账 0%。这是两个指定地址的固定分账，不是所有持币人的自动分红，也不等于精确扣买家付款的 3% USDT（V2 pair 直接把代币付给买家，代币合约无法在同一笔交易里额外划走买家 USDT）。

分发比例固定为 50% / 50%（`PAYOUT_BPS = 5000` 常量，无比例 setter）；奇数最小单位余数归回购池。两个地址由 owner 通过 setTaxReceivers 配置，必须非零、互不相同，且不能是本合约、taxReceiver、黑洞或已配置的 router/pair/USDT。税币不会在买入时兑换，避免 pair 锁冲突；后续卖出时尝试限额兑换，失败保留税币且不阻断卖出。USDT 支付失败保留原收款地址的待领额度（pendingPayouts），可由该地址 claimPayout 提取到其它地址。更换收款地址不会迁移旧额度。

只覆盖绑定的 CaBi/USDT V2 池；V3、其它池和任意路由不在本实现保证范围内。外链只有在代币版本正确、已绑定且有流动性时开放。手续费滑点需在薄饼核对；自动税币兑换使用现货报价保护，不能消除MEV。

初始流动性需先创建pair并给pair持仓豁免，在交易尚未绑定时添加，再 configureTrading 一次绑定。绑定后直接加LP按卖税、移除LP按买税。完整部署步骤见 contracts/DEPLOYMENT.md。

## 独立领取池（Merkle 自领）

代币合约不包含普通用户奖励名单、个人可领额度或认购领取逻辑。CaBiPancakeToken.claimPayout 只处理两个税款收款地址（分配地址与回购池）未成功到账的 USDT。领取使用独立合约 CaBiMerkleClaimPool(tokenAddress, ownerAddress)，**不依赖任何认购合约**，也不需要逐人写入额度或服务器签名；token 部署后不可更换，USDT 由 owner 调用 setUsdt 配置（自动读取 6/18 位精度），LP 接收地址由 setLpReceiver 设置。

owner 直接把 CaBi 转入领取池即可，没有 deposit / withdrawUnused；额度以 Merkle root 形式一次性发布。大额注资前，由代币 owner 设置 setMaxWalletExempt(pool,true)；这只豁免池子的持仓上限，不豁免买卖税，普通用户仍受当前持仓上限约束。

额度由服务器聚合，链上不计算：后台按认购单 + 直推（每满 3 份 = 1 份）+ 团队极差算出每人累计额度，生成 root 与每人 proof。owner 用**自己的钱包**调用 setMerkleRoot(root, epoch)，epoch 必须递增；Web 服务不持有任何私钥，只保存批次与 proof。用户带 proof 调用 claim(累计额度, proof)，合约按 claimedOf 只发差额，重复领取、旧批次 proof、篡改额度都会回滚。

领取只有一条路径：

- 组 LP 领取：到账 70%，30% CaBi 转入 owner 配置的 lpReceiver；同时通过 transferFrom 收取 30% USDT 等值（差额 × 50 × 30% × 10^usdtDecimals ÷ 35000），用户需先授权 USDT 给领取池。USDT 归 lpReceiver。

比例固定为 70 / 30 / 30（`PAYOUT_RATIO` / `LP_TOKEN_RATIO` / `LP_USDT_RATIO` 常量，无 setter）。lpReceiver 为 0 或 USDT 未配置时领取直接 revert。领取前重新读取链上快照，root/epoch、额度、LP 地址或余额变化会整体 revert。

只读字段：merkleRoot、epoch、poolBalance、totalClaimed、totalLpTokens、totalUsdtCharged、claimedOf、previewClaim(user, 累计额度)。前端按同一区块读取，并校验 70/30 拆分为整数、token 与配置一致、poolBalance 与链上余额一致、预览与服务器额度一致；任一项不符直接报错，不展示不安全数字。

填写 NEXT_PUBLIC_TOKEN_ADDRESS、NEXT_PUBLIC_USDT_ADDRESS 和 NEXT_PUBLIC_CLAIM_POOL_ADDRESS 后重新构建；不要填写已废弃的 NEXT_PUBLIC_SALE_ADDRESS。开放前核对池余额、LP 接收地址和小额领取全流程。

## 上线顺序

1. 确认管理员、分配地址、回购池地址及项目 LP 接收地址。LP 接收地址不是代币/USDT/交易对/路由等系统地址，不得假设它已锁仓。新版代币 constructor(distributionReceiver,buybackPool,ownerAddress) 全量发给 ownerAddress，后续分配由持币人决定。领取池构造参数为 (token, owner)；owner 初始为部署钱包，如最终管理员不同用两步 transferOwnership。
2. 创建并配置官方 V2 流动性及一次性交易绑定，核验所选 Router/USDT/Factory/pair。
3. 部署 CaBiMerkleClaimPool(token, owner)，随后由 owner 调用 setUsdt(USDT)、setLpReceiver(项目 LP 地址)。两者缺一用户就无法领取。CaBiSimpleClaimPool / CaBiSignedClaimPool / XBTSale.sol / CaBiClaimPool.sol 仅留档，不再部署、不再被前端引用。
4. 代币 owner 先为领取池设置持仓豁免，再把实际所需的 CaBi 直接转入领取池；领取池没有 deposit / withdrawUnused，额度只能通过 Merkle root 发布。其它大额业务合约或金库按需单独豁免。
5. 后台设置认购收款地址并开启认购：用户直接转 USDT → 服务端核验并生成认购单 → 按认购单 + 直推 + 极差聚合额度 → 后台生成 root 与 proof → owner 钱包执行 setMerkleRoot(root, epoch) → 后台登记交易哈希。全流程无需 CLAIM_SIGNER_PRIVATE_KEY。核验小额全流程后再正式开放；实物兑换默认库存 0 且关闭，需设置真实价格/库存并开启运营开关。
6. 填写公开地址，保存固定服务器加密key和持久数据目录，重新构建；核对小额完整流程后再正式开放。

本轮只修改代码和隔离测试，不会自动部署、注资、添加流动性或发送链上交易。

## 数据、备份与缓存

operations.sqlite 保存后台会话/设置/审计；referrals.sqlite 保存邀请关系和登录会话；redemption.sqlite 保存钱包 nonce/会话、订单和 AES-256-GCM 加密收货资料。默认项目外 Windows %LOCALAPPDATA%/CaBi/admin，其他系统 ~/.local/share/cabi-admin；生产用 `CABI_DATA_DIR` 固定到持久磁盘。

备份使用 [deploy/backup-sqlite.mjs](deploy/backup-sqlite.mjs) 的 `VACUUM INTO` 一致性快照，不直接拷贝正在写入的库和 WAL；备份必须同时保存订单加密 key，且不可放公开静态目录。恢复步骤与演练清单见 [deploy/README.md](deploy/README.md)。多实例或无持久磁盘部署需先改共享数据库。

`/api/redemption/config` 带 60 秒进程内缓存（`REDEMPTION_CONFIG_CACHE_MS` 可调，0 关闭），命中时不再请求 RPC；后台改收款地址或兑换开关会立即失效，RPC 失败不缓存。响应头 `X-Redemption-Config-Cache` 只标记 `hit` / `miss`。

## 检查

```sh
npm run lint
npx tsc --noEmit
npm run test:wallet
npm run test:contracts
npm run test:pancake
npm run test:claim
npm run test:business
npm run build
```

测试使用隔离 provider、临时数据库和本地 Ganache，不使用真实用户私钥、钱包签名或公共链交易。通过测试不等同于外部安全审计；正式地址配置与线上端到端验收仍需在部署后完成。
