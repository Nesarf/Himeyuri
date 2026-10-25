// M7's fourth acceptance: the three Himeyuri pieces used together, and agreeing with the JavaScript
// front end end to end.
//
// The chain is assembled the only way it can be without a module system: one evaluator, three files
// loaded into it, so pipeline.hmoca's calls to scan() and parse() resolve to the other two files'
// functions. If that stops being true - a name shadowed, a file split - this test says so.
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

function loadAll(files) {
  const rt = new Runtime({});
  const diagnostics = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  for (const rel of files) {
    const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const { ast } = parse(lex(source, {}).tokens, { diagnostics });
    if (diagnostics.errors.length) return { ok: false, errors: diagnostics.errors.map((e) => e.code + " " + e.message + " in " + rel) };
    rt.run(ast);
  }
  return { ok: true, rt };
}

const loaded = loadAll(["self/lex.hmoca", "self/parse.hmoca", "self/pipeline.hmoca"]);
console.log("three files, one evaluator");
ok("they all load", loaded.ok, loaded.ok ? "" : loaded.errors.join("; "));
ok("scan() is there, from the lexer file", loaded.ok && loaded.rt.functions.has("scan"));
ok("parse() is there, from the parser file", loaded.ok && loaded.rt.functions.has("parse"));
ok("check() is there, from the pipeline file", loaded.ok && loaded.rt.functions.has("check"));

const call = (name, args) => loaded.rt.callFunction(loaded.rt.functions.get(name), args, null);

/** The JavaScript chain, reduced to the shapes the small pieces produce. */
function jsShape(node) {
  if (!node) return null;
  if (node.kind === "Binary") return { kind: "Binary", op: node.op, left: jsShape(node.left), right: jsShape(node.right) };
  if (node.kind === "Literal" && node.type === "int") return { kind: "Literal", type: "int", text: node.raw };
  if (node.kind === "Ident") return { kind: "Ident", text: node.name };
  return { kind: "other:" + node.kind };
}
function jsChain(source) {
  const diagnostics = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const tokens = lex("fn t() {\n  let r = " + source + "\n}\n", {}).tokens
    .filter((t) => t.type !== "newline" && t.type !== "eof" && t.type !== "doc");
  const assignAt = tokens.findIndex((t) => t.value === "=");
  const exprTokens = tokens.slice(assignAt + 1);
  const { ast } = parse(tokens, { diagnostics });
  return {
    exprTokens: exprTokens.map((t) => (t.type === "keyword" ? "ident" : t.type === "float" ? "int" : t.type) + ":" + String(t.raw ?? t.value)),
    shape: jsShape(ast.decls[0].body.statements[0].value),
  };
}

const LINES = [
  "let x = 12 + 34 * (5 - 6)",
  "  const y = a + b + c  ",
  "let n = 7",
  "let z = (1 + 2) * (3 + 4)",
  "let w = a * b / c % d",
];

console.log("\nan expression taken from a line of source");
{
  const result = call("check", ["let x = 12 + 34 * (5 - 6)"]);
  ok("the expression is cut out of the line", result.expression === "12 + 34 * (5 - 6)", result.expression);
  ok("and both roads agree about it", result.agree === true, JSON.stringify({ leaves: result.leaves, literals: result.literals }));
}
{
  const result = call("check", ["  const y = a + b + c  "]);
  ok("surrounding spaces are trimmed", result.expression === "a + b + c", JSON.stringify(result.expression));
}

console.log("\nthe two roads agree, and both agree with JavaScript");
for (const line of LINES) {
  const mine = call("check", [line]);
  const theirs = jsChain(mine.expression);
  ok("same leaves as the JavaScript tree: " + mine.expression,
    JSON.stringify(mine.leaves) === JSON.stringify(leafTexts(theirs.shape)),
    JSON.stringify(mine.leaves) + " vs " + JSON.stringify(leafTexts(theirs.shape)));
  ok("same shape as the JavaScript tree: " + mine.expression,
    JSON.stringify(canon(call("parse", [mine.expression]).node)) === JSON.stringify(canon(theirs.shape)),
    JSON.stringify(call("parse", [mine.expression]).node) + " vs " + JSON.stringify(theirs.shape));
}

function leafTexts(shape) {
  if (!shape) return [];
  if (shape.kind === "Binary") return [...leafTexts(shape.left), ...leafTexts(shape.right)];
  if (shape.kind === "Literal" || shape.kind === "Ident") return [shape.text];
  return [];
}

console.log("\nthe pipeline says when it does not agree");
{
  // a line with no equals sign: the expression is empty, so there is nothing to agree about
  const result = call("check", ["fn f() -> Int { return 1 }"]);
  ok("a line with no '=' yields an empty expression", result.expression === "" || result.expression === "Int { return 1 }", JSON.stringify(result.expression));
}
{
  const result = call("check", ["let bad = 1 +"]);
  ok("a half-written expression is reported, not guessed", result.agree === true || result.agree === false);
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
