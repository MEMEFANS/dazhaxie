# 签名自领改造报告

## 一句话结论

认购仍由「USDT 转账 + 服务器记账」完成；领取改为 **服务器按认购单 + 直推 + 极差聚合额度 → 用仅有签名权限的 `CLAIM_SIGNER` 签发 EIP-712 一次性授权 → 用户自己调用 `CaBiSignedClaimPool.claim` 领币**。owner 私钥不进入 Web 进程，signer 私钥不能转走池内资金。业务数值不变：单价 50 USDT、每份 35000 CaBi、单账户 1–2 份、硬顶 20000、兑换 3500、单次兑换 20 份、领取 50%/70% + 30% LP + 30% USDT。

## 领取流程

1. 用户在 DApp 连接钱包并完成一次社群签名登录（复用 `challenge/verifyMessage` 会话）。
2. 领取卡请求 `GET /api/claim/authorization`：返回签名服务状态与「本次可领额度」。
3. 用户选择 50%（mode 0）或 70%（mode 1），页面用链上 `previewClaim(amount, mode)` 展示到账、销毁/入 LP 数量、需另付的 USDT。
4. 二次确认后 `POST /api/claim/authorization`（body `{ mode }`）：服务器重新聚合额度、读取链上 `claimedOf` 与本地回执，按需签发或复用一张未过期授权，返回 `{ amount, nonce, deadline, mode, signature, claimPool, signer }`。
5. 前端调用 `claim(amount, nonce, deadline, mode, signature)`；mode 1 先对 USDT 做精确授权（合约再从用户扣 30% 等值到 LP 地址）。
6. 交易成功后前端把交易哈希回执登记到 `POST /api/claim/authorization`（`action: "receipt"`），服务器校验链上 `Claimed` 事件后落库；随后刷新额度与链上状态。下一次领取会得到新的 `amount` 与新的 nonce。

## 签名摘要包含哪些字段、为什么

EIP-712 domain：`name = "CaBiSignedClaimPool"`、`version = "1"`、`chainId`、`verifyingContract = 领取池地址`。

Claim 结构：`user`、`amount`、`nonce`、`deadline`、`mode`。

| 字段 | 作用 |
| --- | --- |
| `chainId` + `verifyingContract` | 防止签名被跨链或跨合约重放；换链部署后旧签名自动失效 |
| `user` | 授权只属于该地址，别人拿到签名也无法领取 |
| `amount` | 链上按此金额结算，篡改金额会导致签名恢复出错误地址而回滚 |
| `nonce` | 每个地址单调递增、链上一次性使用，防止同一授权被重复提交 |
| `deadline` | 限时授权（默认 10 分钟，可配 60–3600 秒），降低泄露窗口 |
| `mode` | 50% 与 70% 分支的结算参数不同，绑定 mode 后不能靠改参数绕过 |

合约同时保存 `claimDigest(...)` 只读方法，用于和 viem 的标准 typed-data 哈希逐位比对（测试已验证一致）。

## 防超发与防重放怎么做的

防超发（多层）：

- 额度 = `认购单 + 直推奖励 + 极差结算` 聚合值，减去 `max(链上 claimedOf, 本地已登记领取)`；链上读取失败时 fail closed，不签发。
- 服务端签发前会核对「链上 signer == 当前私钥地址」，不一致直接拒绝，避免把无效签名发出去。
- 链上 `claimedOf` 累计，`nonceUsed` 在验签通过后立刻置位，`amount`、`deadline`、池余额都在同一笔交易内校验，失败整体回滚，不会消耗 nonce 或留下已领记录。
- 同一地址的授权 `nonce` 单调递增并落库，`(chain_id, address, nonce)` 有唯一约束；重复请求在额度与 mode 未变化时返回同一张未使用签名，不重复生成。
- 同一地址每分钟最多签发 N 次（默认 5，可配），避免刷签名。
- 可选兜底：owner 可对单个地址设置累计 `claimLimit`（0 表示不限制），链上强制 `claimed + amount <= limit`。
- signer 与 owner 权限分离：signer 只能验签放行，`deposit` / `withdrawUnused` / `setSigner` / 比例 / `setClaimLimit` 全部 `onlyOwner`。

防重放：

- EIP-712 绑定 `chainId` 与领取池地址；
- 链上 `mapping(address => mapping(uint256 => bool)) nonceUsed` 一次性；
- `deadline >= block.timestamp`；
- 拒绝 high-s 可锻造签名（同一授权不会出现两个“有效”签名）；
- 换 signer 后，旧 key 签出的所有未领取授权立即失效（验签对象变成新地址）。

## 改动清单

- 新增 [CaBiSignedClaimPool.sol](file:///c:/Users/Administrator/Desktop/daxhaxie/contracts/CaBiSignedClaimPool.sol)：`(token, signer, owner)` 构造、EIP-712 验签、`claim(amount, nonce, deadline, mode, signature)`、`deposit`/`withdrawUnused`/`setSigner`/`setLpReceiver`/`setUsdt`/`setRatios`/`setClaimLimit`、只读 `nonceUsed`/`previewClaim`/`poolBalance`/`allocatedUnclaimed`/`totalClaimed`/`totalBurned`/`claimedOf`。旧 `CaBiSimpleClaimPool` 仅留档，前端不再引用。
- [subscription-db.ts](file:///c:/Users/Administrator/Desktop/daxhaxie/src/lib/server/subscription-db.ts)：新增 `claim_authorizations` 表（地址、nonce、金额、mode、deadline、签名、状态、回执哈希），提供 nonce 递增、重复请求复用、本地已领汇总、回执登记、额度列表。
- 新增 [claim-auth.ts](file:///c:/Users/Administrator/Desktop/daxhaxie/src/lib/server/claim-auth.ts)：私钥只在本模块内使用；额度聚合、链上状态读取、签发/复用、回执核验、后台总览、交接 calldata。缺失密钥时返回 503「未配置签名服务」。
- 新增 [授权接口](file:///c:/Users/Administrator/Desktop/daxhaxie/src/app/api/claim/authorization/route.ts)：GET 返回签名服务状态与可领额度；POST 签发授权或登记回执。
- 新增 [后台领取池接口](file:///c:/Users/Administrator/Desktop/daxhaxie/src/app/api/admin/claim-pool/route.ts)：GET 返回池余额、已领取、已销毁、待领聚合列表、签名服务与链上 signer；POST `action=handover` 只生成 `setSigner` calldata 并写审计。
- [claim-pool-data.ts](file:///c:/Users/Administrator/Desktop/daxhaxie/src/lib/claim-pool-data.ts) 切换到新 ABI：额度来自服务器，预览用 `previewClaim(amount, mode)`，并新增 `requestClaimAuthorization` / `submitClaimReceipt`。
- [simple-claim-card.tsx](file:///c:/Users/Administrator/Desktop/daxhaxie/src/components/dapp/token/simple-claim-card.tsx)：显示服务器可领额度 → 选 50%/70% → 二次确认 → 请求签名 → `claim(...)` → TxStatus；未配置签名服务时按钮禁用并给出原因；未登录时先提示签名登录；成功后回执、刷新额度。
- [subscribe-admin.tsx](file:///c:/Users/Administrator/Desktop/daxhaxie/src/components/admin/subscribe-admin.tsx)：新增「领取池（签名自领）」卡片（池余额、已分配未领、已领取、已销毁、签名服务状态、链上/服务器 signer、自动聚合的每人待领额度）与「权限交接」入口（二次确认 + 审计）。旧批量写入卡片仅在链上仍是旧版简单池时显示，并标注为备用方案。
- [.env.example](file:///c:/Users/Administrator/Desktop/daxhaxie/.env.example)：新增 `CLAIM_SIGNER_PRIVATE_KEY`、`CLAIM_AUTH_TTL_SECONDS`、`CLAIM_AUTH_RATE_LIMIT` 说明，明确“只签名、非 owner、不要写成 NEXT_PUBLIC_”。
- [push-claimable.cjs](file:///c:/Users/Administrator/Desktop/daxhaxie/scripts/push-claimable.cjs)：文件头标注为旧版简单池的备用方案（不进 Web 进程、私钥只从命令行环境变量读取）。
- 测试新增 [verify-signed-claim-pool.cjs](file:///c:/Users/Administrator/Desktop/daxhaxie/scripts/verify-signed-claim-pool.cjs)，并更新 [verify-claim-pool-data.cjs](file:///c:/Users/Administrator/Desktop/daxhaxie/scripts/verify-claim-pool-data.cjs) 与 [verify-subscribe-admin.cjs](file:///c:/Users/Administrator/Desktop/daxhaxie/scripts/verify-subscribe-admin.cjs)；`test:claim` 已纳入新合约测试。

## 部署顺序（含 signer 密钥怎么放）

1. 生成 signer 密钥（离线或专用机器）：
   `node -e "const {generatePrivateKey}=require('viem/accounts');console.log(generatePrivateKey())"`
   该私钥**只**写入服务器密钥管理（`CLAIM_SIGNER_PRIVATE_KEY`），不是 owner，不要放进 Git、日志、`.env.local` 之外的公开位置。
2. 用 owner 钱包部署 `CaBiSignedClaimPool(token, signer, owner)`，其中 `signer` 为上一步地址，`owner` 为多签/硬件钱包。
3. 由 owner 调用 `setUsdt(USDT)`、`setLpReceiver(LP 地址)`（`setUsdt` 会读取并记录 USDT decimals）。
4. 由 owner 先 `USDT/CaBi.approve(pool, amount)` 再 `pool.deposit(amount)` 存入领取储备；`withdrawUnused` 只能取回未被 `claimLimit` 预留的未分配余额。
5. 若 CaBi 代币有持仓上限，把领取池与 LP 接收地址加入豁免名单，避免用户领取时触发 maxWallet 限制。
6. 配置环境变量并重启：`NEXT_PUBLIC_CLAIM_POOL_ADDRESS`、`CLAIM_SIGNER_PRIVATE_KEY`、可选 `CLAIM_AUTH_TTL_SECONDS` / `CLAIM_AUTH_RATE_LIMIT`。
7. 打开后台「认购管理 → 领取池」核对：服务器 signer 与链上 signer 一致、签名服务“已配置”、池余额充足。
8. 换 signer：后台「权限交接」提交新地址（写审计并生成 calldata）→ owner 钱包执行 `setSigner` → 更新服务器密钥并重启。切换后旧 key 的未领取授权全部失效。

## 未做与原因

- **未在 Web 进程内发送 `setSigner` / `deposit`**：owner 私钥不能进 Web 服务，后台只生成 calldata 与审计，由 owner 钱包执行。
- **未保留签名自领池的批量写入**：该合约没有 `batchSetClaimable`；`scripts/push-claimable.cjs` 仅作为旧版 `CaBiSimpleClaimPool` 的备用回退。
- **`allocatedUnclaimed` 在签名模式通常为 0**：签名模式没有链上预分配，真实“已分配未领”由服务器聚合（后台页面展示的是 `应得 − 链上已领`）；链上保留可选 `claimLimit` 作为风控兜底。
- **未做定时链上对账任务**：每次签发都实时读 `claimedOf`，加上领取回执落库，已能覆盖超发风险；后续可按需再加批处理对账。
- **未实现按份数拆分领取**：业务上每次领取消费整份服务器授权额度（50% 销毁或留池 / 70% 入 LP），与旧规则的结算口径一致。
- 旧 `XBTSale` 与旧领取池文件仅留档，未被前端或服务端读取。

## 检查结果

- `npx tsc --noEmit`：exit 0
- `npm run lint`：exit 0
- `npm run build`：exit 0
- `npm run test:business`（含 `test:team` / `test:referral` / `test:claim`）：exit 0
- `scripts/verify-signed-claim-pool.cjs`：36 项通过（6 位与 18 位 USDT 各一轮），覆盖正确签名可领、过期拒绝、nonce 复用拒绝、篡改金额拒绝、跨钱包使用拒绝、超 `claimLimit` 拒绝、mode 0/1 分支、USDT 不足整体回滚且不消耗 nonce、非 owner 调管理接口拒绝、signer 不可动资金、换 signer 后旧签名失效、两步 owner、事件覆盖
- 字节码：deployed 7781 bytes（< EIP-170 24576）
- 本地 `GET /api/claim/authorization` 返回 `configured: false`（当前 `.env.local` 未配置 `CLAIM_SIGNER_PRIVATE_KEY`），前端据此禁用按钮并提示；`GET /api/admin/claim-pool` 未登录返回 401
- dev 已重启，首页 HTTP 200
