// 两边对照：真程序，宿主与自举给同一个答案。
//
// 这是「把自举那条线当默认」的门禁。它比 adapter 那几套更靠外——
// 那几套一层一层验（表达式、语句、函数表），而这一套只问一件事：
// 同一份源码，两条路跑出来的值是不是一样。
//
// 而它钉的最后一条最要紧：两边不会一边给答案一边报错。
// 「都失败」是可接受的（那说明这件事两边都不会），「一边成功一边失败」说明有一条路坏了。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { functions, statements } from "../src/adapter.mjs";
import { run } from "../src/eval.mjs";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 自举 = runUnit(loadUnit(path.join(ROOT, "self/eval.hmyr")));
const 宿主的 = (源) => {
  // 包一层：宿主那颗求值器在少数路径上会直接抛，而让它抛到测试外面，
  // 报出来的是一段栈而不是「哪一例坏了」。
  try {
    const r = run(源, {});
    const 坏 = r.diagnostics.items.filter((x) => (x.severity || x.s) === "error");
    return 坏.length ? { err: 坏[0].code || 坏[0].c } : { value: r.value };
  } catch (e) {
    return { err: (e.code || e.message || "抛了").toString().slice(0, 60) };
  }
};
const 那边的 = (源) => {
  try {
    const 表 = functions(源);
    const 主 = statements(源);
    if (主.错) return { err: 主.错 };
    const 回 = 自举.callFunction(自举.functions.get("跑程序带函数"), [主.语句们, 表.表], null);
    if (回 && 回.ok === false) return { err: 回.text || "报错" };
    return { value: 回 && Object.prototype.hasOwnProperty.call(回, "value") ? 回.value : 回 };
  } catch (e) {
    return { err: (e.code || e.message || "抛了").toString().slice(0, 60) };
  }
};
const 写 = (行们) => 行们.join("\n") + "\n";

// 每一例：标签 · 程序的行 · 期望的数
const 例们 = [
  ["算术与优先级", ["fn main() -> Int {", "  return 1 + 2 * 3 + 4 * 5", "}"], 27],
  ["括号改变结合", ["fn main() -> Int {", "  return (1 + 2) * (3 + 4)", "}"], 21],
  ["取余", ["fn main() -> Int {", "  return 17 % 5", "}"], 2],
  ["if 真", ["fn main() -> Int {", "  var y = 0", "  if 1 < 2 {", "    y = 11", "  }", "  return y", "}"], 11],
  ["if 假", ["fn main() -> Int {", "  var y = 0", "  if 2 < 1 {", "    y = 11", "  }", "  return y", "}"], 0],
  ["if else 走 else", ["fn main() -> Int {", "  var y = 0", "  if 2 < 1 {", "    y = 1", "  } else {", "    y = 2", "  }", "  return y", "}"], 2],
  ["while 累加", ["fn main() -> Int {", "  var i = 0", "  var s = 0", "  while i < 6 {", "    s = s + i", "    i = i + 1", "  }", "  return s", "}"], 15],
  ["while 里套 while", ["fn main() -> Int {", "  var i = 0", "  var s = 0", "  while i < 3 {", "    var j = 0", "    while j < 3 {", "      s = s + 1", "      j = j + 1", "    }", "    i = i + 1", "  }", "  return s", "}"], 9],
  ["函数带参数", ["fn add(a: Int, b: Int) -> Int {", "  return a + b", "}", "fn main() -> Int {", "  return add(20, 22)", "}"], 42],
  ["递归", ["fn f(n: Int) -> Int {", "  if n <= 1 {", "    return 1", "  }", "  return n * f(n - 1)", "}", "fn main() -> Int {", "  return f(5)", "}"], 120],

];

console.log("一、两边同一个答案");
for (const [标签, 行们, 答] of 例们) {
  const 源 = 写(行们);
  const 甲 = 宿主的(源);
  const 乙 = 那边的(源);
  ok(标签.padEnd(18) + " → " + 答, 甲.value === 答 && 乙.value === 答,
    "宿主 " + JSON.stringify(甲).slice(0, 60) + " · 自举 " + JSON.stringify(乙).slice(0, 60));
}

console.log("二、已知的语义差异：改参数");
{
  // 这一条不是崩溃，而是一处两边态度不同的地方：
  //   宿主   给参数赋值会拒绝（参数不是 var 声明的东西，R0150）
  //   自举   允许，因为它的环境里参数与 let 名字长得一样
  //
  // 这一节把它**写下来**，而不是从对照表里悄悄删掉。将来往哪边收，
  // 这一条会变红，而那时改它的人会知道自己在改什么。
  const 源 = 写([
    "fn bump(x: Int) -> Int {",
    "  x = x + 100",
    "  return x",
    "}",
    "fn main() -> Int {",
    "  var n = 1",
    "  let 丢 = bump(n)",
    "  return n",
    "}",
  ]);
  const 甲 = 宿主的(源);
  const 乙 = 那边的(源);
  ok("宿主拒绝给参数赋值（R0150）", 甲.err === "HMYR-R0150", JSON.stringify(甲).slice(0, 60));
  ok("而自举接受了它（差异仍在）", 乙.value === 1, JSON.stringify(乙).slice(0, 60));
  ok("两边因此不同（这一条是记录，不是通过）", 甲.err !== undefined && 乙.value !== undefined);
}

console.log("三、两边不会一边成功一边失败");
{
  // 几个两边都该拒绝的程序。要紧的是**两边态度一致**，而具体理由可以不同。
  const 坏们 = [
    ["除零", ["fn main() -> Int {", "  return 1 / 0", "}"]],
    ["未知名字", ["fn main() -> Int {", "  return nope", "}"]],
    ["调用不存在的函数", ["fn main() -> Int {", "  return 不存在()", "}"]],
  ];
  for (const [标签, 行们] of 坏们) {
    const 源 = 写(行们);
    const 甲 = 宿主的(源);
    const 乙 = 那边的(源);
    const 甲失败 = 甲.err !== undefined;
    const 乙失败 = 乙.err !== undefined;
    ok(标签.padEnd(14) + " → 两边都拒绝", 甲失败 && 乙失败,
      "宿主 " + JSON.stringify(甲).slice(0, 50) + " · 自举 " + JSON.stringify(乙).slice(0, 50));
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
