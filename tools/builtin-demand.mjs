// 自举层「要哪些内置」—— 从入口按调用图往外走，按第几跳分组。
//
// 与 tools/builtin-gap.mjs 问的不是同一件事：那一边数「六处实现各认哪些名字」，
// 是供给面；这一边数「一份已经编好的字节码从某个入口出发，真的会用到哪些」，
// 是需求面。两边一对，缺的那一段才看得出来：需求面有、供给面没有的，就是墙。
//
// 为什么按跳分组：补内置不是按名字表的字母序补，是按「离入口多远」补。
// 第一跳的那几个（argv len chr print_err print）决定「跑得起来吗」，
// 而第十六跳的那批决定「跑完整个命令行吗」。中间每一跳都是一个可以停的点：
// 停在那儿，探针会报出下一个缺的名字。
//
// 用法：node tools/builtin-demand.mjs [一份 .hmoks] [入口函数名]
//       缺省读 runtime/run.hmoks，入口缺省 命令行入口。
//
// 只读，不写任何文件；产物是几行字。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 读程序 } from "../src/code-file.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 码路 = path.resolve(process.argv[2] || path.join(ROOT, "runtime/run.hmoks"));
const 入口 = process.argv[3] || "命令行入口";
const 程序 = 读程序(fs.readFileSync(码路), null);

// 每个函数直接用到什么：内置名与函数名分开记，因为「缺内置」与「缺函数」
// 是两件不同的事，混在一个集合里会互相冒充。
const 被调 = new Map();
for (const [名, 函] of 程序.函数族) {
  const 内置 = new Set(), 调用 = new Set();
  for (const 令 of 函.码) {
    if (令.op === "调内置") 内置.add(令.a);
    else if (令.op === "调函数") 调用.add(令.a);
  }
  被调.set(名, { 内置, 调用 });
}
if (!被调.has(入口)) {
  console.error("这份字节码里没有 " + 入口 + " 这个函数");
  process.exit(1);
}

// 广度优先：第一次用到某个内置的那一跳，就是它的距离。
const 距 = new Map([[入口, 0]]);
const 首见 = new Map();
const 队 = [入口];
while (队.length) {
  const 名 = 队.shift();
  const 条 = 被调.get(名);
  if (!条) continue;
  for (const b of 条.内置) if (!首见.has(b)) 首见.set(b, 距.get(名));
  for (const g of 条.调用) {
    if (距.has(g)) continue;
    距.set(g, 距.get(名) + 1);
    队.push(g);
  }
}

const 分层 = new Map();
for (const [名, 跳] of 首见) {
  if (!分层.has(跳)) 分层.set(跳, []);
  分层.get(跳).push(名);
}
const 跳们 = [...分层.keys()].sort((a, b) => a - b);

console.log("入口 " + 入口 + " · 可达 " + 距.size + " 个函数 · 要 " + 首见.size + " 个内置");
for (const 跳 of 跳们) {
  const 批 = 分层.get(跳).sort();
  console.log("第 " + 跳 + " 跳（" + 批.length + "）：" + 批.join(" "));
}

// 第二栏：有函数从入口到不了。它们的内置需求不在上面那张表里 ——
// 而「补了却没生效」最常见的原因正是这个：那个函数根本不在入口的通路上。
const 不可达 = [...程序.函数族.keys()].filter((n) => !距.has(n));
if (不可达.length) {
  console.log("从入口到不了 " + 不可达.length + " 个（它们要的内置不算在表里）：" + 不可达.slice(0, 10).join(" ") + (不可达.length > 10 ? " …" : ""));
}
