// 种子认得哪些内置：把 bootstrap/pack.hmtn 的常量池扫一遍，与内置表求差。
//
// 为什么要量这件事：种子里那些名字不是 ASCII 存的，而是 UTF-16 码元。所以
// grep、strings、node -e "b.includes('split')" 全都看不见它们 —— 我一开始就是这么
// 搜的，结论是「一个都没有」，而那个结论是看不见，不是没有。
//
// 判据要能自证：print 一定认得（self-contained 那条路一直在跑它），所以它必须在
// 交集里；split 已知不认（2026-10-25 实测 HMYR-行-005），所以它必须在差集里。
// 两条都对上，这张表才可信。
//
// 用法：node tools/seed-gap.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 一、内置名：宿主那一份是全部的定义处，用同一套形状取（与 builtin-gap 一致）。
const 宿主源 = fs.readFileSync(path.join(ROOT, "src/eval.mjs"), "utf8");
const 起 = 宿主源.indexOf("const BUILTINS = {");
let 深 = 0, 止 = 起;
for (; 止 < 宿主源.length; 止++) {
  if (宿主源[止] === "{") 深++;
  else if (宿主源[止] === "}") { 深--; if (深 === 0) break; }
}
const 内置 = [...new Set([...宿主源.slice(起, 止).matchAll(/^ {2}([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm)].map((m) => m[1]))].sort();

// 二、种子里的词表：按 UTF-16 扫连续的可打印 ASCII 码元。
// 两种对齐都扫 —— 字节码不是按二字节对齐写的，错位一次就整片看不见。
const 字节 = fs.readFileSync(path.join(ROOT, "bootstrap/pack.hmtn"));
const 词 = new Set();
for (const 对齐 of [0, 1]) {
  let 当前 = "";
  for (let i = 对齐; i + 1 < 字节.length; i += 2) {
    const 码 = 字节[i] | (字节[i + 1] << 8);
    const 可 = (码 >= 0x30 && 码 <= 0x39) || (码 >= 0x41 && 码 <= 0x5A) ||
               (码 >= 0x61 && 码 <= 0x7A) || 码 === 0x5F;
    if (可) 当前 += String.fromCharCode(码);
    else {
      if (当前.length >= 3 && 当前.length <= 24 && /^[a-zA-Z_]/.test(当前)) 词.add(当前);
      当前 = "";
    }
  }
}

const 认得 = 内置.filter((n) => 词.has(n));
const 缺 = 内置.filter((n) => !词.has(n));

console.log("种子认得哪些内置（bootstrap/pack.hmtn）");
console.log("  种子字节 " + 字节.length);
console.log("  抽出的词 " + 词.size + " 个");
console.log("  内置共   " + 内置.length + " 个");
console.log("  认得     " + 认得.length + " 个：");
for (let i = 0; i < 认得.length; i += 8) console.log("    " + 认得.slice(i, i + 8).join(" "));
console.log("  不认识   " + 缺.length + " 个：");
for (let i = 0; i < 缺.length; i += 8) console.log("    " + 缺.slice(i, i + 8).join(" "));

// 三、判据自证：一条已知的「认得」，一条已知的「不该有」。
//
// 早一版拿 split 当反例 —— 那是当时的事实，不是永久的判据：种子认全之后它必然红，
// 而红的样子是「这张表不可信」，恰恰把好消息说成坏消息。
// 稳定的反例只能是一个不存在的名字：它证明这张词表能区分，而不是把一切都算成认得。
const print在 = 认得.includes("print");
const 假名在 = 词.has("zzz_no_such_builtin");
console.log("");
console.log("  自证：print " + (print在 ? "认得" : "不认得（与已知不符，这张表不可信）") +
            " · 一个假名字 " + (假名在 ? "竟然认得（这张表不可信）" : "不认得（对）"));
process.exit(print在 && !假名在 ? 0 : 1);
