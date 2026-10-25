// The chain grows again: calls and subscripts, which live in the same layer (postfix).
//
// This is the pair the body reader was waiting on: with them, `print(t[1])` reads as a call whose
// argument is a subscript, instead of stopping at the name.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const attempt = (fn) => { try { return { value: fn() }; } catch (e) { return { error: (e.code || "") + " " + e.message }; } };

const unit = loadUnit(path.join(ROOT, "self/chain.hmoca"));
ok("the chain loads", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("there is no function called " + name);
  return rt.callFunction(fn, args, null);
};
const mine = (source) => call("chain", [call("scan", [source])]).node;

// 位置与原文不参与比较；Ident 与 Literal 各归一到一个字段。
// 两个人交出的树现在同名同形，于是「归约」这件事只剩剥位置。
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    if (v.kind === "Ident") return { kind: "Ident", name: v.name !== undefined ? v.name : v.text };
    if (v.kind === "Literal") {
      const 原 = v.value !== undefined ? v.value : (v.text !== undefined ? v.text : v.raw);
      return { kind: "Literal", type: v.type, value: v.type === "int" ? Number(原) : 原 };
    }
    const o = {};
    for (const key of Object.keys(v)) {
      if (key === "line" || key === "column" || key === "raw" || key === "text") continue;
      o[key] = canon(v[key]);
    }
    return o;
  }
  return v;
};

/** The JavaScript tree, reduced to the shapes the chain produces. */
function jsShape(node) {
  return canon(node);
}const theirs = (source) => {
  const diagnostics = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex("fn t() {\n  let r = " + source + "\n}\n", {}).tokens, { diagnostics });
  if (diagnostics.errors.length) throw new Error("the JavaScript parser refused: " + diagnostics.errors[0].code);
  return jsShape(ast.decls[0].body.statements[0].value);
};

const CASES = [
  "f()",
  "f(1)",
  "f(1, 2)",
  "f(1 + 2, g(3))",
  "t[0]",
  "t[i + 1]",
  "f(1)[0]",
  "t[0] + t[1]",
  "f(t[0]) * 2",
];

console.log("\ncalls and subscripts, against the JavaScript parser");
for (const source of CASES) {
  const m = attempt(() => mine(source));
  const t = attempt(() => theirs(source));
  const same = !m.error && !t.error && JSON.stringify(canon(m.value)) === JSON.stringify(canon(t.value));
  ok(source, same, m.error || t.error || (JSON.stringify(canon(m.value)) + " vs " + JSON.stringify(canon(t.value))));
}

console.log("\nthe parts, spelled out");
{
  const tree = mine("f(1, 2)");
  ok("a call keeps its callee and its arguments in order", tree.kind === "Call" && tree.callee.kind === "Ident" && tree.args.length === 2, JSON.stringify(tree));
}
{
  const tree = mine("g()");
  ok("a call with no arguments has an empty argument list", tree.kind === "Call" && tree.args.length === 0, JSON.stringify(tree));
}
{
  const tree = mine("t[i + 1]");
  ok("the subscript keeps an expression, not just a name", tree.kind === "Index" && tree.index.kind === "Binary", JSON.stringify(tree));
}
{
  const tree = mine("f(1)[0]");
  ok("a call can be subscripted", tree.kind === "Index" && tree.target.kind === "Call", JSON.stringify(tree));
}
{
  const tree = mine("f(t[0]) * 2");
  ok("they nest inside arithmetic as expected", tree.kind === "Binary" && tree.left.kind === "Call" && tree.left.args[0].kind === "Index", JSON.stringify(tree));
}
{
  const tree = mine("t[0] + t[1]");
  ok("two subscripts add", tree.kind === "Binary" && tree.left.kind === "Index" && tree.right.kind === "Index");
}

console.log("\nwhat it still cannot read");
{
  // 字段访问进来之后，字段上的调用也就跟着通了。
  const tree = attempt(() => mine("obj.field(1)"));
  ok("a call on a field is read", !tree.error && tree.value.kind === "Call" && tree.value.callee.kind === "Field",
    tree.error || JSON.stringify(tree.value));
}
{
  const tree = attempt(() => mine("r.name"));
  ok("field access is read as a field", !tree.error && tree.value.kind === "Field" && tree.value.name === "name",
    tree.error || JSON.stringify(tree.value));
}
{
  const tree = attempt(() => mine("if a { 1 } else { 2 }"));
  ok("if is still just a name", !tree.error && tree.value.kind === "Ident" && tree.value.text === "if");
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
