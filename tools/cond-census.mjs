// 判据的前置条件：哪些套件跑过的项数比它写下的断言少。
//
// 为什么要这一份：一条判据被 if 包住时，前提不成立它就不跑，而总数只报跑过的那些。
// 于是「26 项通过、1 项不通过」与「32 项通过」在只看总数的眼睛里是一样的 ——
// 2026-11-06 的 arm 就是这样：那条不通过把后面五条判据一起藏了，而它们从来没有
// 在 Windows 上过过。数字的差别不在总数，在前提。
//
// 用法（两步，因为它要有实跑的数字）：
//
//   node tools/check-all.mjs > <日志>
//   node tools/cond-census.mjs <日志>
//
// 读的两件东西：套件表来自 tools/check-all.mjs 的 SUITES（那是唯一的真相），
// 实跑项数来自日志里每个套件那一行的 passed 与 failed。
//
// 差额不等于「被藏起来的判据」，这一点要说清，否则这份工具会骗人。
// 2026-11-06 把九个候选逐个读了一遍，差额有三种成因，只有第三种是真问题：
//
//   · 互斥的两支：if A { ok(…) } else { ok(…) } —— 永远只跑一支，
//     而判据的逻辑总数就是一支。静态计数把两支都数了。
//   · 守卫分支：if (取不到) { ok(…, false) } —— 正常情况不该跑，
//     它存在的意义是「出事时别沉默」。平台分支（arm 的 armclang 那一支）
//     与环境开关（deflate 的 HMYR_HEAVY）也归这一类。
//   · 回调里可能不执行：ok 挂在某个事件回调上，而主流程先 resolve 了。
//     pipe 那一条就是这样 —— 「hymr 退出码是 0」一次都没跑，
//     而总数里只看得出少了一项。这一种是真的少验了一件。
//
//   · 样本源码写在字符串里（2026-11-07 核出来的第四种）：静态计数用的是
//     /(ok|检查|判)\(/，于是「检查器的检查」这一类套件把样本写进字符串时，
//     字符串里的 ok( 也被数成了断言。racecensus 是现成的例子：静态 11、
//     实跑 5，那 6 条差全部来自 test/race-census.test.mjs 第 42 到 84 行
//     那几段字符串 —— 一行断言都没有少跑。这一种最像真问题，所以要单独点名。
//
// 前两种读一眼就知道，第三种读一眼也知道 —— 但工具看不出来：它分不清
// 「这个回调一定会被调用」与「通常会」。所以这一份只把候选列出来，
// 判断留给人。与 arm 那一次一样：看得见才谈得上判断。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 日志 = process.argv[2];
if (!日志) {
  console.error("用法：node tools/cond-census.mjs <check-all 的日志>");
  process.exit(2);
}

const 表源 = fs.readFileSync(path.join(ROOT, "tools/check-all.mjs"), "utf8");
const 套件表 = [...表源.matchAll(/^\s*\["([^"]+)",\s*"([^"]+)",/gm)]
  .map((m) => ({ 名: m[1], 脚本: m[2] }));

const 实跑 = new Map();
for (const 行 of fs.readFileSync(日志, "utf8").split("\n")) {
  const m = /^\s*\[(通过|不通过)\]\s+([A-Za-z0-9_-]+?)\s*(\d+) passed, (\d+) failed/.exec(行);
  if (m) 实跑.set(m[2], Number(m[3]) + Number(m[4]));
}

// 断言函数的三个名字：ok 用得最多，另有 检查 与 判。
const 断言式 = /\b(ok|检查|判)\(/g;
const 行批 = [];
for (const { 名, 脚本 } of 套件表) {
  const 路 = path.join(ROOT, 脚本);
  if (!fs.existsSync(路) || !实跑.has(名)) continue;
  const 源 = fs.readFileSync(路, "utf8");
  行批.push({
    名, 脚本,
    静态: [...源.matchAll(断言式)].length,
    跳过: [...源.matchAll(/跳过/g)].length,
    跑过: 实跑.get(名),
  });
}

const 少 = 行批.map((r) => ({ ...r, 差: r.跑过 - r.静态 }))
  .filter((r) => r.差 < 0).sort((a, b) => a.差 - b.差);
const 等 = 行批.filter((r) => r.跑过 === r.静态).length;
const 多 = 行批.filter((r) => r.跑过 > r.静态).length;
// 表里有、日志里解析不出汇总行的那些：不是没跑，是它打出来的形状不带
// 「N passed, M failed」。点名出来，否则「228 个」这个数会被人问起而没有答案。
const 未解析 = 套件表.filter((s) => !实跑.has(s.名)).map((s) => s.名);

console.log("套件 " + 行批.length + " 个有实跑数字" +
  (未解析.length ? "（另有 " + 未解析.length + " 个的日志行不是那种形状：" + 未解析.join(" ") + "）" : ""));
console.log("实跑少于静态 " + 少.length + " 个 · 相等 " + 等 + " 个 · 实跑多于静态 " + 多 + " 个");
console.log("差额合计 " + 少.reduce((n, r) => n + r.差, 0) + " 处");
console.log("");
console.log("  次数差  套件              静态  实跑  跳过字样  脚本");
for (const r of 少) {
  console.log("  " + String(r.差).padStart(6) + "  " + r.名.padEnd(18) +
    String(r.静态).padStart(4) + "  " + String(r.跑过).padStart(4) + "  " +
    String(r.跳过).padStart(8) + "  " + r.脚本);
}
console.log("");
console.log("差额为负而「跳过」字样为零的几个最该先看 —— 那里跳过时什么都没说：");
for (const r of 少.filter((x) => x.跳过 === 0)) console.log("  " + r.名 + "  " + r.脚本);
console.log("  （先排除第四种：样本源码写成字符串的套件，静态计数会把字符串里的断言名也数上。");
console.log("    2026-11-07 核过的 racecensus 正是这一种，六条差一条都没少跑。）");

// ---- 与基线比：差额只能变小，不能变大 ----
//
// 为什么用差额而不是绝对数当判据：加一条判据时静态与实跑同时加一，差额不变；
// 修好一处被藏起来的判据时实跑加一，差额变小（好事，不红）；而有人把一组判据
// 包进 if 而没交代时实跑减几，差额变大 —— 那正是 arm、pipe、socket 那三次的形状。
//
// 基线在 tools/gap-baseline.json。它只能在那次变化已经查清之后重写，命令是
// 这一份带 --保存 跑一次全量的日志。生成它之前不该先改它 —— 那样等于把判据改成
// 「今天的样子」，而判据的意义是「别退回去」。
const 基线路 = path.join(ROOT, "tools/gap-baseline.json");
const 差额 = (r) => r.静态 - r.跑过;
const 现有 = Object.fromEntries(行批.map((r) => [r.名, 差额(r)]));

if (process.argv.includes("--保存")) {
  fs.writeFileSync(基线路, JSON.stringify({
    说明: "每个套件的（静态断言数 − 实跑项数）。判据只有一条：这个数不能变大 —— 变大说明有判据从「跑」变成了「不跑」。修好一处会让它变小，那不是问题。",
    测于: new Date().toISOString().slice(0, 10),
    怎么改: "只在差额的变化已经查清之后重写：node tools/cond-census.mjs <一份全量日志> --保存",
    差额: 现有,
  }, null, 2) + "\n", "utf8");
  console.log("");
  console.log("基线写好了：" + 基线路 + "（" + Object.keys(现有).length + " 个套件）");
} else if (fs.existsSync(基线路)) {
  const 基线 = JSON.parse(fs.readFileSync(基线路, "utf8")).差额 || {};
  const 变大 = [];
  const 变小 = [];
  for (const [名, 值] of Object.entries(现有)) {
    const 旧 = 基线[名];
    if (typeof 旧 !== "number") continue;         // 新套件还没有基线，不算变化
    if (值 > 旧) 变大.push(名 + " 从 " + 旧 + " 涨到 " + 值);
    else if (值 < 旧) 变小.push(名 + " 从 " + 旧 + " 降到 " + 值);
  }
  console.log("");
  console.log("与基线比（基线记于 " + (JSON.parse(fs.readFileSync(基线路, "utf8")).测于 || "未知") + "）：");
  if (变大.length === 0) console.log("  没有一个套件的差额变大");
  else for (const x of 变大) console.log("  变大  " + x + "  ← 有判据从「跑」变成「不跑」，要看它为什么");
  for (const x of 变小) console.log("  变小  " + x + "（修好了，好事，不是问题）");
} else {
  console.log("");
  console.log("还没有基线：tools/gap-baseline.json 不在，所以这一趟只列事实、不比。");
  console.log("要建基线：node tools/cond-census.mjs <一份全量日志> --保存");
}
