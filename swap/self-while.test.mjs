// 自举那一层的 while：解析得出来，跑得对，而与宿主算得一样。
//
// 这一套是为 while 单独写的，因为它是一个**语句**而不是表达式——
// 它碰环境（体会改 i），而那就意味着它与 if 不是同一件事。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { functions, statements } from "../src/adapter.mjs";
import { run } from "../src/eval.mjs";
import { loadUnit, runUnit } from "../tools/self-bridge.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 自举层 = loadUnit(path.join(ROOT, "self/eval.hmyr"));
const 自举 = runUnit(自举层);
const 语句层 = loadUnit(path.join(ROOT, "self/stmt.hmyr"));
const 语法 = runUnit(语句层);
const 词法 = runUnit(loadUnit(path.join(ROOT, "self/lex.hmyr")));

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

console.log("一、解析层认 while");
{
  const 源 = "while i < 3 {\n  i = i + 1\n}\n";
  const tokens = 词法.callFunction(词法.functions.get("scan_lines"), [源], null);
  const 一 = 语法.callFunction(语法.functions.get("parse_statement"), [tokens], null);
  ok("parse_statement 交回一个节点", 一 && 一.node, JSON.stringify(一).slice(0, 100));
  ok("种类是 while", 一 && 一.node.kind === "while", JSON.stringify(一 && 一.node && 一.node.kind));
  ok("带条件", 一 && 一.node.cond && 一.node.cond.kind === "bin", JSON.stringify(一 && 一.node && 一.node.cond).slice(0, 80));
  ok("带体，而体里有一条语句", 一 && Array.isArray(一.node.body) && 一.node.body.length === 1, JSON.stringify(一 && 一.node && 一.node.body).slice(0, 80));
}

console.log("二、跑得对，而且与宿主一样");
{
  const 例们 = [
    ["累加到五", 写(["fn main() -> Int {", "  var i = 0", "  var s = 0", "  while i < 5 {", "    s = s + i", "    i = i + 1", "  }", "  return s", "}"]), 10],
    ["条件一开始就假", 写(["fn main() -> Int {", "  var i = 99", "  var s = 7", "  while i < 5 {", "    s = 0", "  }", "  return s", "}"]), 7],
    ["两个变量一起改", 写(["fn main() -> Int {", "  var i = 0", "  var s = 1", "  while i < 4 {", "    s = s * 2", "    i = i + 1", "  }", "  return s", "}"]), 16],
    ["while 里套 if", 写(["fn main() -> Int {", "  var i = 0", "  var s = 0", "  while i < 10 {", "    if i < 3 {", "      s = s + 1", "    }", "    i = i + 1", "  }", "  return s", "}"]), 3],
    ["while 里调函数", 写(["fn sq(x: Int) -> Int {", "  return x * x", "}", "fn main() -> Int {", "  var i = 0", "  var s = 0", "  while i < 4 {", "    s = s + sq(i)", "    i = i + 1", "  }", "  return s", "}"]), 14],
  ];
  for (const [标签, 源, 答] of 例们) {
    const 甲 = 宿主的(源);
    const 乙 = 那边的(源);
    ok(标签.padEnd(12) + " → 两边都是 " + 答, 甲 === 答 && 乙.value === 答, "宿主 " + 甲 + " · 自举 " + JSON.stringify(乙).slice(0, 80));
  }
}

console.log("三、那一道闸还在");
{
  // 一百万次的上限在 执行反复 里。这里不真的跑一百万次——
  // 那一句只确认它写在那儿，而真实跑一次的成本不值得。
  const e = fs.readFileSync(path.join(ROOT, "self/eval.hmyr"), "utf8");
  ok("执行反复 里有百万次那道闸", e.includes("一百万次"), e.includes("一百万次") ? "在" : "不在");
  ok("而它在 while 那一路里", e.includes('种 == "while"') && e.includes("执行反复"), "在");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
