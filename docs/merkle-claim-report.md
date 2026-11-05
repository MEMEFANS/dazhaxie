# CaBi 认购与领取设计说明（Merkle 自领）

本文替代原 `signed-claim-report.md`。结论：认购与领取都不需要服务器私钥，也不需要 EIP-712 签名服务。

## 一、认购：普通 USDT 转账 + 服务端核验

- 前端只发起一笔普通 ERC20 `transfer`：`to` = 后台配置的收款地址，`amount` = 份数 × 50 USDT。不弹 `approve`，不调用任何认购合约。
- 收款地址由后台「认购管理」保存到 SQLite；前端通过 `/api/subscribe/config` 获取，不写死。
- 服务端核验（`src/lib/server/subscription-chain.ts`）：
  1. 交易回执成功；
  2. 至少 2 次确认；
  3. `Transfer` 事件 `from` = 当前钱包、`to` = 当前收款地址、`value` = 份数 × 50 × 10^USDT 精度；
  4. 同一 `txHash` 只能落一单（`subscription_orders.tx_hash` 唯一约束），重复提交返回冲突；
  5. 份数 1–2、软顶 10000、硬顶 20000、每份 35000 CaBi，均在服务端校验。
- 旧 `XBTSale.sol` 的 `approve + transferFrom` 路线不再使用：多一次授权、多一个合约信任面，且当前业务不需要链上认购合约。该文件仅留档。

## 二、领取：owner 发布 Merkle root，用户带 proof 自领

新合约 `contracts/CaBiMerkleClaimPool.sol`：

- 构造参数 `(token, owner)`。代币由 owner 直接转入池子，不需要 deposit 方法。
- owner 用自己的钱包调用 `setMerkleRoot(root, epoch)`。`epoch` 必须严格递增。
- 用户调用 `claim(cumulativeAmount, proof)`：
  - `leaf = keccak256(abi.encode(address, cumulativeAmount, epoch))`；
  - 节点按 bytes32 排序后 `keccak256(a || b)`；
  - `cumulativeAmount` 是当前批次的**累计应得**，合约只发 `cumulativeAmount - claimedOf[user]`；
  - 重复提交相同累计额度 → `AlreadyClaimed`；新批次只补差额。

### 30% LP 如何校验

- 本次差额 `delta` 固定拆分为 `70%` 给用户、`30%` 转入 `lpReceiver`。
- 用户同时支付 `delta × 50 × 30% ÷ 35000` 的 USDT（按 USDT 精度换算），转入同一 `lpReceiver`。
- `lpReceiver` / `usdt` 未配置 → revert；USDT 余额或授权不足 → `LpPaymentFailed`；池余额不足 → `InsufficientPoolBalance`；全部整笔回滚，不存在「不组 LP 领 50%」路径。
- 领取前 `previewClaim(user, cumulativeAmount)` 返回 `(delta, payout, lpTokens, usdtRequired)`，前端用于展示与二次确认。

## 三、链上/链下分工

| 环节 | 执行方 | 是否需要私钥 |
| --- | --- | --- |
| 认购 USDT 转账 | 用户钱包 | 否（用户自己签） |
| 认购回执核验、去重 | 服务端 | 否 |
| 聚合每人累计额度、生成 root/proof | 服务端 | 否 |
| 发布 root (`setMerkleRoot`) | owner 钱包 | 是（owner 自己的钱包） |
| 领取 (`claim`) | 用户钱包 | 否（用户自己签） |
| 读取 proof | `/api/claim/proof` | 否 |

Web 服务没有 `CLAIM_SIGNER_PRIVATE_KEY`，也不再保存任何领取授权记录。后台只生成 root、proof 与导出 CSV，owner 在钱包中发交易后回到后台登记 txHash。

## 四、后台操作顺序

1. 部署代币与 `CaBiMerkleClaimPool(token, owner)`。
2. owner 调用 `setUsdt(USDT)`、`setLpReceiver(项目地址)`。
3. owner 直接把足额 CaBi 转入领取池。
4. 后台设置认购收款地址并开放认购。
5. 后台「认购管理 → 领取池」点击「生成 root 与 proof」，拿到 `root / epoch / calldata`，下载 CSV。
6. owner 钱包执行 `setMerkleRoot(root, epoch)`，后台登记交易哈希。
7. 前端 `NEXT_PUBLIC_CLAIM_POOL_ADDRESS` 指向新合约并重新构建。

> 纯链上无法在无服务器的情况下自动聚合「认购 + 直推 + 团队极差」名单，因此 root 由后台计算、owner 钱包发布。这是当前方案里唯一的中心化环节，但它只影响“发哪些额度”，不影响用户资产与领取路径；root 一旦发布即由合约按 Merkle proof 强制执行，服务器无法篡改已发布批次的发放对象。

## 五、验证

```sh
npm run test:claim
npm run test:subscribe
npm run lint
npx tsc --noEmit
npm run build
```

`test:claim` 覆盖：Merkle 树与合约 root 一致、70/30 拆分、USDT 30% 计算、无授权/无余额回滚、重复领取回滚、错误 proof、池余额不足、owner 权限、epoch 单调。
