# 网站组 LP 开关

后台入口 `/admin/liquidity`（侧栏“组 LP 管理”）。

- “暂停组 LP 申请”立即停止签发及复用新的 Prepare 授权，不需要钱包签名或 GAS。用户前台在常规刷新时同步，提交组 LP 交易前会再次读取状态。
- “开放组 LP 申请”恢复签发授权，但仅当链上处于允许组 LP 的阶段。未首次开启、网络无法核对、合约已开盘时不允许用这个按钮强行开放。
- 开关不影响认购、已有 LP、原领取时间或已组 LP 用户的 claim。完成交易的回执在暂停后仍可登记。
- 暂停不是链上撤销。已签发的授权到 deadline 前仍可能被直接调用，默认有效期 600 秒，可通过 CLAIM_AUTH_TTL_SECONDS 配置为 60–3600 秒；已发送交易不能撤回。页面显示当前有效期。

当前 CaBiLaunchToken.openLiquidity 是首次开启、不可逆的链上操作，不提供关闭或重开的函数。CaBiLaunchPool 在 isTradingOpen 为 true 后不再允许固定比例 prepareLiquidity。后台显示链上阶段及北京时间，并明确说明此限制；要支持开盘后继续参与或合约级即时暂停，需要单独更改合约方案，不能仅修改网页实现。

状态保存在 operations.sqlite 的 liquidity_access 表，按 chain/token/pool 分开，含 revision 防止旧页面覆盖新设置。已有系统升级时没有记录默认允许网站申请，保留之前的策略；链上限制始终优先。所有设置变更写入后台审计。上线不自动开启合约，也不替用户暂停或开放。

验证：`node scripts/verify-liquidity-access.cjs`、`node scripts/verify-claim-pool-data.cjs`、`node scripts/verify-liquidity-claim-ui.cjs`。所有用合成钱包与本地数据库，不发送真实交易。
