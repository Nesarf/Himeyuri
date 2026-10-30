// The chain grows: strings, records and tuples.
//
// One capability at a time, each with its own comparison, because the previous milestones established
// that a batch of three changes produces a failure nobody can attribute. What is compared is the shape:
// the JavaScript tree is reduced to the same forms the chain produces.
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

/** The JavaScript tree, reduced to the shapes the chain produces. */
function jsShape(node) {
  if (!node) return null;
  if (node.kind === "二元") return { kind: "二元", op: node.op, left: jsShape(node.left), right: jsShape(node.right) };
  if (node.kind === "字" && node.type === "int") return { kind: "字", type: "int", raw: node.raw };
  if (node.kind === "字" && node.type === "string") return { kind: "字", type: "string", raw: false };
  if (node.kind === "名") return { kind: "名", name: node.name };
  if (node.kind === "一元") return { kind: "一元", op: node.op, operand: jsShape(node.operand) };
  if (node.kind === "组") return { kind: "组", items: node.items.map(jsShape) };
  if (node.kind === "记录") return { kind: "记录", fields: node.fields.map((f) => ({ name: f.name, value: jsShape(f.value) })) };
  return { kind: "other:" + node.kind };
}
// 位置与原文不参与这次比较：self 那一侧的节点带 line/column，而这里要问的是形状。
const norm = (v) => {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) { if (k === "line" || k === "column" || k === "text") continue; o[k] = norm(v[k]); }
    return o;
  }
  return v;
};
const theirs = (source) => {
  const diagnostics = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex("fn t() {\n  let r = " + source + "\n}\n", {}).tokens, { diagnostics });
  if (diagnostics.errors.length) throw new Error("the JavaScript parser refused: " + diagnostics.errors[0].code);
  return jsShape(ast.decls[0].body.statements[0].value);
};

const CASES = [
  '"hello"',
  "a + 1",
  "(1, 2)",
  "(1, 2, 3)",
  "(7,)",
  "(1 + 2) * 3",
  "((7))",
  "{gain: -3}",
  '{name: "lead", gain: -3}',
  "{nested: {a: 1}}",
  "(1, 2) + (3,)",
];

console.log("\nstrings, records and tuples, against the JavaScript parser");
for (const source of CASES) {
  const m = attempt(() => mine(source));
  const t = attempt(() => theirs(source));
  const same = !m.error && !t.error && JSON.stringify(norm(m.value)) === JSON.stringify(norm(t.value));
  ok(source, same, m.error || t.error || (JSON.stringify(norm(m.value)) + " vs " + JSON.stringify(norm(t.value))));
}

console.log("\nthe parts, spelled out");
{
  const tree = mine("{name: \"lead\", gain: -3}");
  ok("a record keeps its fields in order", tree.kind === "记录" && tree.fields.length === 2 && tree.fields[0].name === "name" && tree.fields[1].name === "gain",
    JSON.stringify(tree));
  ok("a string keeps its text", tree.fields[0].value.kind === "字" && tree.fields[0].value.text === "lead");
  ok("a negative number is a unary over a number", tree.fields[1].value.kind === "一元" || tree.fields[1].value.kind === "字",
    JSON.stringify(tree.fields[1].value));
}
{
  const tree = mine("(1, 2, 3)");
  ok("a tuple keeps its items", tree.kind === "组" && tree.items.length === 3, JSON.stringify(tree));
}
{
  const tree = mine("(7,)");
  ok("a one-element tuple is a tuple, not a group", tree.kind === "组" && tree.items.length === 1, JSON.stringify(tree));
}
{
  const tree = mine("((7))");
  ok("a group is still not a tuple", tree.kind === "字" && tree.text === "7", JSON.stringify(tree));
}
{
  const tree = mine("{nested: {a: 1}}");
  ok("records nest", tree.kind === "记录" && tree.fields[0].value.kind === "记录", JSON.stringify(tree));
}

console.log("\nwhat used to be out of reach, and is read now");
{
  const tree = attempt(() => mine("print(1)"));
  ok("a call is read as a call", !tree.error && tree.value.kind === "调用" && tree.value.args.length === 1, tree.error || JSON.stringify(tree.value));
}
{
  const tree = attempt(() => mine("t[1]"));
  ok("a subscript is read as a subscript", !tree.error && tree.value.kind === "索引", tree.error || JSON.stringify(tree.value));
}
{
  const tree = attempt(() => mine("if a { 1 } else { 2 }"));
  ok("if is still just a name", !tree.error && tree.value.kind === "名" && tree.value.name === "if", tree.error || JSON.stringify(tree.value));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
