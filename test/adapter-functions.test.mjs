// 适配层函数表的验收：整个程序，两边同一个答案。
//
// 到这一层，「宿主与自举跑同一个程序」终于可以是一整句验收而不是一句愿望。
//
// 而一条边界也钉在这里：自举那边执行函数体时不把参数绑进环境，
// 于是带参数的函数会以「没有这个名字」失败，而不是算出一个错的数。
// 「现在如此」比「将来补」诚实——而一个会静默算错的边界，比一个报错的边界坏得多。
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

const 自举层 = loadUnit(path.join(ROOT, "self/eval.hmyr"));
const 自举 = runUnit(自举层);
const 宿主的 = (源) => run(源, {}).value;
const 那边的 = (源) => {
  const 表 = functions(源);
  const 主 = statements(源);
  if (主.错) return { err: 主.错 };
  const 回 = 自举.callFunction(自举.functions.get("跑程序带函数"), [主.语句们, 表.表], null);
  if (回 && 回.ok === false) return { err: 回.text || "报错" };
  return { value: 回 && Object.prototype.hasOwnProperty.call(回, "value") ? 回.value : 回 };
};
const 写 = (行们) => 行们.join("\n") + "\n";

console.log("一、函数表造得出来");
{
  const 源 = 写([
    "fn a() -> Int {",
    "  return 2",
    "}",
    "fn b() -> Int {",
    "  return 3",
    "}",
    "fn main() -> Int {",
    "  return a() + b()",
    "}",
  ]);
  const 表 = functions(源);
  ok("三个函数都在表里", 表.表.length === 3, JSON.stringify(表.表.map((f) => f[0])));
  ok("名字对得上", JSON.stringify(表.表.map((f) => f[0])) === JSON.stringify(["a", "b", "main"]), JSON.stringify(表.表.map((f) => f[0])));
  ok("每一项是（名字, 语句序列）", 表.表.every((f) => typeof f[0] === "string" && Array.isArray(f[1])), JSON.stringify(表.表[0]).slice(0, 80));
}

console.log("二、整个程序：两边同一个答案");
{
  const 例们 = [
    ["只调一个", ["fn f() -> Int {", "  return 41", "}", "fn main() -> Int {", "  return f() + 1", "}"], 42],
    ["调两个", ["fn a() -> Int {", "  return 2", "}", "fn b() -> Int {", "  return 3", "}", "fn main() -> Int {", "  return a() + b()", "}"], 5],
    ["函数里带 if", ["fn f() -> Int {", "  if 1 < 2 {", "    return 9", "  }", "  return 0", "}", "fn main() -> Int {", "  return f()", "}"], 9],
    ["函数套函数", ["fn g() -> Int {", "  return 4", "}", "fn f() -> Int {", "  return g() + 1", "}", "fn main() -> Int {", "  return f() * 2", "}"], 10],
  ];
  for (const [标签, 行们, 答] of 例们) {
    const 源 = 写(行们);
    const 甲 = 宿主的(源);
    const 乙 = 那边的(源);
    ok(标签.padEnd(10) + " → 两边都是 " + 答, 甲 === 答 && 乙.value === 答, "宿主 " + 甲 + " · 自举 " + JSON.stringify(乙));
  }
}

console.log("三、参数那条边界：报错，而不是算错");
{
  const 源 = 写([
    "fn g(n: Int) -> Int {",
    "  return n",
    "}",
    "fn main() -> Int {",
    "  return g(7)",
    "}",
  ]);
  ok("宿主算得出 7", 宿主的(源) === 7, String(宿主的(源)));
  const 乙 = 那边的(源);
  ok("自举报错而不是算错", 乙.err !== undefined, JSON.stringify(乙).slice(0, 100));
  ok("而报的是「没有这个名字」", typeof 乙.err === "string" && 乙.err.includes("没有这个名字"), 乙.err);
  ok("它没有交回零（零会被当成一个答案）", 乙.value === undefined, JSON.stringify(乙.value));
}

console.log("四、没有 main 时说得出");
{
  const 源 = 写(["fn f() -> Int {", "  return 1", "}"]);
  ok("函数表照样造得出来", functions(源).表.length === 1, String(functions(源).表.length));
  ok("而 statements 说没有 main", statements(源).错 === "没有 main", String(statements(源).错));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
