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
  return { kind: "other:" + node.kind };
}
const theirs = (source) => {
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
  const same = !m.error && !t.error && JSON.stringify(m.value) === JSON.stringify(t.value);
  ok(source, same, m.error || t.error || (JSON.stringify(m.value) + " vs " + JSON.stringify(t.value)));
}

console.log("\nthe parts, spelled out");
{
  const tree = mine("f(1, 2)");
  ok("a call keeps its callee and its arguments in order", tree.kind === "call" && tree.callee.kind === "name" && tree.args.length === 2, JSON.stringify(tree));
}
{
  const tree = mine("g()");
  ok("a call with no arguments has an empty argument list", tree.kind === "call" && tree.args.length === 0, JSON.stringify(tree));
}
{
  const tree = mine("t[i + 1]");
  ok("the subscript keeps an expression, not just a name", tree.kind === "index" && tree.index.kind === "bin", JSON.stringify(tree));
}
{
  const tree = mine("f(1)[0]");
  ok("a call can be subscripted", tree.kind === "index" && tree.target.kind === "call", JSON.stringify(tree));
}
{
  const tree = mine("f(t[0]) * 2");
  ok("they nest inside arithmetic as expected", tree.kind === "bin" && tree.left.kind === "call" && tree.left.args[0].kind === "index", JSON.stringify(tree));
}
{
  const tree = mine("t[0] + t[1]");
  ok("two subscripts add", tree.kind === "bin" && tree.left.kind === "index" && tree.right.kind === "index");
}

console.log("\nwhat it still cannot read");
{
  // 字段访问进来之后，字段上的调用也就跟着通了。
  const tree = attempt(() => mine("obj.field(1)"));
  ok("a call on a field is read", !tree.error && tree.value.kind === "call" && tree.value.callee.kind === "field",
    tree.error || JSON.stringify(tree.value));
}
{
  const tree = attempt(() => mine("r.name"));
  ok("field access is read as a field", !tree.error && tree.value.kind === "field" && tree.value.name === "name",
    tree.error || JSON.stringify(tree.value));
}
{
  const tree = attempt(() => mine("if a { 1 } else { 2 }"));
  ok("if is still just a name", !tree.error && tree.value.kind === "name" && tree.value.text === "if");
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
