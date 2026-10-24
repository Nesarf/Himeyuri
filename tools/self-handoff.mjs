// 门前的试推：把 self 造出的 Module 直接交给宿主的 Runtime，看它收不收、跑到哪儿为止。
//
// 并排比较是「两棵树长得一样」，这一件问的是另一句话：「宿主肯不肯把它当自己的树吃下去」。
// 分两步问：先 registerModule（只登记函数表），再 callFunction（真的要跑）。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { Runtime } from "../src/eval.mjs";

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

const 样本 = [
  ["常数", "fn main() -> Int {\n  return 42\n}\n", 42],
  ["let 与二元", "fn main() -> Int {\n  let a = 1\n  let b = 2\n  return a + b\n}\n", 3],
  ["if 分支", "fn main() -> Int {\n  let a = 3\n  if a > 2 {\n    return 10\n  }\n  return 0\n}\n", 10],
  ["while 累加", "fn main() -> Int {\n  var i = 0\n  var s = 0\n  while i < 4 {\n    s = s + i\n    i = i + 1\n  }\n  return s\n}\n", 6],
  ["十六进制", "fn main() -> Int {\n  return 0x1f + 1\n}\n", 32],
];

console.log("一、registerModule 收不收");
for (const [名, 源] of 样本) {
  const mod = 造模块(源);
  let 错误 = null;
  let 表 = null;
  try {
    const 宿主 = new Runtime({});
    宿主.registerModule(mod);
    表 = Array.from(宿主.functions.keys());
  } catch (e) {
    错误 = String(e && e.message).slice(0, 120);
  }
  ok(名 + "：登记进函数表", 错误 === null && 表 && 表.includes("main"), 错误 || JSON.stringify(表));
}

const 列 = (x) => {
  if (Array.isArray(x)) return x;
  if (x && typeof x === "object") return Object.values(x);
  return [];
};
const 数值 = (t) => {
  const s = String(t).replace(/_/g, "");
  if (/^0[xX]/.test(s)) return parseInt(s.slice(2), 16);
  if (/^0[bB]/.test(s)) return parseInt(s.slice(2), 2);
  if (/^0[oO]/.test(s)) return parseInt(s.slice(2), 8);
  return Number(s);
};

// 一层「改形状」：把 self 的节点翻成宿主求值器认的那一套。
//
// 它是一块验证用的适配层，不是产品代码 —— 目的只是量出「还差什么」。
// 差的东西在这张表里一目了然：kind 的大小写、Literal 的 type/value/raw、If 的 then 要包 Block、
// Return 的空值要用 null、params 要从名字变成 {name, fallback}。
const 改 = (n) => {
  if (!n || typeof n !== "object") return n;
  const 位 = { line: n.line, column: n.column };
  switch (n.kind) {
    case "Module": return { kind: "Module", imports: 列(n.imports).map(改), decls: 列(n.decls).map(改), rev: null };
    case "Import": return { kind: "Import", path: n.path, alias: null, rev: null, ...位 };
    case "Fn": return {
      kind: "Fn", name: n.name,
      params: 列(n.params).map((p) => ({ name: String(p), fallback: null })),
      returns: null, effects: 列(n.effects).map(String),
      contracts: { requires: [], ensures: [] },
      body: 改(n.body), pub: false, ...位,
    };
    case "Block": return { kind: "Block", statements: 列(n.statements).map(改), line: n.line };
    case "let": return { kind: "Let", name: n.name, type: null, value: 改(n.value), ...位 };
    case "var": return { kind: "Var", name: n.name, type: null, value: 改(n.value), ...位 };
    case "assign": return { kind: "Assign", name: n.name, value: 改(n.value), ...位 };
    case "return": return { kind: "Return", value: (n.value && n.value.kind === "nil") ? null : 改(n.value), ...位 };
    case "expr": return { kind: "ExprStmt", expr: 改(n.value), ...位 };
    case "if": return {
      kind: "If", condition: 改(n.cond),
      then: { kind: "Block", statements: 列(n.then).map(改), line: n.line },
      otherwise: 列(n.otherwise).length ? { kind: "Block", statements: 列(n.otherwise).map(改), line: n.line } : null, ...位,
    };
    case "while": return { kind: "While", condition: 改(n.cond), body: { kind: "Block", statements: 列(n.body).map(改), line: n.line }, ...位 };
    case "num": return { kind: "Literal", type: "int", value: 数值(n.text), raw: n.text, ...位 };
    case "str": return { kind: "Literal", type: "string", value: n.text, raw: false, ...位 };
    case "name": return { kind: "Ident", name: n.text, ...位 };
    case "bin": return { kind: "Binary", op: n.op, left: 改(n.left), right: 改(n.right), ...位 };
    case "unary": return { kind: "Unary", op: n.op, operand: 改(n.operand), ...位 };
    case "call": return { kind: "Call", callee: 改(n.callee), args: 列(n.args).map(改), ...位 };
    case "field": return { kind: "Field", target: 改(n.target), name: n.name, ...位 };
    case "index": return { kind: "Index", target: 改(n.target), index: 改(n.index), ...位 };
    case "tuple": return { kind: "Tuple", items: 列(n.items).map(改), ...位 };
    default: return n;
  }
};

console.log("二、改一层形状之后，callFunction 能不能真的跑");
for (const [名, 源, 期望] of 样本) {
  const mod = 改(造模块(源));
  let 结果 = null;
  let 错误 = null;
  try {
    const 宿主 = new Runtime({});
    宿主.registerModule(mod);
    const 函 = 宿主.functions.get("main");
    结果 = 宿主.callFunction(函, [], null);
  } catch (e) {
    错误 = String(e && e.message).slice(0, 160);
  }
  ok(名 + "：跑出 " + 期望, 错误 === null && 结果 === 期望, 错误 || "结果=" + JSON.stringify(结果));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
