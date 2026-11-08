# CaBi 主网代币源码与验证资料

- 网络：BNB Smart Chain，chain ID 56。
- 地址：[0x153211c82ee4e60d96e712e9b3e50368cd91c7b0](https://bscscan.com/address/0x153211c82ee4e60d96e712e9b3e50368cd91c7b0#code)。
- 合约：`CaBiLaunchToken.sol:CaBiLaunchToken`。
- 编译器：`v0.8.24+commit.e11b9ed9`。
- 优化器：开启，200 runs；EVM：`shanghai`；未启用 viaIR；许可证：MIT。
- 创建交易：[0xdb283b14c21095314eb2f809bd3b819e59dd222fedb10525057082aa6b2033f3](https://bscscan.com/tx/0xdb283b14c21095314eb2f809bd3b819e59dd222fedb10525057082aa6b2033f3)。

已通过 [Sourcify 公开验证](https://sourcify.dev/server/v2/contract/56/0x153211c82ee4e60d96e712e9b3e50368cd91c7b0?fields=sources,metadata)：创建代码和运行代码均为 `exact_match`，源码可公开读取。BscScan 同步验证也已生效，其公开 Read Contract 页面返回的 92 项 ABI 与编译器输出完全一致。提交编号、匹配结果及确认时间见 `verification.json` 和 `sourcify-result.json`。

本目录的 `standard-input.json` 保存部署时使用的完整 Solidity Standard JSON Input，包含准确的源码内容、文件名和编译配置，可直接用于区块浏览器验证。Git 可能转换独立 Solidity 文件的换行符，复现元数据哈希时应使用此 JSON 中的源码。

源码入口见 [CaBiLaunchToken.sol](../../../contracts/CaBiLaunchToken.sol)、[CaBiPancakeToken.sol](../../../contracts/CaBiPancakeToken.sol)，同次构建还包含 [CaBiLaunchPool.sol](../../../contracts/CaBiLaunchPool.sol)。源码中已有 MIT SPDX 标记。

- `metadata.json`：编译器输出的元数据与源码哈希。
- `abi.json`：代币 ABI。
- `constructor-arguments.txt`：3 个地址参数的 ABI 编码，不带 0x 前缀。
- `verification.json`：创建字节码核对结果、运行代码哈希、不可变参数、构造参数与验证状态。

构造函数参数依次为：

1. 税款分配地址：`0xFF1d3fCbeCF2F8c282a63e6C1baA9DfF29a68725`。
2. 回购池地址：`0xfE59a342d133CCaaA5A11331dA32f81bc9cCAeFd`。
3. 初始管理员：`0xFF1d3fCbeCF2F8c282a63e6C1baA9DfF29a68725`。

已重新编译部署快照，并确认创建字节码及构造参数与创建交易完全一致；运行代码在编译器列出的不可变参数位置之外完全一致。浏览器源码验证用于公开代码与部署代码之间的对应关系，不代表审计，也不会改变合约权限或业务开关。
