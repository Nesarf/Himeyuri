// Signature-level acceptance: the Himeyuri signature reader against the JavaScript one.
//
// What is compared is the signature - pub, name, parameters with their types, the return type, the
// effects. The body is deliberately out of scope (see the note at the top of self/sig.hmyr): the
// tokenizer drops newlines, and newlines are what separate statements. A reader that pretended to
// understand bodies would be inventing statement boundaries it cannot see.
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

const unit = loadUnit(path.join(ROOT, "self/sig.hmyr"));
ok("the signature reader loads", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const readRaw = (source) => {
  const tokens = rt.callFunction(rt.functions.get("scan"), [source], null);
  return rt.callFunction(rt.functions.get("read_signature"), [tokens], null);
};
// Reading is wrapped: a reader that throws or hands back nothing becomes a value the assertions can
// describe, instead of taking the whole scaffold down and leaving no reason behind.
const read = (source) => {
  const r = attempt(() => readRaw(source));
  if (r.error) return { kind: "err", text: "reader threw: " + r.error };
  if (!r.value || typeof r.value !== "object") return { kind: "err", text: "reader returned " + JSON.stringify(r.value) };
  return r.value;
};

function jsTypeName(t) {
  if (!t) return "";
  if (t.kind === "TypeRef") return t.name + (t.nullable ? "?" : "");
  return t.kind;
}
function jsSignature(source) {
  const diagnostics = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(source, {}).tokens, { diagnostics });
  if (diagnostics.errors.length) throw new Error("the JavaScript parser refused: " + diagnostics.errors[0].code);
  const fn = ast.decls[0];
  return {
    kind: "fn",
    pub: !!fn.pub,
    name: fn.name,
    params: fn.params.map((p) => ({ name: p.name, type: jsTypeName(p.type) })),
    returns: fn.returns ? jsTypeName(fn.returns) : "",
    effects: fn.effects || [],
    hasBody: !!fn.body,
  };
}

const SIGNATURES = [
  "fn f() { }\n",
  "fn f() -> Int { return 1 }\n",
  "pub fn g() { }\n",
  "fn h(a: Int) { }\n",
  "fn h(a: Int, b: Bytes) { }\n",
  "fn h(own a: Bytes, borrow b: Bytes) { }\n",
  "pub fn read(p: Path) -> Bytes effects(file) { return p }\n",
  "fn both(a: Int) -> Int effects(file, net) { return a }\n",
  "fn maybe(x: Int?) -> Int? { return x }\n",
  "fn plain() -> Int\n",
];

console.log("\nsignature by signature, against the JavaScript reader");
for (const source of SIGNATURES) {
  const mine = attempt(() => read(source));
  const theirs = attempt(() => jsSignature(source));
  const same = !mine.error && !theirs.error && JSON.stringify(mine.value) === JSON.stringify(theirs.value);
  ok(source.trim().slice(0, 46), same, mine.error || theirs.error || (JSON.stringify(mine.value) + " vs " + JSON.stringify(theirs.value)));
}

console.log("\nthe parts of a signature");
{
  const sig = read("pub fn read(own p: Path, n: Int) -> Bytes effects(file, net) { return p }\n");
  ok("pub is kept", sig.pub === true);
  ok("the name is kept", sig.name === "read");
  ok("own is skipped, the types are kept",
    sig.params.length === 2 && sig.params[0].name === "p" && sig.params[0].type === "Path" && sig.params[1].type === "Int",
    JSON.stringify(sig.params));
  ok("the return type is kept", sig.returns === "Bytes");
  ok("both effects are kept", sig.effects.join(",") === "file,net");
  ok("and the presence of a body is noted", sig.hasBody === true);
}
{
  const sig = read("fn maybe(x: Int?) -> Int? { return x }\n");
  ok("a nullable parameter keeps its mark", sig.params[0].type === "Int?", JSON.stringify(sig.params));
  ok("and so does a nullable return", sig.returns === "Int?", sig.returns);
}

console.log("\nwhat it does not do, said out loud");
{
  const sig = read("fn withDefault(a: Int = 4) -> Int { return a }\n");
  ok("a parameter default is skipped, not recorded", sig.params.length === 1 && sig.params[0].name === "a", JSON.stringify(sig.params));
}
{
  const sig = read("fn body(x: Int) -> Int { let y = x + 1 return y }\n");
  ok("the body is not cut into statements (the tokenizer drops the newlines it would need)",
    sig.kind === "fn" && sig.hasBody === true && !("body" in sig));
}

console.log("\nwhat it refuses to guess");
{
  const sig = read("let x = 1\n");
  ok("something that is not a function is refused", sig.kind === "err", JSON.stringify(sig));
}
{
  const sig = read("fn broken\n");
  ok("a function without a parameter list is refused", sig.kind === "err", JSON.stringify(sig));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
