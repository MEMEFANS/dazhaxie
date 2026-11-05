# CaBi 合约部署与业务接口

## 当前薄饼方案：CaBiPancakeToken

用户要求在外部薄饼买卖，网站默认 NEXT_PUBLIC_TRADING_MODE=pancake。正式代币使用 CaBiPancakeToken.sol，不使用下方 legacy XBTToken + XBTTradingGateway 方案。两个方案的经济口径不同，不能把旧已部署地址当成新版。

**当前业务架构（2026-11 起）**：认购不再使用 XBTSale，用户直接向后台配置的认购收款地址转 USDT，服务端核验记账；奖励额度由服务器按认购单 + 直推 + 团队极差计算，用仅签名权限的 CLAIM_SIGNER 签发绑定本次金额与累计上限的 EIP-712 授权，用户自己调用 `CaBiSignedClaimPool(token, signer, owner)` 领取，可分次领且不能超过累计额度。领取只有一条路径：支付 30% USDT 等值，30% CaBi 与这笔 USDT 一并转入 lpReceiver，70% CaBi 到账用户；合约不会自动铸造 LP。`XBTSale.sol` / `CaBiClaimPool.sol` / `CaBiSimpleClaimPool.sol` 仅留档，不部署、不被前端引用。部署顺序：代币 → CaBiSignedClaimPool(token, signer, owner) → setUsdt / setLpReceiver → 为领取池设置持仓豁免并直接转入 CaBi → 后台设置收款地址并开启认购 → 配置 CLAIM_SIGNER_PRIVATE_KEY（需与链上 signer 一致）→ 用户签名登录自领。owner 私钥不得进入 Web 进程。

### 签名自领领取池：CaBiSignedClaimPool

constructor(tokenAddress, signerAddress, ownerAddress) 三参数；token/signer 可换（setSigner 由 owner 调用，换后旧签名立即失效），owner 两步交接。

固定比例（常量，无 setter）：`PAYOUT_RATIO=70`、`LP_TOKEN_RATIO=30`、`LP_USDT_RATIO=30`；USDT 金额 = 额度 × 50 × 30% × 10^usdtDecimals ÷ 35000，与认购单价口径一致。`lpReceiver` 或 `usdt` 未配置、用户 USDT 余额或授权不足时，整笔领取 revert，不存在 50% 兜底。

接口：`previewClaim(amount)`、`claim(amount, nonce, deadline, signature)`、`claimDigest(...)`、`deposit`、`withdrawUnused`、`setSigner`、`setLpReceiver`、`setUsdt`、`setClaimLimit`、`transferOwnership` / `acceptOwnership`；只读 `claimedOf`、`nonceUsed`、`poolBalance`、`allocatedUnclaimed`、`totalClaimed`、`totalLpTokens`、`totalUsdtCharged`。

EIP-712：domain `("CaBiSignedClaimPool","1",chainId,pool)`，结构 `Claim(user,amount,nonce,deadline)`；nonce 一次性、deadline 限时，服务端签发前会校验 USDT 支付能力。

### 代币与手续费

- 名称/符号 CaBi，18位，总量10亿；constructor(distributionReceiver,buybackPool,ownerAddress) 将全部供应量一次性发给 ownerAddress，无增发、自动分配或自动锁仓。
- 指定 CaBi/USDT V2 pair 输出到买家时：3% CaBi 进入代币合约，97% 到买家。之后将税币兑换 USDT，固定按 50% / 50% 分账——一半给分配地址，一半给回购池（奇数最小单位余数归回购池）。不是精确收取买入付款额的3% USDT：V2 pair 直接把代币付给买家，代币合约无法在同一笔交易里额外划走买家 USDT。
- 转入指定pair卖出时：3% CaBi直接去0x000000000000000000000000000000000000dEaD，97%进入pair。owner同样收卖税。
- 普通钱包和业务合约转账不收交易税；不自动覆盖其它池、V3或任意多跳路径。
- 普通持仓默认20万，可 setMaxWalletAmount；setMaxWalletExempt 仅豁免持仓上限，不豁免买卖税。新owner需transferOwnership提名后acceptOwnership接受。
- 代币合约不承担普通用户奖励分配或领取。claimPayout 仅处理分配地址与回购池待领 USDT，不是用户的 CaBi 领取入口；用户通过独立 CaBiSignedClaimPool 领取：支付 30% USDT 组建流动性，30% 代币进 LP 接收地址，70% 到账。

### 底池固定周期代币销毁

新版 CaBiPancakeToken 固定 POOL_BURN_INTERVAL=28800 秒、POOL_BURN_BPS=100：配置交易对 configureTrading 后开始计时，每满 8 小时可调用一次 burnPool()，按执行时该交易对 CaBi 实际余额的 1%（最小单位向下取整）转入黑洞。销毁只扣 CaBi，池内 USDT / WBNB 不转出、不卖出；不销毁 LP 凭证，也不额外扣买卖税。随后 pair.sync() 同步储备；总发行量 totalSupply 保持原口径不变，黑洞余额和 totalPoolBurned 增加。只适用于唯一绑定的 V2 交易对，不能泛指所有资金池或其它交易对。当前网站交易、税款分配和组 LP 方案仍按 CaBi/USDT 配置，不因本功能自动扩展为 BNB 交易方案。

按“每次实时余额 1%”执行三次，无交易/增减流动性时累计是 1−0.99³=2.9701%，不是精确按日初余额扣 3%。间隔以实际成功执行时间为准，未按时执行不积累补扣，不能在恢复时连扣多个时段。新方法无管理员可变费率、无强制在转账中抽池逻辑，避免买入、移除 LP、闪电交换期间的 pair 锁及旧报价冲突。空池、余额/储备未同步、最小单位销毁为零、同步失败均拒绝，失败不推进时间、不减少资产。尚未 mint 的加池转账或外部捐款需先由其所有者完成相应操作或 sync；本功能不会替用户处理这些款项。池内代币与报价资产比例改变会影响现货价格、LP 价值与后续交易。

链上合约不会自行发送交易。任何钱包都可触发到期 burnPool，不要求 owner，仅支付执行交易的 BNB 网络费。后台“代币与交易税管理”新增底池销毁状态、北京时间、累计量、实际预估与确认入口。签名前重新校验数量和时段；持币人无需授权。

服务器定时执行使用 scripts/pool-burn-keeper.cjs：默认 npm run keeper:pool-burn 只读检查；明确 npm run keeper:pool-burn -- --execute 才广播。进程需配置 NEXT_PUBLIC_CHAIN_ID、NEXT_PUBLIC_TOKEN_ADDRESS、NEXT_PUBLIC_USDT_ADDRESS、POOL_BURN_RPC_URL（或 NEXT_PUBLIC_RPC_URL），执行模式另注入 POOL_BURN_KEEPER_PRIVATE_KEY，使用专用少量 BNB 钱包，不使用 owner 密钥；脚本不会读取 .env.local 或私钥文件。POOL_BURN_MAX_GAS_PRICE_GWEI 默认 5，超限停止等待下次。建议调度器每 1 分钟执行一次，未到时只读；单次运行采用本地锁和持久待确认记录，超时下一次先核对原交易，不重复广播。CABI_DATA_DIR 必须持久化，多个执行器须使用同一目录；进程异常留下 .lock 时先确认无旧进程及原交易状态，再手工清理锁。

当前只实现并本地验证源码、后台和执行器，未启动定时服务、未部署或广播。已部署不可升级的旧代币不会自动增加该机制，必须部署新版并重新配置真实交易对；不可把网站源码变更视为已修改旧链上合约。

### 交易税分账与兑换

setTaxReceivers(address distributionReceiver,address buybackPool) 设置分配地址与回购池地址：必须非零、互不相同，且不能是本合约、CaBiTaxReceiver、黑洞，或在 configureTrading 之后为 router / pair / USDT。分账比例固定为 50% / 50%（`PAYOUT_BPS = 5000` 常量），不提供比例 setter；奇数最小单位余数归回购池。按处理时的收款地址分配，更换地址只影响之后处理的税币。

买入不触发兑换，避免 V2 pair 输出期间的锁；后续卖出按阈值尝试限额兑换。自动兑换失败只回滚该步骤，保留税币，不阻断正常卖出。兑换 USDT 的接收中转合约 CaBiTaxReceiver 由代币构造自动建立，仅代币可从中转出，不是管理网关。

setSwapSettings(threshold,maxAmount,slippageBps,enabled) 可调：threshold>0、threshold<=maxAmount、maxAmount<=10万CaBi、slippageBps<=1000。默认1000/10000枚、5%滑点。previewTaxSwap(amount) 返回现货预估和保护下限；processTax(amount,minUsdtOut,deadline) 允许主动处理，要求minOut不低于即时保护下限和有效deadline。此现货保护不能消除MEV。

自动向接收地址支付失败时，pendingPayouts(receiver)保留该地址的待领USDT；receiver可claimPayout(recipient)转至有效地址。更换收款地址不转移旧credit。

### 主网部署顺序

1. 确认分配地址、回购池地址和最终owner；部署 CaBiPancakeToken(distributionReceiver,buybackPool,ownerAddress)。
2. 核验选定V2 Router/Factory/USDT，在同一Factory创建CaBi/USDT pair。不要使用V3池。
3. owner先setMaxWalletExempt(pair,true)，持币人授权Router并在尚未绑定交易时添加初始流动性；数量和初始价格由持币人决定。
4. owner调用一次configureTrading(routerAddress,usdtAddress,pairAddress)。合约验证Factory及资产匹配，绑定后不能随意换池。
5. 绑定后直接加LP按卖税、直接移除LP按买税；必须理解此税务行为再操作，不宣传流动性操作免税。
6. 新定时双模式领取先部署 XBTSale 并关闭认购，再部署 CaBiClaimPool(token,sale,owner)；首次认购或任何正奖励额度产生前，由 Sale owner 一次绑定领取池。无需旧版 XBTRewardPool。CaBiClaimPool、XBTRedemption 的 owner 通过构造参数指定；XBTSale（及可选历史 XBTRewardPool）的初始 owner 为部署钱包，若最终管理员不同须单独 transferOwnership(finalOwner)。先给领取池设置持仓豁免，再把足额 CaBi 注入领取池，不是 Sale。领取池 owner 显式 setLpReceiver(projectAddress) 后才启用组 LP，初始地址 0 不会自动替换为 owner；领取时间单独配置。其它大资金池和历史金库按需豁免，历史金库不能填 AMM pair。
7. 配置网站主网地址、pancake模式，NEXT_PUBLIC_GATEWAY_ADDRESS留空；重新构建并核验状态。网站仅在代币版本正确、pair已绑定且储备非零时开放薄饼外链。

## 认购：新版 XBTSale

constructor(usdt,token,vault,fundReceiver)。owner 初始为 msg.sender（部署钱包）；与最终管理员不同时，部署后单独 transferOwnership(finalOwner)。vault 必须为独立普通收款地址或专用 vault，不能填 AMM pair；转入 pair 会触发卖税且不会铸造 LP。UNIT_PRICE按USDT decimals计算50USDT；前端适配6或18位。每份35000CaBi，单钱包累计2份，全局2万份；认购款全部给fundReceiver。

新版绑定模式先向 CaBiClaimPool 转入足额 CaBi；fundingBalance() 读取该池余额，认购（含触发直推奖励）、batchSetTeamRewardTotals 及历史 batchCreditTeamReward 创建领取义务时均必须覆盖 reservedTokens。未绑定的历史模式才以 Sale 自身余额作储备。网站进入总览及任意 DApp 前须通过下述服务器邀请码绑定，之后不能改绑，不能自己/循环推荐。直推按成功认购份数每满 3 份自动记 1 份奖励，不按人数；newDirect / 3 − oldDirect / 3 只发新增整档。团队奖励仍须核实后由 owner 记入累计目标，不能宣称领取池会自动计算完整团队业绩。

### 服务器邀请码绑定（无 Gas）

网站使用服务器生成的 8 位邀请码，保存在持久化 referrals.sqlite；不是完整钱包地址。无链接时须填写，链接带唯一 ref 时预填并要求确认。免费钱包消息签名只验证邀请账户身份，绑定使用同源 API 和 HttpOnly 会话，不发送链上绑定交易，无需 BNB 或代币授权。服务器按已验证的钱包保存唯一上级，原子事务拒绝自邀、循环和改绑。管理员先在 /admin/community 初始化真实项目钱包并获取首个邀请码；普通用户无需管理员逐个登记。后台独立，不受用户邀请码门禁限制。

认购合约仍按 referrer 记录自动直推奖励。网站第一次 subscribe(quantity,referrer) 自动传入服务器短码对应的上级钱包，不额外调用 bindReferrer，也不要求 REFERRAL_BINDING_VERSION。正常认购交易和 USDT 授权仍有网络费。签名前（包括授权完成后）重新核验服务器关系及同区块链上历史；已有链上上级不一致、或历史无上级认购不能补录时，阻止并提示核对，不假装迁移或追补奖励。项目初始账户没有上级，认购传零地址。源码的 bindReferrer/REFERRAL_BINDING_VERSION 仅保留历史兼容，网站不使用。纯服务器门禁不能阻止外部直接调用合约绕过网站，完整团队历史与自动核算尚未接入。

用户先 approve USDT 给 Sale，再 subscribe(quantity,referrer)。新版绑定后，完整认购及已记录奖励额度由 CaBiClaimPool 在开放时间后结算：用户选择直接 50% 到账、50% 销毁，或 70% 到账、30% 毛额 CaBi 加用户实时配对 USDT 铸造项目 LP。Sale 的直接 claim/claimChecked 入口会拒绝领取，避免双领。只有未绑定的历史模式继续使用 Sale.claimChecked(expectedVault,expectedLpFee)：70% CaBi 给用户，30% CaBi 及额外折合认购价 30% 的 USDT 转 vault；这条历史流程不调用 DEX、不铸造 LP，不能套用到新池。

poolBalance() 是 Sale 自身余额，fundingBalance() 是当前实际储备地址余额，reservedTokens() 是全部待结算的完整领取义务。finalize 只在关闭或售罄后执行：绑定模式仅销毁 Sale 自身余额，不动领取池资产和保留额度；历史模式仅销毁 Sale 中超过 reservedTokens 的余额。已有资格在 finalize 后仍按对应合约的领取方式及开放时间结算。

### 团队极差口径与累计防重复接口

teamShares(u) 为 u 的全部下级无限代成功认购份数，不含 u 本人；团队档位以 100 / 200 / 500 / 1000 / 2000 份对应 1% / 2% / 3% / 4% / 5%。对每个直接下级 c，按以下完整口径计算：

reward(u,c) = rate(teamShares(u)) × purchased(c) + max(rate(teamShares(u)) − rate(teamShares(c)), 0) × teamShares(c)

直接下级本人认购按上级档位计奖；下级档位仍只用其下级团队、不含其本人。同档时只有其下级团队差额为零，不能把下级本人认购一并遗漏。100 名直接下级各认购 1 份和 50 名各认购 2 份均组成 100 份团队、1% 档，团队奖励均为 1 份。逐人汇总全部分支后 floor 到整数份，不在各分支先取整；每份折合 35,000 CaBi 完整配额。直推每满 3 份奖励另计，不应混入团队累计输入。

新增接口与账本：

- teamRewardShares(address) 返回该地址累计已记账团队份数，不含直推。rewardShares(address) 继续返回直推和团队之和；领取不会清零 teamRewardShares。
- batchSetTeamRewardTotals(address[] users,uint256[] totals) 仅 owner、nonReentrant、尚未 finalize 时可调用。要求等长数组、1 至 100 个非零地址、uint256 累计整数份数；每个 total 必须不小于该地址当前 teamRewardShares。只把 total − previous 的新增差额加入 rewardShares 和 reservedTokens，不能回撤已经记账的奖励。
- 相同累计值不增加奖励，全批没有新增则拒绝。原子执行意味着资金不足、累计下降或任何无效项会回滚全批；同一地址重复出现相同累计值也只计第一次的差额，后台会提前拒绝重复地址。正新增会设置额度创建标记，阻止之后更换领取账本或首次绑定池。
- TeamRewardTotalSet(address indexed user,uint256 total,uint256 added) 同时记录目标累计与实际新增。新奖励需足额资金覆盖，领取后提高累计值只增加未曾入账的部分，不会重发已经领过的团队奖励。

原 batchCreditTeamReward(users,shares) 仅为历史人工增量兼容，重复调用仍会重复追加，不是防重接口；现在同时增加 teamRewardShares 和 rewardShares，所以后续累计接口会以该团队总额为基数。新后台只使用累计接口，不能回退旧增量方法，也不能填入直推奖励或“本次新增”冒充累计应得。

后台在新版绑定模式也提供累计团队结算：首次预览用同一区块读取链上累计、owner、资产、双向绑定及储备，显示每人的已记/累计目标/差额。管理员明确确认后，发起钱包操作前再次读取；累计、身份、配置或资金发生变化则撤销旧确认并要求重新核对。实际交易仍由合约检查权限、finalized、累计与资金覆盖，失败不产生部分奖励。

团队关系事件索引和自动核算服务尚未接入；目前是核实计算结果后 owner 入账，认购资格及直推自动记账不等于团队自动核算。新累计接口必须部署新版 XBTSale；旧已部署地址不能靠修改 DApp 自动增加接口，查询不支持时停止，不自动切换增量发放。已有认购、团队累计和已领取义务不迁移、不重复导入；旧合约继续结算原有业务，新部署须在任何正额度产生前一次绑定领取池。

## 自动识别资格的定时双模式领取：CaBiClaimPool

constructor(tokenAddress,saleAddress,ownerAddress) 仍为三个参数。token 与 Sale 不可更换，USDT 从 Sale.usdt() 读取并固定；构造时核验相同 CaBi、尚未绑定的 Sale 及有效 USDT。资格与完整待结算额度来自 Sale 链上账本，不维护领取钱包名单或个人配额，没有 batchSetClaimable。50% / 70% 为合约常量，不提供比例 setter。

### 绑定、资金与时间

1. 先部署新版 XBTSale，并由 Sale owner 调用 setSubscribeLocked(true) 关闭认购，再部署领取池。Sale owner 调用 setClaimPool(pool) 一次绑定：必须尚未产生认购或任何正奖励额度、尚未 finalize，池子的 token()/sale() 须匹配；绑定后不能改池。曾产生过额度的 Sale 即使已经领完，也不能切换。
2. 由代币 owner 调用 setMaxWalletExempt(claimPool,true)，使池子能接收大额注资；这只豁免池子的持仓上限，不豁免交易税。普通用户接收 50% 或 70% 到账值后仍须符合当前持仓上限。
3. owner 直接 transfer CaBi 到领取池，或先 approve 领取池后 deposit(amount)。不要把新绑定模式的储备存入 Sale。CaBi 使用 18 位最小单位，池余额必须覆盖全部 Sale.reservedTokens()；认购及正奖励创建时检查资金覆盖，足额后才开放认购。
4. owner 在后台按北京时间设置 setClaimStartsAt(uint64 startsAt)，链上保存 Unix 秒。初始 0 关闭，之后设 0 可暂停；任何非零新值必须晚于当前区块时间。到时允许用户发起领取，不自动推送代币。owner 仍能暂停或改为未来时间，不能宣传不可修改的解锁承诺。两种领取方式都需用户持有 BNB 支付网络 gas。

### 固定领取方式与项目 LP

| 模式 | 实际给用户的 CaBi | 剩余 CaBi 与用户成本 | 依赖 |
| --- | --- | --- | --- |
| mode 0 直接领取 | 完整待结算额度的 50%，整数向下取整 | 剩余部分全部转黑洞地址；无需额外 USDT | 不依赖 pair、Router、LP 接收地址或流动性配置 |
| mode 1 组 LP 领取 | 完整待结算额度的 70%，整数向下取整 | 余下约 30% 为毛额；转入 pair 正常收 3% 卖税，净额与用户提供的实时配对 USDT 一起 mint | 正确配置的新版 CaBiPancakeToken、canonical V2 池与有效 lpReceiver |

直接模式的余量因整数取整始终归入销毁。组 LP 的 lpTokens 是完整额度减去实际 70% 到账值的毛额；其卖出税进入黑洞，净额留在 pair。所需 USDT 按净额与交易池实时储备比例计算，并向上取整到 USDT 最小单位，支持 6 / 18 位 USDT；不是认购价格的 30%，也不是固定的认购折算费用。

组 LP 调用真实 pair.mint(lpReceiver)，新 LP 凭证归项目设置的接收地址，不发给用户。lpReceiver 初始为 0，owner 必须在后台空白输入框中显式填写并签名 setLpReceiver(address)，不会默认选 owner 或当前用户。地址不能为 0、黑洞、池自身、CaBi、Sale、USDT、当前交易对或 Router。未设置时仅组 LP 不可用，直接领取、注资和开放时间仍可用。LP 默认没有锁仓合约，接收地址持有并控制 LP，不应宣传自动锁定。

组 LP 只支持新版 CaBiPancakeToken 配置的 CaBi/USDT canonical V2 pair。池核验 token.usdt() 与 Sale.usdt() 相同、3% 卖税常量、Router 的 Factory、Factory.getPair、pair.factory() 和两种资产相互匹配，不保证旧代币、V3 或其它自定义实现可用。pair 必须已有有效储备与 LP 供应量，实际 CaBi/USDT 余额必须等于储备，脏余额会拒绝本次操作。tradingPair()/dexRouter() 动态读取代币配置，尚未配置可返回 0，不妨碍直接模式。

CaBi 毛额转向 pair 时可能先执行代币积税兑换，改变储备。领取合约在转入后读取新储备和实际净入账，再计算本次配对 USDT，不能沿用转账前 previewClaim 的旧储备。previewClaim(user,mode) 返回 entitlement、payout、burnAmount、lpTokens、usdtRequired、estimatedLiquidity 和 pair，只是预览。协议费开启时 pair.mint 可能先增发协议费 LP，实际返回的业务 LP 数量必须满足用户最少输出；若项目地址也是 feeTo，它可以额外收到协议费 LP，不能要求余额增量恰好等于业务返回值。现货报价不消除滑点或 MEV。

### checked 接口与原子结算

DApp 使用：

claimChecked(uint8 mode,uint256 expectedAmount,uint64 expectedStartsAt,address expectedLpReceiver,uint256 maxUsdt,uint256 minLiquidity,uint256 deadline)

- expectedAmount 是全部待结算额度，不是用户实际收到的 50% / 70%。额度、开放时间或 LP 接收地址变化会拒绝旧确认；两种方式都校验 expectedLpReceiver。
- 直接模式必须传 maxUsdt = 0、minLiquidity = 0、deadline = 0；基础入口为 claim(0)。claim(1) 会拒绝，组 LP 必须使用 checked 入口。
- 组 LP 由用户先 approve USDT 给领取池，不是给 Router 或 Sale。maxUsdt 和 minLiquidity 必须大于 0；deadline 必须大于当前区块时间，且不超过之后 30 分钟。USDT 多于上限、实际业务 LP 少于下限或过期则拒绝，不会强行使用旧报价。

claimable(user) 在双向绑定正确时读取 Sale.claimableOf(user)：认购份额和已记录奖励份额折算的完整额度，减去 Sale 已结算金额。Sale.consumeClaim(user,expectedAmount) 只允许绑定池调用，消费完整额度并扣减 reservedTokens；Sale 原 claim / claimChecked 不可再领，防止双领。后续新增的认购或已记录奖励可再次结算，并可为新额度重新选择模式。链下未核算或未入账奖励不会自动形成资格。

账务口径：Sale.claimed(user) 与 pool.settled(user) 都记录完整已结算额度；pool.claimed(user) / totalClaimed 只记录实际给用户的 CaBi。totalBurned 统计直接模式的余量销毁，卖税销毁另由代币记账；totalLpTokens 统计送去 LP 的毛额，totalLiquidityMinted 统计业务 mint 返回的 LP，不含另发给 feeTo 的协议费。不要把实际到账与完整结算相加后再次当成剩余额度。

领取保持原子性：限仓、CaBi / USDT 转账错误、余额或授权不足、脏交易对、maxUsdt / minLiquidity / deadline 保护或 mint 失败都会回滚全部调用，包含 Sale 消费、池内统计、直接销毁或卖税、积税兑换及分账、用户 USDT、LP 和储备变化。正常卖税不会被池持仓豁免免除。

### 储备、配置与旧部署

totalAllocated() 等于 Sale.reservedTokens()。withdrawUnused(amount,to) 只允许 owner 提取 poolBalance() 超过全部保留额的未分配部分，不能提走认购待领储备；领取结束仍检查覆盖。Sale.finalize() 不使用领取池资金，已产生的资格继续按池规则与时间领取。transferOwnership(nextOwner) 提名后须由新地址 acceptOwnership() 接受。

网站设置 NEXT_PUBLIC_TOKEN_ADDRESS、NEXT_PUBLIC_USDT_ADDRESS、NEXT_PUBLIC_SALE_ADDRESS 与 NEXT_PUBLIC_CLAIM_POOL_ADDRESS，修改后重建；不使用旧奖励池时，NEXT_PUBLIC_REWARD_POOL_ADDRESS 留空。开放前核验 token()/sale()/usdt()/owner()、Sale.claimPool() 双向绑定、poolBalance()/totalAllocated()/unusedBalance()/claimStartsAt()，并检查固定 50 / 70 比例、lpReceiver 及交易配置。用户页面不展示内部接收地址，后台提供 LP 接收地址管理。

本次仅修改代码与文档，未部署或升级链上合约。历史 Sale 一旦产生过正额度不能直接绑定新池，旧部署没有新接口也不能靠改网站获得双模式。现实现不迁移旧 Sale 或 XBTRewardPool 的资产和义务，不应把历史额度再次导入新池。旧业务继续按原合约结算。

## 历史独立奖励：XBTRewardPool（可选）

constructor(token,usdt,vault)。owner 初始为 msg.sender（部署钱包）；与最终管理员不同时，部署后单独 transferOwnership(finalOwner)。vault 必须为独立普通收款地址或专用 vault，不能填 AMM pair，否则业务转账会触发卖税且不会铸造 LP。owner先approve CaBi并deposit，batchSetClaimable(users,amounts,incremental)只能分配池内可覆盖金额，已领地址不能重新分配。withdrawUnused仅提未分配部分。

用户通过claimChecked(mode,expectedDirectRatio,expectedLpRatio,expectedLpUsdtRatio,expectedVault,expectedBurnRemainder)领取，参数变化则回退。mode0默认50%到账、其余默认黑洞或留池；mode1默认70%到账、30%CaBi和折合认购价30%的USDT转金库。比例可由owner调，范围0到100；不是自动创建LP。每个地址仅领取一次。

## 实物兑换：不走合约

实物兑换不需要兑换合约，也不新增兑换合约。用户按 3500 CaBi / 份直接执行代币合约的 `transfer(收款地址, 应付数量)`：

1. 收款地址由后台「兑换管理」设置，默认黑洞地址，可改为任意项目地址（销毁或归集由运营决定）；修改需二次确认并写入审计日志。
2. 转账确认后，前端锁定「已转账待提交」，再填写收货信息并提交兑换单；同一笔交易哈希只能绑定一张订单。
3. 服务端按代币合约核验：回执成功、至少两次确认、发起钱包 = 用户、调用对象 = 代币合约、`transfer` 参数与 Transfer 事件（from / to / value）与订单一致。
4. 订单状态仅「待发货 / 已发货 / 已完结」，不设链上库存或防抢跑逻辑；库存与发货由运营线下管理。

生产必须持久化 redemption.sqlite，并备份固定 REDEMPTION_DATA_SECRET，详见根 README。历史 XBTRedemption 合约已从本站移除。

## 隔离验证

```sh
npm run test:wallet
npm run test:contracts
npm run test:pancake
npm run test:claim
npm run test:business
```

均为本地合成钱包、测试资产、Ganache、真实V2字节码及临时数据库，不部署主网。源代码和本地测试通过不代表已配置主网或完成独立审计。

---

## 历史网关方案（legacy，保留源码）

以下历史说明只对应 NEXT_PUBLIC_TRADING_MODE=gateway，以及 XBTToken + XBTTradingGateway。其买入精确扣支付额3% USDT，不支持薄饼标准页面直接买入。新业务合约的资金储备/领取保护以前述说明为准。

