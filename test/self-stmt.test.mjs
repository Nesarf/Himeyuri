// Statement-level acceptance: the Himeyuri statement reader against the JavaScript one, shape by shape.
//
// The chain and the tokenizer come in through the loader, because stmt.hmoca says what it depends on.
// The JavaScript side is reduced to the same four shapes, and positions are dropped from both.
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
    if (v.kind === "字") {
      const 原 = v.value !== undefined ? v.value : (v.text !== undefined ? v.text : v.raw);
      return { kind: "字", type: v.type, value: v.type === "int" ? Number(原) : 原 };
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

console.log("the loader brings the whole dependency chain in");
const unit = loadUnit(path.join(ROOT, "self/stmt.hmoca"));
ok("it loads", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
ok("three files arrive: lexer, chain, statements",
  unit.order.length === 3 && unit.order.some((f) => f.endsWith("lex.hmoca")) && unit.order.some((f) => f.endsWith("chain.hmoca")),
  unit.order.map((f) => path.basename(f)).join(", "));
ok("the dependency order puts the dependency first", unit.order.findIndex((f) => f.endsWith("lex.hmoca")) < unit.order.findIndex((f) => f.endsWith("chain.hmoca")));

const rt = runUnit(unit);
const call = (name, args) => rt.callFunction(rt.functions.get(name), args, null);
const readStatement = (source) => {
  const tokens = call("scan", [source]);
  return call("parse_statement", [tokens]).node;
};

/** The JavaScript statement, reduced to the same shapes. */
function jsStatement(source) {
  const diagnostics = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex("fn t() {\n  " + source + "\n}\n", {}).tokens, { diagnostics });
  if (diagnostics.errors.length) throw new Error("the JavaScript parser refused: " + diagnostics.errors[0].code);
  const stmt = ast.decls[0].body.statements[0];
  const shape = (node) => {
    if (!node) return null;
    if (node.kind === "Binary") return { kind: "Binary", op: node.op, left: shape(node.left), right: shape(node.right) };
    if (node.kind === "字" && node.type === "int") return { kind: "字", type: "int", text: node.raw };
    if (node.kind === "Ident") return { kind: "Ident", text: node.name };
    return { kind: "other:" + node.kind };
  };
  if (stmt.kind === "Let") return { kind: "Let", name: stmt.name, value: shape(stmt.value) };
  if (stmt.kind === "Var") return { kind: "Var", name: stmt.name, value: shape(stmt.value) };
  // 无值的 return 用 nil 节点：空元组是一个值，而「没有值」不是值，两者不能混。
  if (stmt.kind === "Return") return { kind: "Return", value: stmt.value ? shape(stmt.value) : { kind: "nil" } };
  if (stmt.kind === "ExprStmt") return { kind: "ExprStmt", value: shape(stmt.expr) };
  return { kind: "other:" + stmt.kind };
}

const STATEMENTS = [
  "let x = 1 + 2",
  "let total = a * b + c",
  "var n = 7",
  "var deep = (1 + 2) * (3 - 4)",
  "return 42",
  "return a + b",
  "a + b * c",
];

console.log("\none statement at a time, against the JavaScript reader");
for (const source of STATEMENTS) {
  const mine = attempt(() => readStatement(source));
  const theirs = attempt(() => jsStatement(source));
  const same = !mine.error && !theirs.error && JSON.stringify(canon(mine.value)) === JSON.stringify(canon(theirs.value));
  ok(source, same,
    mine.error || theirs.error || (JSON.stringify(canon(mine.value)) + " vs " + JSON.stringify(canon(theirs.value))));
}

console.log("\nthe parts of a statement");
{
  const node = readStatement("let x = 1 + 2");
  ok("a binding keeps the name", node.name === "x", JSON.stringify(node));
  ok("and the value is a tree", node.value && node.value.kind === "Binary" && node.value.op === "+");
}
{
  const node = readStatement("return");
  // 无值的 return 带一个 nil 节点：空元组是一个值，而「没有值」不是值。
  ok("a bare return carries no value", node.kind === "Return" && node.value && node.value.kind === "nil", JSON.stringify(node));
}
{
  const node = readStatement("a + b");
  ok("a bare expression is an expression statement", node.kind === "ExprStmt" && node.value.kind === "Binary");
}

console.log("\nwhat it refuses to guess");
{
  // A call is not in this subset yet: the chain knows + - * / % and brackets, nothing else. The
  // statement reader reads the name and stops at the bracket, which is honest rather than clever.
  const node = readStatement("f(1)");
  ok("a call is now read as a call", node.kind === "ExprStmt" && node.value.kind === "Call" && node.value.args.length === 1, JSON.stringify(node));
}
{
  const node = attempt(() => readStatement(""));
  ok("an empty line is refused", !node.error && node.value.kind === "Error", node.error || JSON.stringify(node.value));
}
{
  const node = readStatement("let x 1");
  ok("a binding without '=' is refused", node.kind === "Error", JSON.stringify(node));
}
{
  const node = attempt(() => call("parse_statement", [[]]));
  ok("an empty token stream is refused", !node.error && node.value.node.kind === "Error", node.error || JSON.stringify(node.value));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
