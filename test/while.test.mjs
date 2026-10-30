// while 的验收：语言里终于有了循环。
//
// 为什么这一步要先动语言：shell 的真会话要「一直等、一直读」，而递归会撞深度上限。
// 语言里有了循环，用这门语言写的东西才不必靠深递归硬撑。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { Runtime } from "../src/eval.mjs";

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 跑 = (src) => {
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });
  const errs = d.items.filter((x) => x.s === "error");
  if (errs.length) return { error: "解析报错 " + errs.map((x) => x.c + " " + x.m).join(" | ") };
  let out = "";
  const rt = new Runtime({});
  rt.write = (s) => { out += s; };
  // 只登记、不执行：rt.run 会把 main 跑一遍，随后再调一次就得到两份输出。
  rt.registerModule(ast);
  try { return { value: rt.callFunction(rt.functions.get("main"), [], null), out }; }
  catch (e) { return { error: (e.code || "") + " " + e.message, out }; }
};

console.log("基本用法");
ok("计数到三", 跑("fn main() -> Int {\n  var n = 0\n  while n < 3 { n = n + 1 }\n  return n\n}\n").value === 3);
ok("条件一开始就假时一次也不跑", 跑("fn main() -> Int {\n  var n = 5\n  while n < 0 { n = n + 1 }\n  return n\n}\n").value === 5);
ok("循环里能写出去", 跑("fn main() -> Int effects(process) {\n  var n = 0\n  while n < 3 { print(str(n)) n = n + 1 }\n  return n\n}\n").out === "012");
console.log("嵌套与非平凡条件");
{
  const r = 跑("fn main() -> Int {\n  var a = 0\n  var t = 0\n  while a < 3 {\n    var b = 0\n    while b < 2 { t = t + 1 b = b + 1 }\n    a = a + 1\n  }\n  return t\n}\n");
  ok("嵌套循环：三次外、两次内，共六次", r.value === 6, JSON.stringify(r));
}
{
  const r = 跑("fn main() -> Int {\n  var n = 20\n  while n > 1 { if n % 2 == 0 { n = n / 2 } else { n = n - 1 } }\n  return n\n}\n");
  ok("条件里带运算与分支", r.value === 1, JSON.stringify(r));
}
console.log("上限保护：不会挂死在那里");
{
  const r = 跑("fn main() -> Int {\n  while true { }\n  return 0\n}\n");
  ok("跑过一百万次就停下并报 HMYR-內-010", r.error && r.error.includes("HMYR-內-010"), String(r.error));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
