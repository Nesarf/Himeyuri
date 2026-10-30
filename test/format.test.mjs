// The formatter's acceptance: a printer is only trustworthy if what it writes parses back to the same
// tree, and if writing it again changes nothing. Both are checked here against real sources - the two
// KPB pieces among them, so M6 is verified on M4's material.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.mjs";
import { parse, PRECEDENCE } from "../src/parser.mjs";
import { format } from "../src/format.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// Positions are stripped: the printer is allowed to move a node to another line, and comparing line
// numbers would report a difference where the tree is the same. Shape is what a round trip promises.
const stripPositions = (node) => {
  if (Array.isArray(node)) return node.map(stripPositions);
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) if (k !== "line" && k !== "column") out[k] = stripPositions(v);
    return out;
  }
  return node;
};
const tree = (source) => {
  const diagnostics = { items: [], errors: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(source, {}).tokens, { diagnostics });
  return stripPositions(ast);
};

const SOURCES = {
  "the specification's example": `import "std/path"

pub fn read(p: Path) -> Bytes effects(file) {
  let a = arena()
  let b = a.alloc(16)
  a.close()
  return b
}
`,
  "an expression-heavy program": `fn main() {
  let x = 1 + 2 * 3 - 4 / 2
  let y = (1 + 2) * (3 - 4)
  let z = a && b || !c
  print(x + y + z)
}
`,
  "records, tuples and control flow": `fn pick(n: Int) -> Int {
  if n > 10 { return 1 } else if n > 3 { return 2 } else { return 3 }
}

fn main() {
  let strip = {name: "lead", gain: -3, pan: -20}
  let t = (1, 2, 3)
  let r = pick(5)
  print(match r {
    1 => "big",
    _ => "small",
  })
}
`,
  "generics, defaults, contracts": `pub fn f(a: Map<K, V>, b: Int? = 4) -> Bytes effects(file, net) requires a != nil ensures b > 0 {
  return a
}
`,
  "subscripts, assignment, raw strings": `fn main() {
  var n = 1
  n = n + 41
  let t = (10, 20)
  let s = r"raw\\n"
  print(t[1])
}
`,
};

console.log("round trip: parse, print, parse again");
for (const [label, source] of Object.entries(SOURCES)) {
  const first = tree(source);
  const printed = format(source, { quiet: true });
  if (!printed.text) { ok(label, false, printed.diagnostics.items.map((d) => d.code).join(",")); continue; }
  const second = tree(printed.text);
  ok(label, JSON.stringify(first) === JSON.stringify(second),
    JSON.stringify(second).length === JSON.stringify(first).length ? "" : "the trees differ");
}

console.log("\nidempotence: printing the printed text changes nothing");
for (const [label, source] of Object.entries(SOURCES)) {
  const once = format(source, { quiet: true }).text;
  const twice = format(once, { quiet: true }).text;
  ok(label, once === twice, once === twice ? "" : "the second pass differs");
}

console.log("\ncanonical form: how it was written does not matter");
{
  const a = format("fn main() {\n  print(1+2)\n}\n", { quiet: true }).text;
  const b = format("fn main()   {\n\n\tprint( 1  +  2 )\n}\n", { quiet: true }).text;
  ok("two writings of the same program print the same", a === b, a === b ? "" : JSON.stringify(a) + " vs " + JSON.stringify(b));
}
{
  const a = format('fn main() {\n  let r = {a: 1, b: 2}\n}\n', { quiet: true }).text;
  const b = format('fn main() {\n  let r = {\n    a: 1,\n    b: 2,\n  }\n}\n', { quiet: true }).text;
  ok("a short record collapses to one line either way", a === b, a === b ? "" : JSON.stringify(a) + " vs " + JSON.stringify(b));
}

console.log("\nthe KPB pieces survive a formatting round trip");
for (const name of ["piece.hmoca", "etude.hmoca"]) {
  const file = path.join(ROOT, "kpb", name);
  const source = fs.readFileSync(file, "utf8");
  const printed = format(source, { quiet: true }).text;
  ok(name + " prints", typeof printed === "string" && printed.length > 0);
  ok(name + " keeps its tree", JSON.stringify(tree(source)) === JSON.stringify(tree(printed)));
  ok(name + " prints the same twice", format(printed, { quiet: true }).text === printed);
}

console.log("\nwhat the printer does not do yet, said out loud");
{
  const withComments = "// a note\nfn main() {\n  /* and another */\n  print(1)\n}\n";
  const r = format(withComments);
  const codes = r.diagnostics.items.map((d) => d.code);
  ok("dropping comments is reported, not silent", codes.includes("HMYR-形-007"));
  ok("and the count is in the message", /2 comment/.test(r.diagnostics.items.map((d) => d.message).join(" ")));
  ok("the program still prints", typeof r.text === "string" && r.text.includes("print(1)"));
}

console.log("\nthe printer and the parser agree about precedence");
{
  // The two tables must stay identical, or the printer would bracket differently from how the parser
  // binds - the classic formatter bug that silently changes meaning.
  const source = fs.readFileSync(path.join(ROOT, "src/format.mjs"), "utf8");
  ok("the formatter imports the parser's table rather than copying it", /import \{ parse, PRECEDENCE \}/.test(source));
  ok("there are " + PRECEDENCE.length + " levels", PRECEDENCE.length >= 4 && PRECEDENCE.every((row) => Array.isArray(row) && row.length));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
