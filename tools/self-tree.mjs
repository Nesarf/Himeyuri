// 并行走两棵树：同一段源码，self 的 Module 与宿主的 ast 逐节点比。
//
// 节点的名字两边不同（num 对 Literal、name 对 Ident、bin 对 Binary …），所以先过一张映射表；
// 映射之后比三样：种类对不对、位置对不对、子节点还对不对得上。走到第一个对不上的节点就停，
// 把两边的路径都报出来 —— 那种报法比「有 N 个不同」有用，因为要修的是第一处。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "self/run.hmyr"));
if (!unit.ok) {
  console.log("self/run.hmyr 加载失败：" + JSON.stringify((unit.diagnostics.errors || []).slice(0, 2).map((e) => e.code)));
  process.exit(1);
}
const rt = runUnit(unit, { stepLimit: 40000000000 });
const 造模块 = (源) => rt.callFunction(rt.functions.get("造模块"), [源], null);

// 名字的映射：self 的 kind → 宿主的 kind。
const 映射 = {
  num: "Literal", str: "Literal", name: "Ident",
  bin: "Binary", unary: "Unary", call: "Call", field: "Field", index: "Index",
  tuple: "Tuple", record: "Record", err: "Error",
  let: "Let", var: "Var", return: "Return", assign: "Assign", expr: "ExprStmt",
  if: "If", while: "While",
  Fn: "Fn", Block: "Block", Module: "Module",
};

// 子节点怎么对：给同一层的两个节点，交回若干 [self 子, 宿主子] 对。
const 子对们 = (s, h) => {
  switch (s.kind) {
    case "Module": return (s.decls || []).map((x, i) => [x, (h.decls || [])[i]]);
    case "Fn": return [[s.body, h.body]];
    case "Block": return (s.statements || []).map((x, i) => [x, (h.statements || [])[i]]);
    case "let": case "var": case "assign": case "return":
      return [[s.value, h.value]];
    case "expr": return [[s.value, h.expr]];
    case "if": return [[s.cond, h.condition]];
    case "while": return [[s.cond, h.condition]];
    case "bin": return [[s.left, h.left], [s.right, h.right]];
    case "unary": return [[s.operand, h.operand]];
    case "call": return [[s.callee, h.callee], ...((s.args || []).map((x, i) => [x, (h.args || [])[i]]))];
    case "field": case "index": return [[s.target, h.target]];
    case "tuple": return (s.items || []).map((x, i) => [x, (h.items || [])[i]]);
    default: return [];
  }
};

// 走一遍，交回第一个差异（没有就 null）与走过的节点数。
const 走 = (s, h, 路, 计) => {
  if (计) 计.n++;
  if (!s || typeof s !== "object") return { 路, 因: "self 这一侧没有节点" };
  if (!h || typeof h !== "object") return { 路, 因: "宿主那一侧没有节点" };
  const 期望 = 映射[s.kind];
  if (!期望) return { 路, 因: "self 的 " + s.kind + " 不在映射表里" };
  if (h.kind !== 期望) return { 路, 因: "种类：self=" + s.kind + " 宿主=" + h.kind };
  if (s.line !== h.line || s.column !== h.column) {
    return { 路, 因: "位置：self=" + s.line + ":" + s.column + " 宿主=" + h.line + ":" + h.column };
  }
  // if 与 while 的内层语句：self 是语句数组，宿主是 Block —— 结构对不上时先在这里停，
  // 免得 子对们 拿数组去对一个 Block 而报出难读的差异。
  const 数 = (x) => {
    if (x === null || x === undefined) return 0;
    if (typeof x.statements !== "undefined") return x.statements.length;
    if (Array.isArray(x)) return x.length;
    if (typeof x === "object") return Object.keys(x).length;   // self 的元组在 JS 侧是类数组对象
    return -1;
  };
  if (s.kind === "if") {
    if (数(s.then) !== 数(h.then)) return { 路: 路 + "/then", 因: "语句数 self=" + 数(s.then) + " 宿主=" + 数(h.then) };
    if (数(s.otherwise) !== 数(h.otherwise)) return { 路: 路 + "/otherwise", 因: "语句数 self=" + 数(s.otherwise) + " 宿主=" + 数(h.otherwise) };
  }
  if (s.kind === "while") {
    if (数(s.body) !== 数(h.body)) return { 路: 路 + "/body", 因: "语句数 self=" + 数(s.body) + " 宿主=" + 数(h.body) };
  }
  for (const [己子, 彼子] of 子对们(s, h)) {
    const r = 走(己子, 彼子, 路 + "/" + (己子 && 己子.kind ? 己子.kind : "?"), 计);
    if (r) return r;
  }
  return null;
};

const 样本 = [
  ["字面量", "fn main() -> Int {\n  return 1 + 2 * 3\n}\n"],
  ["标识符与二元", "fn main() -> Int {\n  let a = 1\n  let b = 2\n  return a + b\n}\n"],
  ["一元负号", "fn main() -> Int {\n  return -5 + 3\n}\n"],
  ["调用与字段", "fn main() -> Int {\n  return f(1).g\n}\n"],
  ["if 与赋值", "fn main() -> Int {\n  var a = 1\n  a = a + 1\n  if a > 0 {\n    return 1\n  }\n  return 0\n}\n"],
  ["while 与赋值", "fn main() -> Int {\n  var i = 0\n  while i < 3 {\n    i = i + 1\n  }\n  return i\n}\n"],
];

console.log("一、并排走一遍，看第一处对不上的在哪里");
const 差异 = [];
for (const [名, 源] of 样本) {
  const 己 = 造模块(源);
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(源, { diagnostics: d }).tokens, { diagnostics: d });
  const 计 = { n: 0 };
  const r = 走(己, ast, "Module", 计);
  if (r) {
    差异.push({ 名, 路: r.路, 因: r.因 });
    console.log("  " + 名.padEnd(10) + " 走了 " + 计.n + " 个节点，在第一处停下：" + r.路 + "  " + r.因);
  } else {
    console.log("  " + 名.padEnd(10) + " 走了 " + 计.n + " 个节点，整棵对上");
  }
}

console.log("二、结论");
if (差异.length === 0) {
  ok("六段样本整棵树逐节点相同", true);
} else {
  ok("六段样本整棵树逐节点相同", false, "第一处：" + JSON.stringify(差异[0]));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
