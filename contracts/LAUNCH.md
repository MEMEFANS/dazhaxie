# CaBi 分阶段发行合约

本方案使用新部署的 `CaBiLaunchToken` 和 `CaBiLaunchPool`，实现「真实组 LP → 定时领取 → 定时开放交易」。旧链上代币不可升级，修改源码不会改变旧地址。这里是已实现的合约和本地部署产物，尚未部署主网、切换网站或迁移资产。

## 用户确认的规则

- 名称、符号 CaBi，18 位精度，固定发行 10 亿枚，全部初始发给 owner；无增发。
- 初始价格固定为 700 CaBi / USDT。管理员示例初始池为 15,000 USDT＋10,500,000 CaBi。
- 每份 35,000 CaBi 额度拆为 24,500 CaBi 待领，以及 10,500 CaBi 配套用户支付的 15 USDT，实际进入唯一绑定的 V2 池并 mint LP。
- 组 LP 阶段没有买入白名单；普通买卖和持币人转账统一暂停。owner 可以直接划拨初始资金，不能通过普通 Router 买卖。未开放交易前，其它池也不能从本代币取得普通买入输出。
- 领取时间与交易时间分别设置，交易时间不得早于领取时间。可以设为同一时间。开始组 LP 后时间锁定，不能延后，时间到自动开放，无需管理员补发开盘交易。
- 专用合约实际执行的加池和退出免交易税；组 LP 阶段不进行税币兑换或池内销毁。普通用户不能借这些入口进行兑换。
- 领取时不再次收 USDT，不再次组 LP。额度较大可以 `claimPartial` 分次领取；原有 20 万 CaBi 持仓上限仍适用，领取后至正式交易开放前不能普通转出。
- 公开交易开始后保留原有买 3%、卖 3%、买税兑换 USDT 后 50/50 分配、持仓上限和每 8 小时池内 CaBi 销毁 1%。池内销毁从正式交易时间开始计时，首次最早在开盘 8 小时后执行，仍需有人发送交易。
- 没有开盘后暂停按钮，也不提供可增删的交易白名单。owner 原有的持仓上限、豁免、税款地址和兑换参数管理权保留。

## 阶段与退出规则

| 阶段 | 组 LP | 用户领取 | 普通转账与买卖 | 退出 |
| --- | --- | --- | --- | --- |
| Setup | 未开始 | 关闭 | 关闭，owner 可划拨资金 | 不适用 |
| Liquidity | 管理员先建初始池，用户再按额度加池 | 关闭 | 关闭 | 用户可以撤销自己的全部准备额度 |
| Claims | 正式交易前仍可按原比例准备，随即具备领取资格 | 开放，70% 到账 | 关闭 | 准备额度已承诺，不再撤销 |
| Trading | 本轮固定金额准备结束 | 已准备的额度继续可领 | 自动开放 | 正常 DEX 流动性规则 |

用户生成的 LP 在开放领取前由 `CaBiLaunchPool` 临时保管，按用户记录 `lpOf`。用户此时可以调用 `cancelPreparation(minUsdtOut, deadline)`：真实销毁自己的 LP，退还实际 USDT 输出，配对的 CaBi 回到储备，待领资格清零。USDT 输出有整数舍入，用户需确认最少退款金额。旧 nonce 保持已使用，重新参与需新凭证。

开放领取后，任何人都可以调用 `releaseProjectLp()`，把已承诺的 LP 发给构造时确定的项目 `lpReceiver`。这不是把最终 LP 发给用户，也不宣称项目 LP 永久锁仓。项目钱包和 LP 归属在用户付款前必须展示。领取前各用户的 70% 已准备额度作为 `reservedPayout` 保留，owner 的 `withdrawUnused` 不能提取这部分。

初始 LP 发给出资的 owner。开放领取前，只有全部用户准备额度都已撤销时，owner 才能通过 `removeSeedLiquidity` 包装入口撤出初始 LP。普通 Router 在公开交易前不能撤池；开盘后普通撤池按原代币的池输出税处理。

## 固定金额的范围

合约按每份 10,500 CaBi＋15 USDT 计算，向上舍入到最小 USDT 单位，并在每次真实 mint/burn 前后检查余额、储备和参考比例。比例允许的误差仅为整数舍入：一最小 USDT 单位，或储备参考值的 1e-8，取较大者。它不会把明显不匹配的资产按固定数额送入池子。

这只适用于正式交易前的固定价格阶段。交易开放后，市场价格和储备会变化，本轮固定价格准备入口关闭。池子余额或比例与配置不一致时需核对资产状态，不能把额外转入池子的资金自动当作本次用户出资。

## 额度凭证

沿用服务器自动核验认购和奖励额度的职责，但新池使用新的凭证格式。无需用户持有配对的 30% CaBi：这部分来自预先注入新池的储备。

- EIP-712 domain：`name=CaBiLaunchPool`，`version=1`，实际 chainId 与新池地址。
- 类型：`Prepare(address user,uint256 amount,uint256 cumulativeLimit,uint256 nonce,uint256 deadline)`。
- `amount` 是本次完整领取额度，尚未拆分 70/30；`cumulativeLimit` 是累计应得完整额度。
- 用户入口：`prepareLiquidity((amount,cumulativeLimit,nonce,deadline), signature, maxUsdt, minLiquidity)`。
- 已准备额度包含已领取部分；准备校验为 `旧池已领 + preparedOf + 本次额度 <= cumulativeLimit`。
- 领取入口：`claim()` 领取剩余准备额度，或 `claimPartial(完整额度)` 分次领取；不需要再次签发凭证或再次授权 USDT。
- `claimedOf` 返回旧池已领＋新池已领的完整额度，用于服务端累计结算；`payoutAvailable` 是实际待到账 CaBi。
- `totalLpTokens`、`totalUsdtCharged` 是历史成功准备的累计投入，包含后来撤销的准备；撤销记录以事件和当前 `preparedOf/lpOf` 为准。

本分支没有把新的 Prepare 凭证接到现有网站，现有签名池或 Merkle 池的凭证都不能直接用于本合约。上线必须同时完成服务端、前端的新入口与地址切换，不能只替换环境变量里的领取池地址。

## 构建与本地验证

```powershell
npm run build:launch-contracts
npm run test:launch
```

`output/launch-contracts/` 包含两份 ABI/bytecode、完整 standard JSON 源码与编译器版本，可用于部署和 BscScan 源码验证。优化设置为 200 runs，EVM Shanghai；编译器版本以生成的 manifest 为准。测试仅使用本地 Ganache 合成账户、6/18 位测试 USDT 和真实 V2 Factory/Router/Pair 字节码，不读取私钥文件或调用公共 RPC。

## 主网部署顺序

公开地址模板见 `deploy/launch-mainnet.template.json`。领取与交易时间当前留空，由管理员确定，部署工具不得自行填入并开启。

1. 部署 `CaBiLaunchToken(distributionReceiver,buybackPool,owner)`。核对供应量与三个公开地址。
2. 在 PancakeSwap V2 Factory 为新代币和 BSC USDT 创建 pair。调用新代币 `configureTrading(router,usdt,pair)`，必须在任何初始加池之前完成。
3. 部署 `CaBiLaunchPool(newToken,signer,lpReceiver,previousPool)`。领取池无 owner 私钥，只认代币当前 owner 管理；lpReceiver、token、USDT、pair 和 previousPool 均固定。
4. 新代币 owner 调用 `configureLaunchPool(newPool)`，只允许配置一次，同时设置新池持仓豁免。
5. 若迁移旧签名池，暂停旧网站签发，先备份认购、奖励与回执数据。由旧池 owner 调用旧池 `setSigner(newPool)`，使旧签名不再可用；随后核对并提取旧池全部可用余额。新池在准备和领取时检查旧池已退役且余额为零；不能再把旧池恢复为有效 signer。`claimedOf` 承接旧池已领记录，不能清零重发。
6. **旧代币和新代币是不同资产**。提取旧池的旧币不会自动给新池充值；需由 owner 从新币供应量向新池转入对应储备，例如 7 亿枚新 CaBi。新币的发行及旧币兑换安排需在正式切换前明确。
7. owner 调用 `scheduleLaunch(claimAt,tradingAt)` 设置未来时间，再调用 `openLiquidity()`，锁定时间。先核对日期及时区；开始后不能修改。
8. owner 对新池分别授权初始 CaBi 和 USDT。先读 `previewSeed(10500000e18)`，核对 15,000 USDT 和预估 LP，设置合理 `minLiquidity` 与交易 deadline，再调用 `seedLiquidity`。确认初始 LP 接收地址为 owner。
9. 接入网站：先申请新 Prepare 凭证，再精确授权本次 USDT，调用 `prepareLiquidity`。必须显示 70% 待领、30% 配对、LP 最终归项目、退出截止、领取和交易时间。余额或授权不足时由交易流程提示，不重复收费。
10. 读取链上阶段和准备记录，验证小额真实流程后再开放网站参与。正式交易前不得继续运行旧的池销毁 keeper；新币池销毁需等开盘 8 小时后才可执行。

这些步骤涉及新币发行、资金迁移和真实 GAS，必须由相应管理员插件钱包确认交易。构建脚本只生成可审阅产物，不广播交易。
