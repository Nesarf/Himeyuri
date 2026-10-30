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
  const same = !m.error && !t.error && JSON.stringify(canon(m.value)) === JSON.stringify(canon(t.value));
  ok(source, same, m.error || t.error || (JSON.stringify(canon(m.value)) + " vs " + JSON.stringify(canon(t.value))));
}

console.log("\nthe parts, spelled out");
{
  const tree = mine("r.name");
  ok("a field keeps its target and its name", tree.kind === "字段" && tree.target.kind === "名" && tree.name === "name", JSON.stringify(tree));
}
{
  const tree = mine("a.b.c");
  ok("fields chain left to right", tree.kind === "字段" && tree.target.kind === "字段" && tree.name === "c", JSON.stringify(tree));
}
{
  const tree = mine("obj.field(1)");
  ok("a field can be called", tree.kind === "调用" && tree.callee.kind === "字段" && tree.callee.name === "field", JSON.stringify(tree));
}
{
  const tree = mine("x.y[2]");
  ok("a field can be subscripted", tree.kind === "索引" && tree.target.kind === "字段", JSON.stringify(tree));
}
{
  const tree = mine("f().x");
  ok("a call result can have a field", tree.kind === "字段" && tree.target.kind === "调用", JSON.stringify(tree));
}

console.log("\nwhat it still cannot read");
{
  const tree = attempt(() => mine("if a { 1 } else { 2 }"));
  ok("if is still just a name", !tree.error && tree.value.kind === "名" && tree.value.text === "if", tree.error || JSON.stringify(tree.value));
}
{
  const tree = attempt(() => mine("n = n + 1"));
  ok("an assignment is still read as a bare name", !tree.error && tree.value.kind === "名" && tree.value.text === "n", tree.error || JSON.stringify(tree.value));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
