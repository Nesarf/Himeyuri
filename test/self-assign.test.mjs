// Assignment: a statement, not an expression, so it belongs to the statement reader rather than to the
// chain. The recognition is small on purpose - read an expression, and if it turned out to be a bare
// name followed by "=", it was an assignment.
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

const unit = loadUnit(path.join(ROOT, "self/stmt.hmyr"));
ok("the statement reader loads", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const readStatement = (source) => {
  const tokens = rt.callFunction(rt.functions.get("scan"), [source], null);
  return rt.callFunction(rt.functions.get("parse_statement"), [tokens], null).node;
};

/** The JavaScript statement, reduced to the same shapes. */
function jsShape(node) {
  if (!node) return null;
  if (node.kind === "Binary") return { kind: "bin", op: node.op, left: jsShape(node.left), right: jsShape(node.right) };
  if (node.kind === "Literal" && node.type === "int") return { kind: "num", text: node.raw };
  if (node.kind === "Ident") return { kind: "name", text: node.name };
  if (node.kind === "Call") return { kind: "call", callee: jsShape(node.callee), args: node.args.map(jsShape) };
  if (node.kind === "Index") return { kind: "index", target: jsShape(node.target), index: jsShape(node.index) };
  if (node.kind === "Field") {
    const target = node.target !== undefined ? node.target : node.object;
    const name = node.name !== undefined ? node.name : node.field;
    return { kind: "field", target: jsShape(target), name: name };
  }
  return { kind: "other:" + node.kind };
}
function jsStatement(source) {
  const diagnostics = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex("fn t() {\n  " + source + "\n}\n", {}).tokens, { diagnostics });
  if (diagnostics.errors.length) throw new Error("the JavaScript parser refused: " + diagnostics.errors[0].code);
  const s = ast.decls[0].body.statements[0];
  if (s.kind === "Assign") {
    // the JavaScript node names its target differently from ours, so accept the spellings rather than
    // guessing once and being wrong once (which is what happened the first time)
    const target = s.target !== undefined ? s.target : (s.name !== undefined ? s.name : s.left);
    const name = typeof target === "string" ? target : (target && (target.name !== undefined ? target.name : target.text));
    return { kind: "assign", name: name, value: jsShape(s.value) };
  }
  if (s.kind === "Let") return { kind: "let", name: s.name, value: jsShape(s.value) };
  if (s.kind === "Var") return { kind: "var", name: s.name, value: jsShape(s.value) };
  if (s.kind === "Return") return { kind: "return", value: s.value ? jsShape(s.value) : [] };
  if (s.kind === "ExprStmt") return { kind: "expr", value: jsShape(s.expr) };
  return { kind: "other:" + s.kind };
}

const CASES = [
  "n = n + 1",
  "x = 1",
  "total = a * b + c",
  "counter = counter + f(1)",
  "value = t[i]",
];

console.log("\nassignments, against the JavaScript reader");
for (const source of CASES) {
  const m = attempt(() => readStatement(source));
  const t = attempt(() => jsStatement(source));
  const same = !m.error && !t.error && JSON.stringify(m.value) === JSON.stringify(t.value);
  ok(source, same, m.error || t.error || (JSON.stringify(m.value) + " vs " + JSON.stringify(t.value)));
}

console.log("\nthe parts, spelled out");
{
  const node = readStatement("n = n + 1");
  ok("an assignment keeps the name on the left", node.kind === "assign" && node.name === "n", JSON.stringify(node));
  ok("and a tree on the right", node.value.kind === "bin" && node.value.op === "+", JSON.stringify(node.value));
}
{
  const node = readStatement("value = t[i]");
  ok("a subscript works on the right of an assignment", node.value.kind === "index", JSON.stringify(node));
}
{
  // "=" and "==" must not be confused: the tokenizer keeps them as different tokens
  const node = readStatement("x == y");
  ok("comparison is not read as an assignment", node.kind === "expr", JSON.stringify(node));
}
{
  const node = readStatement("let x = 1");
  ok("a binding is still a binding, not an assignment", node.kind === "let", JSON.stringify(node));
}

console.log("\nwhat it still cannot read");
{
  const node = attempt(() => readStatement("r.x = 2"));
  ok("assigning to a field is not there yet: it reads as an expression statement", !node.error && node.value.kind === "expr", node.error || JSON.stringify(node.value));
}
{
  const node = attempt(() => readStatement("t[0] = 1"));
  ok("assigning through a subscript is not there yet either", !node.error && node.value.kind === "expr", node.error || JSON.stringify(node.value));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
