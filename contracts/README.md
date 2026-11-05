# 当前部署请先阅读

分阶段发行新版本 `CaBiLaunchToken.sol` 和 `CaBiLaunchPool.sol` 的规则、构建、测试和部署步骤见 [LAUNCH.md](LAUNCH.md)。支持先实际组 LP，再按管理员预先设定的时间领取和开放交易；尚未部署或切换网站。下文保留现有及历史合约说明。

正式薄饼方案与新版业务合约的完整说明见 [DEPLOYMENT.md](./DEPLOYMENT.md)。下文保留的是历史 XBTToken + 网关方案，不支持薄饼直接买入，请勿混用合约或费率口径。

**当前业务架构（2026-11 起）**：认购改为用户直接向后台配置的收款地址转 USDT，由服务器核验记账，**不再部署或调用认购合约**。奖励额度按认购单 + 直推 + 团队极差由服务器计算，生成 Merkle root 与每人 proof；owner 用自己的钱包调用 `setMerkleRoot(root, epoch)` 发布到独立领取池 `CaBiMerkleClaimPool(token, owner)`，用户带 proof 调用 `claim` 自领（30% USDT 组 LP / 70% 到账）。`XBTSale.sol`、`CaBiClaimPool.sol`、`CaBiSimpleClaimPool.sol` 与旧 EIP-712 签名方案仅留档，不得部署、不得被前端引用。Web 服务不持有任何私钥。

---

# CaBi 代币与交易手续费

代币名称和符号均为 `CaBi`，精度 18 位，总量 10 亿枚。历史文件及 Solidity 合约标识仍使用 `XBTToken`，不影响链上名称。

## 实际资金流向

本实现使用一个明确配置的 V2 风格 CaBi/USDT 交易对。

| 操作 | 规则 | 示例 |
| --- | --- | --- |
| 买入 | 先收取支付总额的 3% USDT，分给两个收款地址，默认分别为买入总额的 2% 和 1%；其余 97% 交给 DEX 兑换 CaBi | 支付 100 USDT，地址一收 2 USDT、地址二收 1 USDT，97 USDT 参与兑换 |
| 卖出 | 从卖出总数量中扣 3% CaBi，直接转入 `0x000000000000000000000000000000000000dEaD`；97% CaBi 进入交易对 | 卖出 100 CaBi，3 CaBi 进黑洞、97 CaBi 参与兑换 |
| 钱包转账 | 不收交易手续费 | 转账 100 CaBi，收款方收到 100 CaBi |
| 网关加减流动性 | 不收买卖交易手续费 | 使用网关的 `addLiquidity` / `removeLiquidity` |

3% 均按资产最小单位向下取整。USDT 小数位不会改变比例；支持正常、无转账税的 USDT。DEX 自身的流动性提供者手续费、价格变化和链上 gas 另行计算。

`dividendReceiver1` 和 `dividendReceiver2` 接收的是 USDT 买入手续费。这是两个地址之间的手续费分账，没有在这里实现按持币量向持币人自动分红。

## 合约职责

- `XBTToken.sol`：部署时将全部 10 亿枚一次性发至部署钱包，持币人自行决定后续分配；合约不设分配比例、自动锁仓或专用注资入口。在转入已配置交易对时收取固定 3% CaBi 卖税；买入输出必须由正在执行买入操作的网关接收。持币人手动 `burn()` 也将 CaBi 转入黑洞，发行总量保持不变。
- `XBTTradingGateway.sol`：收取 3% USDT 买税并在两个地址之间分账，将剩余 USDT 兑换 CaBi；提供支持卖税的卖出及加减流动性入口。USDT、DEX Router 和交易对在部署时固定，两个收款地址及其分配比例由网关管理员调整。
- `XBTSale.sol` / `XBTRewardPool.sol`：继续处理原有认购和奖励规则；本次交易手续费不额外从认购款或奖励领取中扣除。

## 双地址手续费分账

网关默认配置为地址一收买入总额的 **2%**、地址二收 **1%**。买入总手续费固定为 **3%**，管理员可调整的是这 3% 内部的分配比例。

网关 `owner` 由构造参数 `ownerAddress` 明确指定，可以与 CaBi 代币合约的 owner 不同。以下管理方法由网关 owner 调用：

| 方法 | 作用 | 示例 |
| --- | --- | --- |
| `setDividendReceivers(receiver1, receiver2)` | 设置两个手续费收款地址 | 填入实际使用的两个收款地址 |
| `setDividendRates(rate1Bps, rate2Bps)` | 调整两个地址占买入总额的比例，两项合计必须为 300 | `(200, 100)` 为 2% / 1%；`(100, 200)` 为 1% / 2% |
| `transferOwnership(newOwner)` | 将网关管理权限立即转给非零地址 | 新 owner 后续设置网关的收款地址和比例 |

比例以基点（BPS）表示：`100` = 1%，`200` = 2%，`300` = 3%。允许 `(0, 300)` 或 `(300, 0)`，即将全部 3% 手续费分给其中一个地址。可通过 `dividendReceiver1()`、`dividendReceiver2()`、`dividendRate1Bps()`、`dividendRate2Bps()` 查询当前配置。

更新收款地址或比例后，后续买入使用新配置，已转出的 USDT 不受影响。转移网关 owner 只转移网关管理权限，不会转移 CaBi 代币合约的 owner 或任何钱包中的代币。

`previewBuy(grossUsdt)` 返回总手续费和参与兑换的 USDT；`previewDividendSplit(grossUsdt)` 返回两个地址各自可收到的手续费。计算按 USDT 最小单位进行：总手续费为 `floor(grossUsdt * 300 / 10000)`，地址一收取 `floor(grossUsdt * dividendRate1Bps / 10000)`，地址二收取总手续费减去地址一的金额。取整余数计入地址二，两个地址合计始终等于总手续费，不因拆分产生额外费用或网关残留。

## 单地址持仓上限

普通地址默认最多持有 **200,000 枚 CaBi**。转账、授权转账、买入到账和认购/奖励发放统一由代币合约检查接收后的余额。

owner 可通过 `setMaxWalletAmount(amount)` 调整上限，`maxWalletAmount()` 返回当前值。参数使用 18 位精度的最小单位，范围为大于 0 且不超过总供应量。例如改为 30 万枚：

```solidity
setMaxWalletAmount(300000000000000000000000);
```

降低上限不会扣回已有余额；高于新上限的地址仍可卖出或转出代币，接收方仍需符合当前额度。自己向自己转账不增加持仓。

部署钱包、代币合约自身和黑洞地址默认豁免；配置交易入口时，交易对和网关自动豁免。owner 可通过 `setMaxWalletExempt(account, true)` 为认购、奖励等资金池或其他分配地址设置持仓豁免，通过 `isMaxWalletExempt(account)` 查询；自定义豁免可传入 `false` 撤销。代币合约、黑洞、已配置交易对和网关的系统豁免保持有效。需要接收超过当前额度的认购或奖励资金池，应先设置豁免，再转入代币。资金池持仓豁免不免除普通收款人的持仓上限，也不免除卖出手续费。

## 部署和配置顺序

1. 部署无参数的 `XBTToken()`。全部 10 亿枚到账部署钱包；后续按实际需要使用普通 `transfer` 向各钱包或认购合约分配，数量和比例由持币人自行决定。
2. 在选定 V2 Factory 创建 CaBi/USDT 交易对。所选 Router 必须使用同一个 Factory，并支持 `swapExactTokensForTokensSupportingFeeOnTransferTokens`。
3. 部署 `XBTTradingGateway(xbtAddress, usdtAddress, dexRouterAddress, dividendReceiver1, dividendReceiver2, ownerAddress)`，六个地址参数都必须是真实部署配置。最后一个参数指定网关管理员，两个收款地址默认分别获得买入总额的 2% 和 1%。网关从 Router 的 Factory 查询已创建的交易对。
4. 由 CaBi owner 调用一次 `configureTrading(gatewayAddress)`。该配置不能重新指定到其他网关、交易对或 USDT。
5. 流动性提供者分别授权网关使用 CaBi 和 USDT，再通过网关添加初始流动性。
6. 如需启用认购或奖励服务，部署相应合约；资金池若需接收超过持仓上限的代币，先由 owner 设置持仓豁免，再手动转入所需代币；不存在固定 70% 分配或只能执行一次的空投池注资函数。不要把 LP/金库接收钱包与 AMM 交易对地址混为一谈。

已部署的 BSC 测试网 CaBi 地址为 `0x7C877a6AE2b94622c0455AA5Bc5eB4ba03798E66`。该代币尚未绑定交易网关时，可以直接部署并绑定新版双地址网关，无需重新发行代币。本次只修改源码，没有部署或绑定新版网关；后续部署仍需提供实际的两个收款地址、USDT、Router、交易对和网关管理员配置。

## 调用入口

| 方法 | 授权资产 | 参数 |
| --- | --- | --- |
| `buy` | 用户先对网关授权 USDT | `grossUsdt, minXbtOut, recipient, deadline` |
| `sell` | 用户先对网关授权 CaBi | `grossXbt, minUsdtOut, recipient, deadline` |
| `addLiquidity` | CaBi、USDT | `xbtDesired, usdtDesired, xbtMin, usdtMin, recipient, deadline` |
| `removeLiquidity` | LP token | `liquidity, xbtMin, usdtMin, recipient, deadline` |

数量使用合约最小单位；`deadline` 为 Unix 秒时间戳。最小收款量需结合当时价格和允许滑点设置。

## 兼容范围

为了直接收取准确的 USDT 买税，买入已配置交易对必须调用网关。标准 DEX 页面的直接买入和其他直接以用户地址接收 CaBi 的路由不支持。卖出也可以使用支持转账税的标准 V2 Router；加减流动性应使用网关，直接向交易对转入 CaBi 会按卖出收取 3%。

该规则覆盖配置的 CaBi/USDT 交易对，不自动覆盖第三方创建的其他池子，不支持任意多跳买入路径或 V3 池。

## 本地验证

```sh
npm ci
npm run test:contracts
```

测试只使用进程内的本地链、合成账户和测试资产，并通过真实 V2 Factory/Router/Pair 字节码执行正常买卖和流动性操作。测试 USDT 位于 `contracts/test/`，不属于生产部署合约。

本次修改的是项目源码；前端仍保持“待接入”，双地址分账需要在新版网关实际部署并绑定后才会生效。
