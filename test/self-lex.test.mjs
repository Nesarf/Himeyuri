// M7's second acceptance: the tokenizer written in Himeyuri against the one written in JavaScript.
//
// The comparison is at a stated granularity, because the two do not claim the same thing yet:
//   - keywords count as identifiers on the Himeyuri side, so the JavaScript side's keywords are folded
//     in with its identifiers
//   - strings keep their source text on the Himeyuri side and are unescaped on the JavaScript side, so
//     only the kind is compared for those
// Everything else - kinds and texts, in order - must agree exactly.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Runtime } from "../src/eval.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

function loadLexer() {
  const file = path.join(ROOT, "self/lex.hmyr");
  const source = fs.readFileSync(file, "utf8");
  const diagnostics = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(source, {}).tokens, { diagnostics });
  if (diagnostics.errors.length) return { ok: false, errors: diagnostics.errors.map((e) => e.code + " " + e.message) };
  const rt = new Runtime({});
  rt.run(ast);
  return { ok: true, rt };
}

const loaded = loadLexer();
console.log("the tokenizer written in Himeyuri loads");
ok("it parses", loaded.ok, loaded.ok ? "" : loaded.errors.join("; "));

function mineTokens(text) {
  if (!loaded.ok) return null;
  return loaded.rt.callFunction(loaded.rt.functions.get("scan"), [text], null)
    .map((t) => ({ kind: t.kind, text: t.text }));
}

function theirTokens(text) {
  return lex(text, {}).tokens
    .filter((t) => t.type !== "newline" && t.type !== "eof" && t.type !== "doc")
    // keywords fold into identifiers and floats into integers: the Himeyuri side does not separate
    // them yet, and the boundary is stated in that file rather than hidden in this comparison
    .map((t) => ({ kind: t.type === "keyword" ? "ident" : t.type === "float" ? "int" : t.type, text: t.type === "string" ? null : String(t.raw ?? t.value) }));
}

const SAMPLES = {
  "a declaration": "fn note(key: Int, start: Int, length: Int) -> Int {\n  return (key, start, length)\n}\n",
  "expressions and operators": "let x = 1 + 2 * 3 - 4 / 2\nlet y = a && b || !c\nlet z = a == b && c != d && e <= f && g >= h\n",
  "punctuation and arrows": "fn f(a: Int) -> Int { return a }\nmatch x {\n  1 => \"one\",\n  _ => \"many\",\n}\n",
  "numbers with separators": "let big = 1_000_000\nlet based = 0x1F\nlet frac = 3.5\n",
  "comments are skipped": "// leading\nlet x = 1 // trailing\n/* block */ let y = 2\n",
  "strings and raw strings": "let a = \"hello\"\nlet b = r\"raw\"\n",
  "records and subscripts": "let r = {name: \"x\", gain: -3}\nlet t = (10, 20)\nprint(t[1])\n",
};

console.log("\nit agrees with the JavaScript tokenizer, token by token");
for (const [label, source] of Object.entries(SAMPLES)) {
  const mine = mineTokens(source);
  const theirs = theirTokens(source);
  if (!mine) { ok(label, false, "the Himeyuri tokenizer did not load"); continue; }
  const sameLength = mine.length === theirs.length;
  const firstDiff = mine.findIndex((t, i) => !theirs[i] || t.kind !== theirs[i].kind || (theirs[i].text !== null && t.text !== theirs[i].text));
  ok(label, sameLength && firstDiff < 0,
    sameLength
      ? (firstDiff < 0 ? "" : "first difference at " + firstDiff + ": " + JSON.stringify(mine[firstDiff]) + " vs " + JSON.stringify(theirs[firstDiff]))
      : "counts differ: " + mine.length + " vs " + theirs.length + "  " + JSON.stringify(mine.slice(0, 6)) + " | " + JSON.stringify(theirs.slice(0, 6)));
}

console.log("\nit is bounded, and the bound is stated rather than discovered");
{
  // One recursion level per token means the depth limit is a real ceiling on how long a piece may be.
  // The host splits a file for the line scanner; for now this tokenizer is honest about the ceiling and
  // the test pins it from both sides.
  const many = Array.from({ length: 100 }, (_, i) => "let x" + i + " = " + i).join("\n");
  const result = mineTokens(many);
  ok("a piece of 100 lines (400 tokens) scans", Array.isArray(result) && result.length === 100 * 4, String(result ? result.length : "none"));
}
{
  const huge = Array.from({ length: 300 }, (_, i) => "let x" + i + " = " + i).join("\n");
  // 这一条原来钉「三百条 let 撞深度」。尾调用之后它过得去了——
  // 那说明能力提升了，不是断言失效，于是改成钉「现在过得去」。
  // 哪天又撞了，它会红，而那时读这一句的人会知道自己撞的是回归而不是新边界。
  let code = null;
  try { mineTokens(huge); } catch (e) { code = e.code || null; }
  ok("three hundred lets now get through (tail calls ate that depth)", code === null, String(code));
}
{
  const nested = "let s = \"" + "a".repeat(400) + "\"\n";
  const result = mineTokens(nested);
  ok("a long string does not break the depth either", Array.isArray(result) && result.length === 4, JSON.stringify(result));
}

console.log("\nthe two boundaries it states about itself are real");
{
  const mine = mineTokens("fn f() { return 1 }\n");
  ok("keywords come back as identifiers", mine.some((t) => t.kind === "ident" && t.text === "fn") && mine.some((t) => t.kind === "ident" && t.text === "return"));
}
{
  const mine = mineTokens('let a = "a\\nb"\n');
  const stringToken = mine.find((t) => t.kind === "string");
  ok("a string keeps its source text, escapes and all", stringToken && stringToken.text === "a\\nb", JSON.stringify(stringToken));
}
{
  const mine = mineTokens("let x = 1 // trailing\n");
  ok("a trailing comment is skipped", mine.length === 4, JSON.stringify(mine));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
