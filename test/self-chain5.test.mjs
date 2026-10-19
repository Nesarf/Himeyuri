// The chain grows once more: field access, which belongs in the postfix layer beside calls and
// subscripts. With it, `obj.field(1)` reads as a call on a field rather than stopping at the dot.
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

const unit = loadUnit(path.join(ROOT, "self/chain.hmyr"));
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
  if (node.kind === "Binary") return { kind: "bin", op: node.op, left: jsShape(node.left), right: jsShape(node.right) };
  if (node.kind === "Literal" && node.type === "int") return { kind: "num", text: node.raw };
  if (node.kind === "Literal" && node.type === "string") return { kind: "str", text: node.value };
  if (node.kind === "Ident") return { kind: "name", text: node.name };
  if (node.kind === "Unary") return { kind: "unary", op: node.op, operand: jsShape(node.operand) };
  if (node.kind === "Tuple") return { kind: "tuple", items: node.items.map(jsShape) };
  if (node.kind === "Record") return { kind: "record", fields: node.fields.map((f) => ({ name: f.name, value: jsShape(f.value) })) };
  if (node.kind === "Call") return { kind: "call", callee: jsShape(node.callee), args: node.args.map(jsShape) };
  if (node.kind === "Index") return { kind: "index", target: jsShape(node.target), index: jsShape(node.index) };
  if (node.kind === "Field") {
    // the JavaScript node names its parts differently from ours, so accept either spelling here
    const target = node.target !== undefined ? node.target : node.object;
    const name = node.name !== undefined ? node.name : node.field;
    return { kind: "field", target: jsShape(target), name: name };
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
  "r.name",
  "a.b.c",
  "r.name + 1",
  "f().x",
  "t[0].y",
  "r.a.b.c.d",
  "obj.field(1)",
  "x.y[2]",
];

console.log("\nfield access, against the JavaScript parser");
for (const source of CASES) {
  const m = attempt(() => mine(source));
  const t = attempt(() => theirs(source));
  const same = !m.error && !t.error && JSON.stringify(m.value) === JSON.stringify(t.value);
  ok(source, same, m.error || t.error || (JSON.stringify(m.value) + " vs " + JSON.stringify(t.value)));
}

console.log("\nthe parts, spelled out");
{
  const tree = mine("r.name");
  ok("a field keeps its target and its name", tree.kind === "field" && tree.target.kind === "name" && tree.name === "name", JSON.stringify(tree));
}
{
  const tree = mine("a.b.c");
  ok("fields chain left to right", tree.kind === "field" && tree.target.kind === "field" && tree.name === "c", JSON.stringify(tree));
}
{
  const tree = mine("obj.field(1)");
  ok("a field can be called", tree.kind === "call" && tree.callee.kind === "field" && tree.callee.name === "field", JSON.stringify(tree));
}
{
  const tree = mine("x.y[2]");
  ok("a field can be subscripted", tree.kind === "index" && tree.target.kind === "field", JSON.stringify(tree));
}
{
  const tree = mine("f().x");
  ok("a call result can have a field", tree.kind === "field" && tree.target.kind === "call", JSON.stringify(tree));
}

console.log("\nwhat it still cannot read");
{
  const tree = attempt(() => mine("if a { 1 } else { 2 }"));
  ok("if is still just a name", !tree.error && tree.value.kind === "name" && tree.value.text === "if", tree.error || JSON.stringify(tree.value));
}
{
  const tree = attempt(() => mine("n = n + 1"));
  ok("an assignment is still read as a bare name", !tree.error && tree.value.kind === "name" && tree.value.text === "n", tree.error || JSON.stringify(tree.value));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
