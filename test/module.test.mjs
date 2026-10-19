// The loader's acceptance: the three things step one promises, each checked on real files rather than
// on the description of them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit, describeUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const codes = (unit) => unit.diagnostics.items.map((d) => d.code);

// one scratch directory, cleaned up at the end
// Scratch files belong in the cache area, not the system temp on the system drive.
const SCRATCH = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/hmyr-mod-");
const write = (name, text) => { const f = path.join(SCRATCH, name); fs.writeFileSync(f, text, "utf8"); return f; };

try {
  console.log("a module and what it imports");
  const beta = write("beta.hmyr", "fn beta() -> Int { return 2 }\nfn shared() -> Int { return 1 }\n");
  const alpha = write("alpha.hmyr", 'import "./beta.hmyr"\n\nfn alpha() -> Int { return beta() }\nfn shared() -> Int { return 9 }\n');
  {
    const unit = loadUnit(alpha);
    ok("it loads", unit.ok, unit.diagnostics.items.map((d) => d.code + " " + d.message).join("; "));
    ok("the imported file comes before the importer", unit.order.length === 2 && path.basename(unit.order[0]) === "beta.hmyr", describeUnit(unit));
    ok("and both are there", unit.order.length === 2, describeUnit(unit));
  }
  {
    const unit = loadUnit(alpha);
    const runtime = runUnit(unit);
    const result = runtime.callFunction(runtime.functions.get("alpha"), [], null);
    ok("the importer can call what it imported", result === 2, String(result));
  }

  console.log("\na shared name is reported, not silently overwritten");
  {
    const unit = loadUnit(alpha);
    const conflicts = unit.diagnostics.items.filter((d) => d.code === "HMYR-W0302");
    ok("two modules declaring 'shared' is a warning", conflicts.length === 1, conflicts.map((d) => d.message).join(" | "));
    ok("and the message names both files", /beta\.hmyr/.test(conflicts[0]?.message || "") && /alpha\.hmyr/.test(conflicts[0]?.message || ""), conflicts[0]?.message);
  }

  console.log("\nloaded once, however many times it is asked for");
  const gamma = write("gamma.hmyr", 'import "./beta.hmyr"\n\nfn gamma() -> Int { return beta() }\n');
  const root = write("root.hmyr", 'import "./alpha.hmyr"\nimport "./gamma.hmyr"\n\nfn root() -> Int { return alpha() + gamma() }\n');
  {
    const unit = loadUnit(root);
    const betaCount = unit.order.filter((f) => path.basename(f) === "beta.hmyr").length;
    ok("a file imported by two others is loaded once", betaCount === 1, describeUnit(unit));
    ok("and appears after both of its importers' needs are known", unit.order.indexOf(beta) < unit.order.indexOf(gamma), describeUnit(unit));
    // beta and alpha really do both declare shared, so one warning is right; what must not happen is the
    // same pair being reported again because beta was reached twice.
    ok("a conflict reached twice is still reported once", unit.diagnostics.items.filter((d) => d.code === "HMYR-W0302").length === 1,
      unit.diagnostics.items.filter((d) => d.code === "HMYR-W0302").map((d) => d.message).join(" | "));
  }

  console.log("\ncircular imports are refused");
  const left = write("left.hmyr", 'import "./right.hmyr"\n\nfn left() -> Int { return 1 }\n');
  const right = write("right.hmyr", 'import "./left.hmyr"\n\nfn right() -> Int { return 2 }\n');
  {
    const unit = loadUnit(left);
    ok("a cycle is an error", codes(unit).includes("HMYR-E0301"), codes(unit).join(","));
    ok("and it says which file was already being loaded", /left\.hmyr|right\.hmyr/.test(unit.diagnostics.items.find((d) => d.code === "HMYR-E0301")?.message || ""),
      unit.diagnostics.items.find((d) => d.code === "HMYR-E0301")?.message);
    ok("it does not load forever", unit.order.length <= 2, describeUnit(unit));
  }

  console.log("\nwhat it refuses to guess about");
  {
    const missing = write("missing.hmyr", 'import "./nowhere.hmyr"\n\nfn missing() -> Int { return 0 }\n');
    const unit = loadUnit(missing);
    ok("a missing file is an error", codes(unit).includes("HMYR-E0302"), codes(unit).join(","));
  }
  {
    const pkg = write("pkg.hmyr", 'import "std/io"\n\nfn pkg() -> Int { return 0 }\n');
    const unit = loadUnit(pkg);
    ok("a package import is noted, not guessed at", codes(unit).includes("HMYR-W0301"), codes(unit).join(","));
    ok("and it is not an error yet", unit.ok, codes(unit).join(","));
  }

  console.log("\nthe real thing: the bootstrapping files");
  {
    // self/lex.hmyr and self/chain.hmyr both define slice, is_space and starts_with. The loader should
    // report that when they are loaded as one unit - which is the finding that made step one necessary.
    // chain.hmyr now declares its dependency on lex.hmyr, so the no-dependency case has to be a file
    // that genuinely has none.
    const unit = loadUnit(path.join(ROOT, "kpb/piece.hmyr"));
    ok("a file with no imports loads on its own", unit.ok, codes(unit).join(","));
    ok("and brings nothing else with it", unit.order.length === 1, describeUnit(unit));
    const chained = loadUnit(path.join(ROOT, "self/chain.hmyr"));
    ok("a file that declares a dependency brings it along", chained.order.length === 2 &&
      chained.order.some((f) => f.endsWith("lex.hmyr")), describeUnit(chained));
  }
} finally {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
