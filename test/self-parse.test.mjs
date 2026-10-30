// M7's third acceptance: the expression parser written in Himeyuri against the one written in
// JavaScript. The comparison is on shape only - positions are stripped from both sides, and the
// JavaScript tree is mapped to the same three shapes the small parser produces.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Runtime } from "../src/eval.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

function load() {
  // 这一份源码故意不带 main：self/fmt.hmoca 要 import 它，两个 main 合在一起只有一个能活。
  // 而 Runtime.run 要求有入口，所以在测试这一侧补一个空的。
  const source = fs.readFileSync(path.join(ROOT, "self/parse.hmoca"), "utf8") + "\nfn main() -> Int { return 0 }\n";
  const diagnostics = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(source, {}).tokens, { diagnostics });
  if (diagnostics.errors.length) return { ok: false, errors: diagnostics.errors.map((e) => e.code + " " + e.message) };
  const rt = new Runtime({});
  rt.run(ast);
  return { ok: true, rt };
}
const loaded = load();
console.log("the parser written in Himeyuri loads");
ok("it parses", loaded.ok, loaded.ok ? "" : loaded.errors.join("; "));

/** The JavaScript tree, reduced to the three shapes the small parser knows. */
function jsShape(node) {
  if (!node) return null;
  if (node.kind === "二元") return { kind: "二元", op: node.op, left: jsShape(node.left), right: jsShape(node.right) };
  if (node.kind === "字" && node.type === "int") return { kind: "字", type: "int", text: node.raw };
  if (node.kind === "名") return { kind: "名", text: node.name };
  if (node.kind === "一元") return { kind: "一元", op: node.op, operand: jsShape(node.operand) };
  return { kind: "other:" + node.kind };
}

function jsExpr(source) {
  const diagnostics = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex("fn t() {\n  let r = " + source + "\n}\n", {}).tokens, { diagnostics });
  if (diagnostics.errors.length) return { error: diagnostics.errors[0].code };
  return { node: jsShape(ast.decls[0].body.statements[0].value) };
}

function myShape(source) {
  if (!loaded.ok) return null;
  const result = loaded.rt.callFunction(loaded.rt.functions.get("parse"), [source], null);
  return { node: result.node, next: result.next };
}

const CASES = [
  "1",
  "x",
  "1 + 2",
  "1 + 2 * 3",
  "(1 + 2) * 3",
  "a - b - c",
  "a * b / c % d",
  "1 + 2 + 3 + 4",
  "x * (y + 1)",
  "((7))",
  "12 + 34 * (56 - 7)",
];

console.log("\nit agrees with the JavaScript parser, shape by shape");
for (const source of CASES) {
  const mine = myShape(source);
  const theirs = jsExpr(source);
  const same = JSON.stringify(canon(mine.node)) === JSON.stringify(canon(theirs.node));
  ok(source, same, same ? "" : JSON.stringify(mine.node) + " vs " + JSON.stringify(theirs.node));
}

console.log("\nprecedence and association, spelled out");
{
  const tree = myShape("1 + 2 * 3").node;
  ok("multiplication binds tighter", tree.kind === "二元" && tree.op === "+" && tree.right.op === "*");
}
{
  const tree = myShape("a - b - c").node;
  ok("subtraction is left-associative", tree.kind === "二元" && tree.op === "-" && tree.left.op === "-" && tree.left.left.kind === "名" && tree.left.left.text === "a");
}
{
  const tree = myShape("(1 + 2) * 3").node;
  ok("brackets change the shape", tree.op === "*" && tree.left.op === "+");
}
{
  const tree = myShape("((7))").node;
  ok("redundant brackets leave the shape alone", tree.kind === "字" && tree.text === "7");
}

console.log("\nthe depth is arranged, not lucky");
{
  // The whole point of this piece: the recursion depth is a constant, so a long expression - 200
  // additions - is a matter of the tail loops, not of nesting.
  const long = Array.from({ length: 200 }, (_, i) => String(i)).join(" + ");
  const mine = myShape(long);
  ok("two hundred additions in one expression parse", mine && mine.node.kind === "二元", mine ? mine.node.kind : "none");
  let theirs = null;
  try { theirs = jsExpr(long).node; } catch (e) { theirs = { error: String(e.message) }; }
  ok("and the shape matches the JavaScript one", JSON.stringify(canon(mine.node)) === JSON.stringify(canon(theirs)), JSON.stringify(theirs).slice(0, 80));
}
{
  const deep = "(".repeat(60) + "1" + ")".repeat(60);
  const mine = myShape(deep);
  ok("sixty nested brackets parse", mine && mine.node.kind === "字" && mine.node.text === "1", mine ? JSON.stringify(mine.node).slice(0, 60) : "none");
}

console.log("\nwhat it does not do, said out loud");
{
  const tree = myShape("-1").node;
  ok("a unary minus is not understood yet, and is reported as such", tree.kind === "Error", JSON.stringify(tree));
}
{
  const mine = myShape("1 + 2");
  ok("it reports where it stopped", typeof mine.next === "number" && mine.next === 5, String(mine.next));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
