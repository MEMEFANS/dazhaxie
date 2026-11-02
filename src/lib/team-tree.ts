// 团队关系树与层级差额计算；初始不预填成员或业绩。
// 团队业绩 = 所有下级（无限代）总认购份数，不含本人认购。

// 注：显式 .ts 后缀以便 Node 24 直接运行自测脚本（Turbopack 同样兼容）
import {
  TOKENS_PER_SHARE,
  floorShares,
  round2,
  teamDifferential,
} from "./constants.ts";

export interface TeamNode {
  id: string;
  name: string;
  address: string; // 成员钱包地址（导出结算名单用）
  selfShares: number; // 本人直接认购份数（不计入自己的团队业绩，只计入上级的）
  children: TeamNode[];
}

// 团队业绩 = 所有下级（无限代）总认购份数，不含本人认购
export function teamSharesOf(node: TeamNode): number {
  return round2(
    node.children.reduce((sum, c) => sum + c.selfShares + teamSharesOf(c), 0),
  );
}

// 成员数（不含根节点自己）
export function countMembers(root: TeamNode): number {
  return root.children.reduce((sum, c) => sum + 1 + countMembers(c), 0);
}

// 完整极差：下级本人认购按本档计奖，下级团队按本档与下级档位的正差额计奖。
export function differentialOf(node: TeamNode): number {
  return teamDifferential(
    teamSharesOf(node),
    node.children.map((c) => ({ selfShares: c.selfShares, teamShares: teamSharesOf(c) })),
  );
}

// 未接入团队数据时仅保留当前账户根节点。
export function seedTeamTree(): TeamNode {
  return {
    id: "root",
    name: "我",
    address: "",
    selfShares: 0,
    children: [],
  };
}

// 收集所有节点（先序，含根）
export function flattenTree(root: TeamNode): TeamNode[] {
  return [root, ...root.children.flatMap((c) => flattenTree(c))];
}

// 结算名单：整棵树逐节点计算层级差额，逐人向下取整到整数份，> 0 才导出
// amount 按 35,000 枚/份折算代币（导入奖励池用）
export function settleTeamTree(
  root: TeamNode,
): Array<{ address: string; name: string; shares: number; amount: number }> {
  return flattenTree(root)
    .map((n) => {
      const shares = floorShares(differentialOf(n));
      return { address: n.address, name: n.name, shares, amount: shares * TOKENS_PER_SHARE };
    })
    .filter((r) => r.shares > 0 && r.address);
}

// 结算汇总：名单 + 精确合计（未取整）+ 逐人取整后合计
// 逐人向下取整，取整后合计可能与精确值差不足 1 份/人
export function settleSummary(root: TeamNode): {
  rows: ReturnType<typeof settleTeamTree>;
  exactTotal: number;
  floorTotal: number;
} {
  const rows = settleTeamTree(root);
  const exactTotal = round2(
    flattenTree(root).reduce((sum, n) => sum + differentialOf(n), 0),
  );
  const floorTotal = rows.reduce((sum, r) => sum + r.shares, 0);
  return { rows, exactTotal, floorTotal };
}
