// The last operator layer in the subset: comparison, at precedence 2 - below addition (3), above nothing
// else that exists yet (the logical operators at 0 and 1 are still out).
//
// The precedence comes from the language's own table rather than from taste, which is why the check
// prints it: ==,!=,<,<=,>,>= are level 2 there, so they bind looser than + and -, and tighter than the
// logical operators that are not implemented yet.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 位置与原文不参与比较；Ident 与 Literal 各归一到一个字段。
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
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const attempt = (fn) => { try { return { value: fn() }; } catch (e) { return { error: (e.code || "") + " " + e.message }; } };

const unit = loadUnit(path.join(ROOT, "self/chain.hmyr"));
ok("the chain loads", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("there is no function called " + name);
  return rt.callFunction(fn, args, null);
};
const mine = (source) => call("chain", [call("scan", [source])]).node;

function jsShape(node) {
  if (!node) return null;
  if (node.kind === "Binary") return { kind: "Binary", op: node.op, left: jsShape(node.left), right: jsShape(node.right) };
  if (node.kind === "Literal" && node.type === "int") return { kind: "Literal", type: "int", text: node.raw };
  if (node.kind === "Ident") return { kind: "Ident", text: node.name };
  if (node.kind === "Unary") return { kind: "Unary", op: node.op, operand: jsShape(node.operand) };
  if (node.kind === "Call") return { kind: "Call", callee: jsShape(node.callee), args: node.args.map(jsShape) };
  if (node.kind === "Index") return { kind: "Index", target: jsShape(node.target), index: jsShape(node.index) };
  if (node.kind === "Field") {
    const target = node.target !== undefined ? node.target : node.object;
    const name = node.name !== undefined ? node.name : node.field;
    return { kind: "Field", target: jsShape(target), name: name };
  }
  return { kind: "other:" + node.kind };
}
const theirs = (source) => {
  const diagnostics = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex("fn t() {\n  let r = " + source + "\n}\n", {}).tokens, { diagnostics });
  if (diagnostics.errors.length) throw new Error("the JavaScript parser refused: " + diagnostics.errors[0].code);
  return jsShape(ast.decls[0].body.statements[0].value);
};

const CASES = [
  "a == b",
  "a != b",
  "a < b",
  "a <= b",
  "a > b",
  "a >= b",
  "1 + 2 == 3",
  "a == b + 1",
  "a + b < c * d",
  "(a + b) == (c - d)",
  "f(a) == t[0]",
  "a < b == c",
];

console.log("\ncomparison, against the JavaScript parser");
for (const source of CASES) {
  const m = attempt(() => mine(source));
  const t = attempt(() => theirs(source));
  const same = !m.error && !t.error && JSON.stringify(m.value) === JSON.stringify(t.value);
  ok(source, same, m.error || t.error || (JSON.stringify(m.value) + " vs " + JSON.stringify(t.value)));
}

console.log("\nprecedence, spelled out");
{
  const tree = mine("1 + 2 == 3");
  ok("addition binds tighter than comparison", tree.op === "==" && tree.left.op === "+", JSON.stringify(tree));
}
{
  const tree = mine("a == b + 1");
  ok("and on the right side too", tree.op === "==" && tree.right.op === "+", JSON.stringify(tree));
}
{
  const tree = mine("a == b == c");
  ok("comparison is left associative", tree.op === "==" && tree.left.op === "==", JSON.stringify(tree));
}
{
  const tree = mine("a < b == c");
  ok("mixed comparisons keep the source order", tree.op === "==" && tree.left.op === "<", JSON.stringify(tree));
}

console.log("\nwhere it reaches");
{
  const tree = mine("f(a == b)");
  ok("an argument can be a comparison", tree.kind === "Call" && tree.args[0].op === "==", JSON.stringify(tree));
}
{
  const tree = mine("t[a < b]");
  ok("so can a subscript", tree.kind === "Index" && tree.index.op === "<", JSON.stringify(tree));
}
{
  const tree = mine("{flag: a != b}");
  ok("so can a record value", tree.kind === "Record" && tree.fields[0].value.op === "!=", JSON.stringify(tree));
}

console.log("\nwhat it still cannot read");
{
  const tree = attempt(() => mine("a && b"));
  ok("the logical operators are still out (they are levels 0 and 1)", !tree.error && tree.value.kind === "Ident" && tree.value.text === "a",
    tree.error || JSON.stringify(tree.value));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
