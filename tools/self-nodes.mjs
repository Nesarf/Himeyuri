// 节点位置：两边解析同一段程序，树上的节点各自带着什么样的位置。
//
// 这一套先只问一件事：宿主 ast 里那些带 line 与 column 的节点，self 那边有没有对应位置的
// 节点。节点的名字两边不同（Literal 对 num、Ident 对 name、Binary 对 bin），所以比的是
// 「位置集合」—— 先把名字的差异放在一边，只量位置这一维。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "./self-bridge.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "self/run.hmoca"));
if (!unit.ok) {
  console.log("self/run.hmyr 加载失败：" + JSON.stringify((unit.diagnostics.errors || []).slice(0, 2).map((e) => e.code)));
  process.exit(1);
}
const rt = runUnit(unit, { stepLimit: 40000000000 });
const 自己树 = (源) => rt.callFunction(rt.functions.get("解析程序"), [源], null);
const 自己模块 = (源) => rt.callFunction(rt.functions.get("造模块"), [源], null);

// self 的节点：记录里只要有 kind 与 line 就算一个（语句层与表达式层都这样）。
const 收自己 = (x, 出) => {
  if (!x || typeof x !== "object") return 出;
  if (typeof x.kind === "string" && typeof x.line === "number") 出.push(x.kind + "@" + x.line + ":" + x.column);
  for (const k of Object.keys(x)) {
    const v = x[k];
    if (v && typeof v === "object") 收自己(v, 出);
  }
  return 出;
};
// 宿主 ast：节点的 line 与 column 由解析器填。
const 收宿主 = (x, 出) => {
  if (!x || typeof x !== "object") return 出;
  if (typeof x.kind === "string" && typeof x.line === "number") 出.push(x.kind + "@" + x.line + ":" + x.column);
  for (const k of Object.keys(x)) {
    const v = x[k];
    if (Array.isArray(v)) for (const e of v) 收宿主(e, 出);
    else if (v && typeof v === "object") 收宿主(v, 出);
  }
  return 出;
};

const 样本 = [
  ["字面量", "fn main() -> Int {\n  return 1 + 2 * 3\n}\n"],
  ["标识符与二元", "fn main() -> Int {\n  let a = 1\n  let b = 2\n  return a + b\n}\n"],
  ["一元负号", "fn main() -> Int {\n  return -5 + 3\n}\n"],
  ["调用与字段", "fn main() -> Int {\n  return f(1).g\n}\n"],
  ["if 与赋值", "fn main() -> Int {\n  var a = 1\n  a = a + 1\n  if a > 0 {\n    return 1\n  }\n  return 0\n}\n"],
  ["while 与赋值", "fn main() -> Int {\n  var i = 0\n  while i < 3 {\n    i = i + 1\n  }\n  return i\n}\n"],
];

console.log("一、self 的每个节点位置，宿主那边都有对应的节点");
for (const [名, 源] of 样本) {
  const 己 = 收自己(自己树(源), []);
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(源, { diagnostics: d }).tokens, { diagnostics: d });
  const 彼 = 收宿主(ast, []);
  const 己位 = 己.map((s) => s.split("@")[1]);
  const 彼位 = new Set(彼.map((s) => s.split("@")[1]));
  const 缺 = 己位.filter((p) => !彼位.has(p));
  ok(名 + "（self " + 己.length + " 个节点）", 己.length > 0 && 缺.length === 0,
   缺.length ? "这些位置在宿主那边没有：" + JSON.stringify(缺.slice(0, 4)) : "");
}

console.log("二、声明层：Module → Fn → Block");
for (const [名, 源] of 样本) {
  const 己 = 自己模块(源);
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(源, { diagnostics: d }).tokens, { diagnostics: d });
  const 描 = (f) => f.kind + " " + f.name + "@" + f.line + ":" + f.column + " " + f.body.kind + "(" + f.body.statements.length + ")";
  const 己描 = Array.from(己.decls).map(描);
  const 彼描 = ast.decls.map(描);
  ok(名 + "（" + 己.kind + "，" + 己描.length + " 个声明）",
    己.kind === "模块" && JSON.stringify(己描) === JSON.stringify(彼描),
    己描.length === 彼描.length && 己描.every((x, i) => x === 彼描[i]) ? "" : "self=" + JSON.stringify(己描) + " 宿主=" + JSON.stringify(彼描));
}

console.log("三、self 的每个节点都带着位置");
{
  const 己 = 收自己(自己树(样本[1][1]), []);
  ok("节点数大于零", 己.length > 0, String(己.length));
  ok("每个节点都有 line:column", 己.every((s) => /@\d+:\d+$/.test(s)), JSON.stringify(己.slice(0, 4)));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
