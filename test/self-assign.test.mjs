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
// 位置与原文不参与比较；Ident 与 Literal 各归一到一个字段。
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    if (v.kind === "名") return { kind: "名", name: v.name !== undefined ? v.name : v.text };
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

const unit = loadUnit(path.join(ROOT, "self/stmt.hmoca"));
ok("the statement reader loads", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const readStatement = (source) => {
  const tokens = rt.callFunction(rt.functions.get("scan"), [source], null);
  return rt.callFunction(rt.functions.get("parse_statement"), [tokens], null).node;
};

/** The JavaScript statement, reduced to the same shapes. */
function jsShape(node) {
  if (!node) return null;
  if (node.kind === "二元") return { kind: "二元", op: node.op, left: jsShape(node.left), right: jsShape(node.right) };
  if (node.kind === "字" && node.type === "int") return { kind: "字", type: "int", text: node.raw };
  if (node.kind === "名") return { kind: "名", text: node.name };
  if (node.kind === "调用") return { kind: "调用", callee: jsShape(node.callee), args: node.args.map(jsShape) };
  if (node.kind === "Index") return { kind: "Index", target: jsShape(node.target), index: jsShape(node.index) };
  if (node.kind === "Field") {
    const target = node.target !== undefined ? node.target : node.object;
    const name = node.name !== undefined ? node.name : node.field;
    return { kind: "Field", target: jsShape(target), name: name };
  }
  return { kind: "other:" + node.kind };
}
function jsStatement(source) {
  const diagnostics = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex("fn t() {\n  " + source + "\n}\n", {}).tokens, { diagnostics });
  if (diagnostics.errors.length) throw new Error("the JavaScript parser refused: " + diagnostics.errors[0].code);
  const s = ast.decls[0].body.statements[0];
  if (s.kind === "赋值") {
    // the JavaScript node names its target differently from ours, so accept the spellings rather than
    // guessing once and being wrong once (which is what happened the first time)
    const target = s.target !== undefined ? s.target : (s.name !== undefined ? s.name : s.left);
    const name = typeof target === "string" ? target : (target && (target.name !== undefined ? target.name : target.text));
    return { kind: "赋值", name: name, value: jsShape(s.value) };
  }
  if (s.kind === "定") return { kind: "定", name: s.name, value: jsShape(s.value) };
  if (s.kind === "变") return { kind: "变", name: s.name, value: jsShape(s.value) };
  if (s.kind === "返回") return { kind: "返回", value: s.value ? jsShape(s.value) : [] };
  if (s.kind === "表达式语句") return { kind: "表达式语句", value: jsShape(s.expr) };
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
  const same = !m.error && !t.error && JSON.stringify(canon(m.value)) === JSON.stringify(canon(t.value));
  ok(source, same, m.error || t.error || (JSON.stringify(canon(m.value)) + " vs " + JSON.stringify(canon(t.value))));
}

console.log("\nthe parts, spelled out");
{
  const node = readStatement("n = n + 1");
  ok("an assignment keeps the name on the left", node.kind === "赋值" && node.name === "n", JSON.stringify(node));
  ok("and a tree on the right", node.value.kind === "二元" && node.value.op === "+", JSON.stringify(node.value));
}
{
  const node = readStatement("value = t[i]");
  ok("a subscript works on the right of an assignment", node.value.kind === "Index", JSON.stringify(node));
}
{
  // "=" and "==" must not be confused: the tokenizer keeps them as different tokens
  const node = readStatement("x == y");
  ok("comparison is not read as an assignment", node.kind === "表达式语句", JSON.stringify(node));
}
{
  const node = readStatement("let x = 1");
  ok("a binding is still a binding, not an assignment", node.kind === "定", JSON.stringify(node));
}

console.log("\nwhat it still cannot read");
{
  const node = attempt(() => readStatement("r.x = 2"));
  ok("assigning to a field is not there yet: it reads as an expression statement", !node.error && node.value.kind === "表达式语句", node.error || JSON.stringify(node.value));
}
{
  const node = attempt(() => readStatement("t[0] = 1"));
  ok("assigning through a subscript is not there yet either", !node.error && node.value.kind === "表达式语句", node.error || JSON.stringify(node.value));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
