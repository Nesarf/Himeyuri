// 性能测量：几件有代表性的事，各跑若干次取平均。
//
// 为什么它不是套件：套件回答「对不对」，而这一份回答「多快」。
// 快慢没有通过与否，只有数字——所以它单独一个工具，不进 check-all。
//
//   node tools/bench.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { Runtime } from "../src/eval.mjs";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 计量 = (label, n, fn) => {
  // 先跑一次热身：第一次会带上 JIT 与文件缓存的开销，算进去就失真。
  fn();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) fn();
  const ms = (performance.now() - t0) / n;
  console.log("  " + label.padEnd(30) + ms.toFixed(3).padStart(9) + " ms");
  return ms;
};

const 源码 = fs.readFileSync(path.join(ROOT, "self/eval.hmoca"), "utf8");
console.log("  测于 " + new Date().toISOString().slice(0, 19).replace("T", " ") + " · Node " + process.version);
console.log("");
console.log("词法与语法");
计量("词法 self/eval.hmyr（" + Math.round(源码.length / 1024) + " KB）", 50, () => lex(源码, {}));
计量("语法（同上一份）", 50, () => parse(lex(源码, {}).tokens, {}));

console.log("");
console.log("求值");
const 跑 = (src) => { const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} }; const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d }); const rt = new Runtime({}); rt.write = () => {}; rt.registerModule(ast); rt.callFunction(rt.functions.get("main"), [], null); };
计量("一万次 while 循环", 20, () => 跑("fn main() -> Int {\n  var i = 0\n  while i < 10000 { i = i + 1 }\n  return i\n}\n"));
计量("一百次函数调用", 20, () => 跑("fn f(n: Int) -> Int {\n  if n <= 0 { return 0 }\n  return f(n - 1) + 1\n}\nfn main() -> Int {\n  return f(100)\n}\n"));

console.log("");
console.log("自举");
const 自举 = loadUnit(path.join(ROOT, "self/lex.hmoca"));
if (自举.ok) {
  const rt = runUnit(自举);
  计量("自举的词法，扫一段十六行", 30, () => rt.callFunction(rt.functions.get("scan_lines"), ["let a = 1\nlet b = 2\nlet c = 3\nlet d = 4\nlet e = 5\nlet f = 6\nlet g = 7\nlet h = 8\nlet i = 9\nlet j = 10\nlet k = 11\nlet l = 12\nlet m = 13\nlet n = 14\nlet o = 15\nlet p = 16\n"], null));
} else {
  console.log("  （自举那一层加载不动：" + 自举.diagnostics.errors.map((e) => e.code).join(",") + "）");
}

console.log("");
console.log("帧输出（同一块二十行的画布）");
const 终端 = loadUnit(path.join(ROOT, "term.hmoca"));
if (终端.ok) {
  const rt = runUnit(终端);
  const 布 = rt.callFunction(rt.functions.get("空画布"), [20, 40], null);
  const 改了一行 = rt.callFunction(rt.functions.get("换行"), [布, 10, "Z".repeat(40)], null);
  计量("整屏画一帧", 200, () => rt.callFunction(rt.functions.get("画一帧"), [布], null));
  计量("差异：一行变了", 200, () => rt.callFunction(rt.functions.get("画一帧差异"), [布, 改了一行], null));
  计量("差异：什么都没变", 200, () => rt.callFunction(rt.functions.get("画一帧差异"), [布, 布], null));
  const 整 = rt.callFunction(rt.functions.get("画一帧"), [改了一行], null).length;
  const 差 = rt.callFunction(rt.functions.get("画一帧差异"), [布, 改了一行], null).length;
  console.log("  字节：整屏 " + 整 + " · 差异 " + 差 + "（省 " + Math.round((1 - 差 / 整) * 100) + "%）");
} else {
  console.log("  （终端那一层加载不动）");
}
