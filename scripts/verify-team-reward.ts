// 团队极差自测：node scripts/verify-team-reward.ts
// 所有模拟成员只存在于本测试；生产 seedTeamTree 保持空树。
import assert from "node:assert/strict";
import {
  TOKENS_PER_SHARE,
  floorShares,
  round2,
  teamDifferential,
  teamRate,
} from "../src/lib/constants.ts";
import {
  countMembers,
  differentialOf,
  flattenTree,
  seedTeamTree,
  settleSummary,
  settleTeamTree,
  teamSharesOf,
  type TeamNode,
} from "../src/lib/team-tree.ts";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, name);
  passed++;
  console.log("✓ " + name);
}
function truth(name: string, value: boolean) {
  check(name, value, true);
}

let nextId = 0;
function node(selfShares = 0, children: TeamNode[] = []): TeamNode {
  const id = ++nextId;
  return {
    id: String(id), name: "fixture-" + id,
    address: "0x" + id.toString(16).padStart(40, "0"),
    selfShares, children,
  };
}
function leaves(count: number, selfShares = 1): TeamNode[] {
  return Array.from({ length: count }, () => node(selfShares));
}
function exactTotal(root: TeamNode): number {
  return round2(flattenTree(root).reduce((sum, current) => sum + differentialOf(current), 0));
}
function assertTelescopes(name: string, root: TeamNode) {
  const theoretical = round2(teamRate(teamSharesOf(root)) * teamSharesOf(root));
  check(name + "：全树未取整奖励等于根档位乘团队业绩", exactTotal(root), theoretical);
  const summary = settleSummary(root);
  truth(name + "：整数结算总份数不超过理论上界", summary.floorTotal <= theoretical);
  truth(name + "：每人的取整余数小于1份", flattenTree(root).every(current => {
    const exact = differentialOf(current);
    return exact >= 0 && round2(exact - floorShares(exact)) < 1;
  }));
}

// 旧 number[] 纯团队调用保持兼容。
check("99份未达标", teamRate(99), 0);
check("100份1%", teamRate(100), 0.01);
check("200份2%", teamRate(200), 0.02);
check("300份仍2%", teamRate(300), 0.02);
check("500份3%", teamRate(500), 0.03);
check("1000份4%", teamRate(1000), 0.04);
check("2000份5%", teamRate(2000), 0.05);
check("空分支没有奖励", teamDifferential(100, []), 0);
check("旧接口100份两条50分支", teamDifferential(100, [50, 50]), 1);
check("旧接口200份两条100分支", teamDifferential(200, [100, 100]), 2);
check("旧接口300份对100份分支差额", teamDifferential(300, [100]), 1);
check("旧接口同档团队差额0", teamDifferential(300, [300]), 0);
check("异常下级高档团队不产生负奖励", teamDifferential(150, [600]), 0);
check("250份旧接口精确2.5份", teamDifferential(250, [120, 130]), 2.5);
check("2.5向下取整2份", floorShares(2.5), 2);

// 用户确认案例：A下三条分支70/70/60共200份，下级各自均未达100份，2%团队奖励全部归A。
check("三条未达标分支合计200份的纯团队奖励4份", teamDifferential(200, [70, 70, 60]), 4);
const belowTierBranches = [node(2, leaves(68)), node(1, leaves(69)), node(1, leaves(59))];
const belowTierParent = node(2, belowTierBranches);
check("A三分支含下级本人合计200份", teamSharesOf(belowTierParent), 200);
check("A达200份取2%档", teamRate(teamSharesOf(belowTierParent)), 0.02);
check("BCD均未达100份取0%档", belowTierBranches.map(child => teamRate(teamSharesOf(child))), [0, 0, 0]);
check("A独得200乘2%=4份团队奖励", differentialOf(belowTierParent), 4);
check("BCD没有团队奖励", belowTierBranches.map(child => differentialOf(child)), [0, 0, 0]);
check("4份团队奖励对应140000CaBi配额", settleTeamTree(belowTierParent).find(row => row.address === belowTierParent.address)?.amount, 140000);
assertTelescopes("A三分支均未达标", belowTierParent);

// 确认口径：直接下级本人认购也必须参与上级的奖励。
const hundredDirect = node(2, leaves(100));
check("100个直推各买1份团队业绩100", teamSharesOf(hundredDirect), 100);
check("100个直推各买1份奖励1份", differentialOf(hundredDirect), 1);
check("本人购买2份不计入自己的团队", teamSharesOf(hundredDirect), 100);
check("100个直推人数", countMembers(hundredDirect), 100);
assertTelescopes("100个直推", hundredDirect);
const fiftyDouble = node(1, leaves(50, 2));
check("50个直推各买2份团队100", teamSharesOf(fiftyDouble), 100);
check("50个直推各买2份奖励1份", differentialOf(fiftyDouble), 1);
assertTelescopes("50个双份直推", fiftyDouble);
const ninetyNine = node(2, leaves(99));
check("99个直推未达门槛", differentialOf(ninetyNine), 0);
check("只有本人认购无团队奖励", differentialOf(node(2)), 0);
check("同档分支本人2份仍奖励0.02", teamDifferential(102, [{ selfShares: 2, teamShares: 100 }]), 0.02);
check("本人按上档计奖不是按差额计奖", teamDifferential(202, [{ selfShares: 2, teamShares: 200 }]), 0.04);

const sameTierChild = node(2, leaves(100));
const sameTierParent = node(1, [sameTierChild]);
check("同档父级团队102", teamSharesOf(sameTierParent), 102);
check("同档子级仍拿其团队1份", differentialOf(sameTierChild), 1);
check("同档父级计下级本人0.02份", differentialOf(sameTierParent), 0.02);
assertTelescopes("同档有本人认购", sameTierParent);

const twoLevel = node(2, [node(1, leaves(100)), node(2, leaves(100))]);
check("两级团队203含两个直接下级本人", teamSharesOf(twoLevel), 203);
check("两级根奖励2.06含本人0.06", differentialOf(twoLevel), 2.06);
check("两级全树奖励4.06", exactTotal(twoLevel), 4.06);
assertTelescopes("两级不同档", twoLevel);

const levelD = node(2, leaves(100, 2));
const levelB = node(1, [levelD, ...leaves(150, 2)]);
const multiLevel = node(2, [levelB, ...leaves(500, 2)]);
check("多级叶子上级团队200", teamSharesOf(levelD), 200);
check("多级中级团队502", teamSharesOf(levelB), 502);
check("多级根团队1503", teamSharesOf(multiLevel), 1503);
check("多级根奖励45.06", differentialOf(multiLevel), 45.06);
check("多级中级奖励11.06", differentialOf(levelB), 11.06);
check("多级全树奖励60.12", exactTotal(multiLevel), 60.12);
assertTelescopes("多级1至4档", multiLevel);
const highestTier = node(2, [multiLevel, ...leaves(500, 2)]);
check("最高档团队2505", teamSharesOf(highestTier), 2505);
check("最高档全树奖励125.25", exactTotal(highestTier), 125.25);
assertTelescopes("多级最高5%", highestTier);

// 验证真实树取整与导出，不再借用生产seed填演示数据。
const quarter = node(2, [node(0, leaves(120)), node(0, leaves(130))]);
check("真实250份树根精确奖励2.5", differentialOf(quarter), 2.5);
const quarterRows = settleTeamTree(quarter);
check("真实250份树根导出2份", quarterRows.find(row => row.address === quarter.address)?.shares, 2);
truth("所有结算枚数=整数份数乘35000", quarterRows.every(row => row.amount === row.shares * TOKENS_PER_SHARE));
truth("导出仅含正整数份数和真实非空地址", quarterRows.every(row => row.address && Number.isInteger(row.shares) && row.shares > 0));
check("导出无重复钱包", new Set(quarterRows.map(row => row.address)).size, quarterRows.length);
assertTelescopes("250份取整", quarter);

// 确定性多层树：所有成员本人认购0至2份，逐棵验证全树望远镜与上界。
let randomState = 20261102;
function random(max: number) {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState % max;
}
for (const size of [99, 100, 200, 500, 1000, 2500]) {
  const root = node(2);
  const nodes = [root];
  for (let i = 0; i < size; i++) {
    const child = node(random(3));
    nodes[random(nodes.length)].children.push(child);
    nodes.push(child);
  }
  assertTelescopes("确定性" + size + "成员树", root);
  truth("确定性" + size + "成员树每个子树均满足望远镜", nodes.every(current =>
    exactTotal(current) === round2(teamRate(teamSharesOf(current)) * teamSharesOf(current))));
}

const empty = seedTeamTree();
check("生产初始树保持空成员", empty.children, []);
check("生产初始树不填认购和钱包", [empty.selfShares, empty.address], [0, ""]);
check("生产初始团队份数0", teamSharesOf(empty), 0);
check("生产初始奖励0", differentialOf(empty), 0);
check("生产初始没有结算名单", settleTeamTree(empty), []);
check("生产初始汇总0", settleSummary(empty), { rows: [], exactTotal: 0, floorTotal: 0 });
const independentSeed = seedTeamTree();
empty.children.push(node(2));
check("修改一棵测试树不回填生产默认", seedTeamTree(), independentSeed);
console.log("全部 " + passed + " 项断言通过");
