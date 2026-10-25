// M7's first acceptance: a front-end piece written in Himeyuri agrees with the one written in
// JavaScript. Agreement is the whole point - a bootstrapped component that quietly disagrees with the
// original is worse than none, because nobody would notice.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanText, scanFile, loadScanner } from "../self/host.mjs";
import { outline } from "../src/reflect.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

console.log("the scanner written in Himeyuri loads and runs");
{
  const loaded = loadScanner();
  ok("it parses", loaded.ok, loaded.ok ? "" : loaded.diagnostics.items.map((d) => d.code + " " + d.message).join("; "));
  ok("it declares no effects, so it cannot read anything by itself",
    loaded.ok && (loaded.runtime.functions.get("scan")?.effects || []).length === 0);
}

console.log("\nit finds what the JavaScript reflector finds");
const AGREEMENT = ["kpb/piece.hmoca", "kpb/etude.hmoca", "self/scan.hmoca"];
for (const rel of AGREEMENT) {
  const file = path.join(ROOT, rel);
  const mine = scanFile(file);
  const theirs = outline(fs.readFileSync(file, "utf8"), rel).symbols
    .filter((s) => ["fn", "type", "const", "effect"].includes(s.kind))
    .map((s) => ({ kind: s.kind, name: s.name, line: s.line }));
  if (!mine.ok) { ok(rel + " scans", false, mine.diagnostics.items.map((d) => d.code).join(",")); continue; }

  // Nested declarations are a symbol to the reflector and a line to the scanner, so a nested function
  // also appears as its own line; compare the sets rather than the orders.
  const key = (s) => s.kind + " " + s.name + " @" + s.line;
  const mineSet = new Set(mine.found.map(key));
  const theirsSet = new Set(theirs.map(key));
  const onlyMine = [...mineSet].filter((k) => !theirsSet.has(k));
  const onlyTheirs = [...theirsSet].filter((k) => !mineSet.has(k));

  ok(rel + ": every declaration agrees, name and line", onlyMine.length === 0 && onlyTheirs.length === 0,
    "only scan: " + onlyMine.join(", ") + " | only reflect: " + onlyTheirs.join(", "));
  ok(rel + ": it found something", mine.found.length > 0, String(mine.found.length));
}

console.log("\na file longer than one piece, so the split is exercised");
{
  const long = Array.from({ length: 260 }, (_, i) => "fn f" + i + "() -> Int { return " + i + " }").join("\n\n") + "\n";
  const result = scanText(long, 1);
  ok("it scans without running out of depth", result.ok, result.ok ? "" : result.diagnostics.items.map((d) => d.code + " " + d.message).join("; "));
  ok("every one of the 260 declarations is found", result.ok && result.found.length === 260, String(result.ok ? result.found.length : "-"));
  // the declarations are two lines apart, so the 256th sits at 1 + 255 * 2
  ok("and the line numbers follow the pieces", result.ok && result.found[255].line === 1 + 255 * 2, String(result.ok ? result.found[255].line : "-"));
}

console.log("\nwhat it reads, and what it does not");
{
  const result = scanText('fn a() -> Int { return 1 }\nlet x = 1\n// fn hidden() {}\ntype T = Int\n', 1);
  ok("plain declarations are found", result.ok && result.found.map((s) => s.name).join(",") === "a,T", JSON.stringify(result.found));
  ok("a commented line is not mistaken for a declaration", !result.found.some((s) => s.name === "hidden"));
  ok("a let is not a declaration", !result.found.some((s) => s.kind === "const" && s.name === "x"));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
