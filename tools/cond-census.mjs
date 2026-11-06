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
