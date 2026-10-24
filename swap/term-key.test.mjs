// 键输入的验收：输入也可以注入，所以「按键就停」这件事能被自动验。
//
// 为什么非要这样设计：套件里不能真的按键，而**不可验的输入等于没有测试**。
// 真实终端与套件因此走同一条路——同一个队列；而 key_start 在非 TTY 的环境里
// 如实返回 false（stdio 是管道时不装成能收键），这一点也写成断言。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../tools/self-bridge.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const rt = runUnit(loadUnit(path.join(ROOT, "term.hmyr")));
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

console.log("\n队列：推一个键，读一个键");
{
  ok("一开始队列是空的", call("有键", []) === false);
  call("推键", ["q"]);
  ok("推入之后有待读的键", call("有键", []) === true);
  ok("取出来正是那个键", call("取键", []) === "q", JSON.stringify(call("取键", [])));
  ok("取完之后队列又空了", call("有键", []) === false);
  ok("空队列读到空字符串，不崩", call("取键", []) === "", JSON.stringify(call("取键", [])));
  call("推键", ["a"]);
  call("推键", ["b"]);
  ok("先进先出", call("取键", []) === "a" && call("取键", []) === "b");
}

console.log("\n真实终端：不能收键时如实说，不装");
{
  const 结果 = call("开始收键", []);
  ok("返回值是布尔", 结果 === true || 结果 === false, String(结果));
  ok("在这个环境里是假（stdio 是管道，不是终端）", 结果 === false, String(结果));
}

console.log("\n按键就停：帧循环遇键收手");
{
  call("推键", ["x"]);
  const src = 'fn main() -> Int effects(process) {\n  print(str(跑到按键(((0, "点"),), 1200, 10, 50)))\n  return 0\n}\n';
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });
  ok("那段小程序解析得动", d.items.filter((x) => x.s === "error").length === 0);
  let buffer = "";
  rt.write = (s) => { buffer += s; };
  rt.registerModule(ast);
  rt.callFunction(rt.functions.get("main"), [], null);
  const 帧数 = Number((/(\d+)\s*$/.exec(buffer) || [0, "-1"])[1]);
  ok("在 50 帧之内停下了", 帧数 < 50, String(帧数));
  ok("而且至少跑了一帧（第一帧就先查键，查到了才收手）", 帧数 >= 0, String(帧数));
  ok("键还在队列里，没有被吃掉", call("有键", []) === true);
}
{
  // 没有键的时候，它应当跑满给定的帧数。
  // 先把上一节故意留下的那个键取光——否则这里测的就不是「没有键」了。
  while (call("有键", [])) { call("取键", []); }
  const src = 'fn main() -> Int effects(process) {\n  print(str(跑到按键(((0, "点"),), 1200, 0, 3)))\n  return 0\n}\n';
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });
  rt.registerModule(ast);
  let buffer = "";
  rt.write = (s) => { buffer += s; };
  rt.callFunction(rt.functions.get("main"), [], null);
  ok("没有键时跑满三帧", (/(\d+)\s*$/.exec(buffer) || [0, "-1"])[1] === "3", JSON.stringify(buffer.slice(-24)));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
