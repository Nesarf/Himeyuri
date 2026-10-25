// 第二刀的价码：执行位置要进结构，得有多少个函数收下那台机器。
//
// design/SELFRUN.txt 的第一刀把「根」收进了 Hmyr根。剩下的那一半是执行位置 ——
// g_cur / g_base / steps / step_limit / pool_p / pool_len。它们与根不同：
// 根只在 gc 那一段被读，而执行位置被每一个跑指令的函数读。
//
// 所以这一份问的不是「多少处引用」，而是「多少个函数」。前者决定改多少行，
// 后者决定改多少签名 —— 而签名才是这一刀的价码。
//
// 用法：node tools/machine-scope.mjs
//
// 判据（工具算的部分）：
//  ・函数定义 = 顶格开始、以 { 结尾、名字不是控制流关键字的那一行
//  ・一个函数的作用域到它的右花括号为止，按花括号计数
//  ・只认整词出现，注释里的也算（注释改名无害，而漏改有害）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 行们 = fs.readFileSync(path.join(ROOT, "vm/hmyr.c"), "utf8").split(/\r?\n/);

// 要搬进结构的那几项。第一刀把根收进了 Hmyr机器，第二刀把执行位置也收了进去 ——
// 于是这一份现在数的是「多少个函数直接读 g_机」，也就是第三刀（给函数加参数）
// 要动签名的那一批。判据从「几个名字」变成「一个对象」，正因为前两刀做完了。
const 目标 = ["g_机"];
const 控制 = new Set(["if", "while", "for", "switch", "do", "else", "return", "sizeof"]);

const 函数行 = [];
for (let i = 0; i < 行们.length; i++) {
  const 行 = 行们[i];
  // 函数定义的样子：括号收尾之后就是左花括号。带 static 也行，顶格也行 ——
  // 早一版要求「顶格且以 { 结尾」，于是这份 C 里一个函数都没认出来
  // （它是 static 开头）。判据按形状写，不按位置写。
  if (!/\)\s*\{/.test(行)) continue;
  if (/;\s*$/.test(行)) continue;                     // 原型
  const m = /^(?:static\s+)?[\w\s*]*?\b([A-Za-z_][\w\u4e00-\u9fff]*)\s*\(/.exec(行);
  if (!m) continue;
  if (控制.has(m[1])) continue;
  函数行.push({ 名: m[1], 行: i });
}

// 每个函数的作用域：从它的行开始数花括号。
const 归属 = new Map();   // 函数名 → Set(目标名)
for (let k = 0; k < 函数行.length; k++) {
  const 起 = 函数行[k].行;
  const 止 = k + 1 < 函数行.length ? 函数行[k + 1].行 : 行们.length;
  const 集 = new Set();
  for (let i = 起; i < 止; i++) {
    for (const 名 of 目标) {
      const re = new RegExp("(^|[^A-Za-z0-9_])" + 名 + "(?![A-Za-z0-9_])");
      if (re.test(行们[i])) 集.add(名);
    }
  }
  if (集.size) 归属.set(函数行[k].名, 集);
}

console.log("第二刀的价码：执行位置要进结构，哪些函数得收下它");
console.log("  源行数 " + 行们.length);
console.log("  函数定义 " + 函数行.length + " 个");
console.log("  碰到执行位置的 " + 归属.size + " 个");
console.log("");

// 反方向：每一项落在哪些函数里 —— 这才看得出「能不能先搬一项」。
for (const 名 of 目标) {
  const 们 = [...归属].filter(([, 集]) => 集.has(名)).map(([f]) => f);
  console.log("  " + 名.padEnd(12) + 们.length + " 个函数" + (们.length ? "：" + 们.slice(0, 8).join(" ") + (们.length > 8 ? " …" : "") : ""));
}

console.log("");
console.log("  接缝最小的那一项先搬 —— 上表里函数最少的就是它。");
