// Keeping the newlines: the tokenizer reads a piece either way, and the difference is one token kind.
//
// The chain, the statement reader and the signature reader all lose statement boundaries today because
// the tokenizer treats a newline as whitespace. This adds a second entry point that keeps them, without
// changing the first one, so the six existing comparisons stay exactly as they were.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.mjs";
import { loadUnit, runUnit } from "../tools/self-bridge.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const attempt = (fn) => { try { return { value: fn() }; } catch (e) { return { error: (e.code || "") + " " + e.message }; } };

const unit = loadUnit(path.join(ROOT, "self/lex.hmyr"));
ok("the tokenizer loads", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("there is no function called " + name);
  return rt.callFunction(fn, args, null);
};

const SOURCE = "let x = 1\nlet y = 2\n\n// a note\nlet z = 3\n";

console.log("\nthe old entry point is untouched");
{
  const tokens = call("scan", [SOURCE]);
  ok("scan still reports no newline tokens", !tokens.some((t) => t.kind === "newline"), JSON.stringify(tokens.map((t) => t.kind)));
  ok("and the same number of real tokens as before", tokens.length === 12, String(tokens.length));
}

console.log("\nthe new entry point keeps them");
{
  const tokens = call("scan_lines", [SOURCE]);
  const newlines = tokens.filter((t) => t.kind === "newline");
  ok("newlines come through as tokens", newlines.length > 0, String(newlines.length));
  ok("and each one carries a text", newlines.every((t) => typeof t.text === "string"));
}
{
  // the JavaScript tokenizer counts newlines the same way, so the two can be compared directly
  const theirs = lex(SOURCE, {}).tokens.filter((t) => t.type === "newline").length;
  const mine = call("scan_lines", [SOURCE]).filter((t) => t.kind === "newline").length;
  ok("the same number of newlines as the JavaScript tokenizer", mine === theirs, mine + " vs " + theirs);
}
{
  const tokens = call("scan_lines", ["fn f() {\n  let a = 1\n  let b = 2\n}\n"]);
  const kinds = tokens.map((t) => t.kind).join(",");
  ok("a block's lines are separable", tokens.filter((t) => t.kind === "newline").length === 4, kinds);
  ok("the braces and names are still there", tokens.some((t) => t.text === "{") && tokens.some((t) => t.text === "a"));
}
{
  const tokens = call("scan_lines", ["a\n\nb"]);
  ok("a blank line is its own newline", tokens.filter((t) => t.kind === "newline").length === 2, JSON.stringify(tokens.map((t) => t.kind)));
}
{
  const tokens = call("scan_lines", ["// only a comment\n"]);
  ok("a comment's line still ends with a newline", tokens.filter((t) => t.kind === "newline").length === 1, JSON.stringify(tokens.map((t) => t.kind)));
}
{
  const tokens = call("scan_lines", ["x"]);
  ok("a piece with no newline has none", tokens.filter((t) => t.kind === "newline").length === 0);
}

console.log("\nnothing else moved");
{
  const both = [call("scan", [SOURCE]), call("scan_lines", [SOURCE])];
  const strip = (list) => list.filter((t) => t.kind !== "newline").map((t) => t.kind + ":" + t.text).join(",");
  ok("the two entry points agree once newlines are left out", strip(both[0]) === strip(both[1]), strip(both[0]).slice(0, 60));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
