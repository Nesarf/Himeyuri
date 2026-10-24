// The function body, read by Himeyuri, against the JavaScript reader.
//
// This is the piece the previous seven were building toward: the newline-keeping tokenizer feeds the
// statement reader, and the result is compared statement by statement with the JavaScript parser.
// A reader that agreed on signatures but guessed at bodies would not be worth much.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

const unit = loadUnit(path.join(ROOT, "self/body.hmyr"));
ok("the body reader loads", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
ok("the loader brought the whole chain: lexer, chain, statements, body",
  ["lex.hmyr", "chain.hmyr", "stmt.hmyr", "body.hmyr"].every((f) => unit.order.some((x) => x.endsWith(f))),
  unit.order.map((f) => path.basename(f)).join(", "));

const rt = runUnit(unit);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("there is no function called " + name);
  return rt.callFunction(fn, args, null);
};
const readBody = (source) => {
  const tokens = call("scan_lines", [source]);
  return call("parse_body", [tokens]);
};

/** The JavaScript statement, reduced to the shapes the Himeyuri reader produces. */
function jsShape(node) {
  if (!node) return [];
  if (node.kind === "Binary") return { kind: "Binary", op: node.op, left: jsShape(node.left), right: jsShape(node.right) };
  if (node.kind === "Literal" && node.type === "int") return { kind: "Literal", text: node.raw };
  if (node.kind === "Ident") return { kind: "Ident", text: node.name };
  return { kind: "other:" + node.kind };
}
function jsBody(source) {
  const diagnostics = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(source, {}).tokens, { diagnostics });
  if (diagnostics.errors.length) throw new Error("the JavaScript parser refused: " + diagnostics.errors[0].code);
  const body = ast.decls[0].body;
  if (!body) return [];
  return body.statements.map((s) => {
    if (s.kind === "Let") return { kind: "Let", name: s.name, value: jsShape(s.value) };
    if (s.kind === "Var") return { kind: "Var", name: s.name, value: jsShape(s.value) };
    // 无值的 return 用 nil 节点（与自举那一侧一致）。
    if (s.kind === "Return") return { kind: "Return", value: s.value ? jsShape(s.value) : { kind: "nil" } };
    if (s.kind === "ExprStmt") return { kind: "ExprStmt", value: jsShape(s.expr) };
    return { kind: "other:" + s.kind };
  });
}

const BODIES = [
  "fn f() { }\n",
  "fn f() {\n  let x = 1\n}\n",
  "fn f() {\n  let x = 1 + 2\n  return x\n}\n",
  "fn f() {\n  let a = 1\n\n  let b = 2\n  return a + b * 3\n}\n",
  "fn f() {\n  return\n}\n",
];

console.log("\nbody by body, against the JavaScript reader");
for (const source of BODIES) {
  const mine = attempt(() => readBody(source));
  const theirs = attempt(() => jsBody(source));
  const same = !mine.error && !theirs.error && JSON.stringify(mine.value.list) === JSON.stringify(theirs.value);
  ok(source.split("\n")[0] + " (" + (theirs.value ? theirs.value.length : "-") + " statement(s))", same,
    mine.error || theirs.error || (JSON.stringify(mine.value.list) + " vs " + JSON.stringify(theirs.value)));
}

console.log("\nwhat it still cannot read, said plainly");
{
  // 这些不是脚手架的毛病，而是链的子集边界：self/chain.hmyr 眼下只认 + - * / % 与括号。
  // 每一条都把“当前会读成什么”写下来，于是补链的时候有对照。
  const assign = readBody("fn f() {\n  var n = 7\n  n = n + 1\n  return n\n}\n");
  ok("an assignment now comes through as an assignment", assign.list.length === 3 && assign.list[1].kind === "Assign" && assign.list[1].name === "n",
    JSON.stringify(assign.list));

  const record = readBody("fn f() {\n  let r = {name: \"x\", gain: -3}\n  return r\n}\n");
  ok("a record now comes through as a record", record.list[0].value.kind === "Record" && record.list[0].value.fields.length === 2, JSON.stringify(record.list[0]));

  const tuple = readBody("fn f() {\n  let t = (10, 20)\n  return t\n}\n");
  ok("a tuple now comes through as a tuple", tuple.list[0].value.kind === "Tuple" && tuple.list[0].value.items.length === 2, JSON.stringify(tuple.list[0]));

  const call = readBody("fn f() {\n  print(t[1])\n}\n");
  ok("a call now comes through as a call whose argument is a subscript", call.list[0].value.kind === "Call" && call.list[0].value.args[0].kind === "Index", JSON.stringify(call.list[0]));

  const branch = readBody("fn f() {\n  if a { return 1 }\n  return 2\n}\n");
  ok("if now comes through as an if", branch.list[0].kind === "If" && branch.list[0].then.length === 1, JSON.stringify(branch.list[0]));
}

console.log("\nthe parts of a body");
{
  const body = readBody("fn f() {\n  let x = 1\n  return x\n}\n");
  ok("two statements come out", body.list.length === 2, JSON.stringify(body.list));
  ok("the first is a binding with its name", body.list[0].kind === "Let" && body.list[0].name === "x");
  ok("the second is a return carrying the name", body.list[1].kind === "Return" && body.list[1].value.kind === "Ident");
  ok("and the body is marked as found", body.found === true);
}
{
  const body = readBody("fn f() {\n  let r = {name: \"x\", gain: -3}\n  return r\n}\n");
  ok("a record inside a statement does not end the body early", body.list.length === 2, JSON.stringify(body.list));
}
{
  const body = readBody("fn f() { }\n");
  ok("an empty body is no statements", body.list.length === 0 && body.found === true);
}
{
  const body = readBody("fn f() {\n  let a = 1\n\n\n  let b = 2\n}\n");
  ok("blank lines are skipped", body.list.length === 2, JSON.stringify(body.list));
}
{
  const body = readBody("fn plain() -> Int\n");
  ok("a declaration with no body says so", body.found === false, JSON.stringify(body));
}

console.log("\nthe depth is arranged, not lucky");
{
  const lines = Array.from({ length: 60 }, (_, i) => "  let v" + i + " = " + i).join("\n");
  const body = attempt(() => readBody("fn f() {\n" + lines + "\n}\n"));
  ok("sixty statements in one body parse", !body.error && body.value.list.length === 60,
    body.error || String(body.value ? body.value.list.length : "-"));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
