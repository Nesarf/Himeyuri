// The chain's acceptance, rebuilt with diagnosis in it.
//
// The previous scaffold lost the process to an error somewhere inside its own comparison, which told us
// nothing. Here every step is wrapped, so a failure arrives as one failing check with the reason
// attached - and the two comparison roads are kept in separate evaluators, because putting same-named
// helpers in one flat table is the very thing this milestone is about.
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

console.log("the loader brings the tokenizer in with the chain");
const unit = loadUnit(path.join(ROOT, "self/chain.hmoca"));
ok("it loads", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
ok("the dependency was followed", unit.order.length === 2 && unit.order.some((f) => f.endsWith("lex.hmoca")),
  unit.order.map((f) => path.basename(f)).join(", "));
{
  const conflicts = unit.diagnostics.items.filter((d) => d.code === "HMYR-載-004");
  ok("shared helper names are reported rather than hidden", conflicts.length > 0, String(conflicts.length) + " warning(s)");
  ok("and each warning names both files", conflicts.every((d) => /lex\.hmoca/.test(d.message) && /chain\.hmoca/.test(d.message)));
}

const chainRt = runUnit(unit);
const call = (name, args) => chainRt.callFunction(chainRt.functions.get(name), args, null);

// the string-based parser lives in its own evaluator on purpose
const parseUnit = loadUnit(path.join(ROOT, "self/parse.hmoca"));
const parseRt = runUnit(parseUnit);
const parseCall = (name, args) => parseRt.callFunction(parseRt.functions.get(name), args, null);

/** The JavaScript tree, reduced to the shapes the small pieces produce. */
function jsShape(node) {
  if (!node) return null;
  if (node.kind === "二元") return { kind: "二元", op: node.op, left: jsShape(node.left), right: jsShape(node.right) };
  if (node.kind === "字" && node.type === "int") return { kind: "字", type: "int", text: node.raw };
  if (node.kind === "名") return { kind: "名", text: node.name };
  return { kind: "other:" + node.kind };
}
function jsExpr(source) {
  const diagnostics = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex("fn t() {\n  let r = " + source + "\n}\n", {}).tokens, { diagnostics });
  if (diagnostics.errors.length) throw new Error("the JavaScript parser refused: " + diagnostics.errors[0].code);
  return jsShape(ast.decls[0].body.statements[0].value);
}

const EXPRESSIONS = ["1", "x", "1 + 2", "1 + 2 * 3", "(1 + 2) * 3", "a - b - c",
  "a * b / c % d", "1 + 2 + 3 + 4", "x * (y + 1)", "((7))", "12 + 34 * (56 - 7)", "a + b * c - d / e"];

console.log("\nthe chain, step by step, with the reason attached when a step fails");
for (const source of EXPRESSIONS) {
  const tokens = attempt(() => call("scan", [source]));
  if (tokens.error) { ok("tokenize: " + source, false, tokens.error); continue; }
  const viaChain = attempt(() => call("chain", [tokens.value]).node);
  if (viaChain.error) { ok("parse the tokens: " + source, false, viaChain.error); continue; }
  const viaString = attempt(() => parseCall("parse", [source]).node);
  const viaJs = attempt(() => jsExpr(source));

  ok("tokens -> tree: " + source, !viaString.error && JSON.stringify(canon(viaChain.value)) === JSON.stringify(canon(viaString.value)),
    viaString.error || (JSON.stringify(viaChain.value) + " vs " + JSON.stringify(viaString.value)));
  ok("tokens -> tree matches JavaScript: " + source, !viaJs.error && JSON.stringify(canon(viaChain.value)) === JSON.stringify(canon(viaJs.value)),
    viaJs.error || (JSON.stringify(viaChain.value) + " vs " + JSON.stringify(viaJs.value)));
}

console.log("\nthe token shape the parser relies on");
{
  const tokens = call("scan", ["1 + 2 * 3"]);
  ok("each token carries a kind and a text", tokens.every((t) => typeof t.kind === "string" && typeof t.text === "string"));
  ok("punctuation keeps its own kind", tokens.filter((t) => t.kind === "punct").map((t) => t.text).join("") === "+*");
  const tree = call("chain", [tokens]).node;
  ok("and the tree has the right shape", tree.op === "+" && tree.right.op === "*");
}

console.log("\nwhat it refuses to guess");
{
  const empty = attempt(() => call("chain", [[]]));
  ok("an empty token stream is refused, not guessed", !empty.error && empty.value.node.kind === "误", empty.error || JSON.stringify(empty.value));
}
{
  const unbalanced = attempt(() => call("chain", [[{ kind: "punct", text: "(", line: 1, column: 1 }, { kind: "int", text: "1", line: 1, column: 2 }]]));
  ok("a missing closing bracket stops at the right place", !unbalanced.error && unbalanced.value.next === 2, unbalanced.error || JSON.stringify(unbalanced.value));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
