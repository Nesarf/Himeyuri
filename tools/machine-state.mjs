// 那台机器的「文件级状态」有多少：结构性改动的第一步是先量。
//
// design/SELFRUN.txt 第 176 行写着下一格：把 g_stack / g_base / g_cur / steps / 键队列 /
// locale 这些文件级全局收进一个 Hmyr机器 结构，于是线程是第二个实例、GC 的根是实例里
// 那条帧链。那是这一路唯一一次结构性改动。
//
// 而结构性改动最怕的是「动手之后才发现漏了一处」。这一份先把账摆开：
// 哪些可变状态是机器状态、它们各自被引用多少次。数字出来之后才谈怎么切，
// 与 HMYR_SLOTS=1 那一招同一个理由 —— 报错不带名字时，先给它补上名字。
//
// 用法：node tools/machine-state.mjs
//
// 判据（工具算的部分，不算判断）：
//  ・只收「行首无缩进的 static 声明」，那是文件级；函数里的 static 不算
//  ・static const 归常量，不进这张表 —— 常量搬进结构没有意义
//  ・被引用的次数按「这一个名字作为整词出现在别的行」数，声明行不算
//
// 判断（留给读的人）：哪些该进结构、哪些该是缓存、哪些该留。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 源路 = path.join(ROOT, "vm/hmyr.c");
const 行们 = fs.readFileSync(源路, "utf8").split(/\r?\n/);

// 文件级声明：行首就是 static，且到那个分号为止。多行的声明（带换行的初始化）
// 在这里只取第一行 —— 这一份要的是清单与量级，不是一份完整的 C 解析器。
const 声明 = [];
for (let i = 0; i < 行们.length; i++) {
  const 行 = 行们[i];
  const m = /^static\s+(?!void\b|Value\b|int\s+main)([A-Za-z_][\w\s*]*?)\s+([^\s();=]+)\s*(?:=|;|\[)/.exec(行);
  if (!m) continue;
  if (/^static\s+const\b/.test(行)) continue;          // 常量不是状态
  if (/\)\s*\{?\s*$/.test(行)) continue;               // 函数定义
  if (/^static\s+(?:[A-Za-z_]\w*\s+)*[A-Za-z_]\w*\s*\(/.test(行)) continue;  // 原型
  声明.push({ 行号: i + 1, 名字: m[2].replace(/^\*+/, "").replace(/\[.*$/, ""), 原文: 行.trim() });
}

// 去重：同一个名字只留第一处（有的变量分两段声明，比如 ARM 桩与非 ARM 各一份）。
const 见过 = new Set();
const 项 = 声明.filter((d) => (见过.has(d.名字) ? false : (见过.add(d.名字), true)));

const 数引用 = (名字) => {
  const re = new RegExp("\\b" + 名字.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
  let n = 0;
  for (let i = 0; i < 行们.length; i++) {
    if (i + 1 === 项.find((x) => x.名字 === 名字)?.行号) continue;
    if (re.test(行们[i])) n++;
  }
  return n;
};

const 带数 = 项.map((d) => ({ ...d, 引用: 数引用(d.名字) })).sort((a, b) => b.引用 - a.引用);

console.log("vm/hmyr.c 的文件级可变状态");
console.log("  源行数 " + 行们.length);
console.log("  可变声明 " + 带数.length + " 项（static const 不计）");
console.log("");
const 宽 = Math.max(...带数.map((d) => d.名字.length), 4);
console.log("  " + "名字".padEnd(宽) + "  引用  行号");
for (const d of 带数) {
  console.log("  " + d.名字.padEnd(宽) + "  " + String(d.引用).padStart(4) + "  " + d.行号);
}

// 那一句「结构性改动」到底要动多少处：这是这件的价码。
const 总引用 = 带数.reduce((s, d) => s + d.引用, 0);
console.log("");
console.log("  引用合计 " + 总引用 + " 处");
console.log("  注：这一份只数，不判断哪些该进结构 —— 那是读它的人的事。");
