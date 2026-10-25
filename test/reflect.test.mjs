// Reflection's acceptance. It answers the questions an editor will ask, and it is checked on the same
// material everything else is checked on - the KPB pieces - so a change to the grammar shows up here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { outline, symbols, references } from "../src/reflect.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const tree = (source) => parse(lex(source, {}).tokens, { diagnostics: { add() {}, error() {}, warn() {}, items: [], errors: [], warnings: [] } }).ast;

console.log("what is declared here");
{
  const view = outline(fs.readFileSync(path.join(ROOT, "kpb/piece.hmoca"), "utf8"), "piece.hmoca");
  const names = view.symbols.map((s) => s.name);
  ok("the functions are found", ["note", "track", "strip", "main"].every((n) => names.includes(n)), names.join(","));
  ok("each carries its line", view.symbols.every((s) => typeof s.line === "number" && s.line > 0));
  const note = view.symbols.find((s) => s.name === "note");
  ok("parameters with their types", note.params.length === 3 && note.params[0].type === "Int" && note.params[0].name === "key");
  ok("the return type", note.returns === "Int");
  ok("main is found and has no effects", view.symbols.find((s) => s.name === "main").effects.length === 0);
}
{
  const source = 'import "std/io" as io\n\ntype Pair<T> = (T, T)\n\npub const N = 4\n\neffect file\n\npub fn f(own a: Bytes, b: Int? = 1) -> Pair<Int> effects(file, net) requires a != nil ensures b > 0 {\n  fn inner(x: Int) -> Int { return x }\n  return (b, b)\n}\n';
  const view = outline(source, "synthetic.hmoca");
  const by = (n) => view.symbols.find((s) => s.name === n);
  ok("imports with aliases", view.imports.length === 1 && view.imports[0].alias === "io");
  ok("a type alias with a parameter", by("Pair") && by("Pair").kind === "type" && by("Pair").params.length === 1);
  ok("a constant", by("N") && by("N").kind === "const" && by("N").pub === true);
  ok("an effect declaration", by("file") && by("file").kind === "effect");
  ok("a function with everything", by("f") && by("f").params[0].passing === "own" && by("f").params[1].hasDefault === true &&
    by("f").returns === "Pair<Int>" && by("f").effects.join(",") === "file,net" && by("f").contracts.requires === 1 && by("f").contracts.ensures === 1);
  ok("a function declared inside another says whose it is", by("inner") && by("inner").nestedIn === "f");
}

console.log("\nwhere a name is used");
{
  const ast = tree(fs.readFileSync(path.join(ROOT, "kpb/etude.hmoca"), "utf8"));
  const uses = references(ast, "note");
  ok("calls to note are found", uses.filter((u) => u.use === "call").length >= 2, JSON.stringify(uses));
  ok("each use carries a line", uses.every((u) => typeof u.line === "number" && u.line > 0));
  ok("the declaration itself is not counted as a call", uses.every((u) => u.line !== 6));
}
{
  const ast = tree("fn f() -> Int { return 1 }\nfn g() -> Int { return f() }\nfn h() -> Int { return f() + f() }\n");
  ok("every call site is reported", references(ast, "f").filter((u) => u.use === "call").length === 3);
}
{
  const ast = tree('fn main() {\n  let r = {name: "x"}\n  print(r.name)\n}\n');
  ok("field reads are distinguished from calls", references(ast, "name").some((u) => u.use === "field"));
}

console.log("\nthe refusals are not silently swallowed");
{
  const bad = outline("fn f( {\n", "broken.hmoca");
  ok("a broken file still answers with what it could parse", Array.isArray(bad.symbols));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
