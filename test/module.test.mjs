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
  // beta 要写 pub：它被另一个模块调用，而可见性检查会拒绝没有 pub 的跨模块调用
  // （HMYR-R0250）。这与 minimal-eval 那条是同一件事（2026-11-02）。
  const beta = write("beta.hmoca", "pub fn beta() -> Int { return 2 }\nfn shared() -> Int { return 1 }\n");
  const alpha = write("alpha.hmoca", 'import "./beta.hmoca"\n\nfn alpha() -> Int { return beta() }\nfn shared() -> Int { return 9 }\n');
  {
    const unit = loadUnit(alpha);
    ok("it loads", unit.ok, unit.diagnostics.items.map((d) => d.code + " " + d.message).join("; "));
    ok("the imported file comes before the importer", unit.order.length === 2 && path.basename(unit.order[0]) === "beta.hmoca", describeUnit(unit));
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
    const conflicts = unit.diagnostics.items.filter((d) => d.code === "HMYR-載-004");
    ok("two modules declaring 'shared' is a warning", conflicts.length === 1, conflicts.map((d) => d.message).join(" | "));
    ok("and the message names both files", /beta\.hmoca/.test(conflicts[0]?.message || "") && /alpha\.hmoca/.test(conflicts[0]?.message || ""), conflicts[0]?.message);
  }

  console.log("\nloaded once, however many times it is asked for");
  const gamma = write("gamma.hmoca", 'import "./beta.hmoca"\n\nfn gamma() -> Int { return beta() }\n');
  const root = write("root.hmoca", 'import "./alpha.hmoca"\nimport "./gamma.hmoca"\n\nfn root() -> Int { return alpha() + gamma() }\n');
  {
    const unit = loadUnit(root);
    const betaCount = unit.order.filter((f) => path.basename(f) === "beta.hmoca").length;
    ok("a file imported by two others is loaded once", betaCount === 1, describeUnit(unit));
    ok("and appears after both of its importers' needs are known", unit.order.indexOf(beta) < unit.order.indexOf(gamma), describeUnit(unit));
    // beta and alpha really do both declare shared, so one warning is right; what must not happen is the
    // same pair being reported again because beta was reached twice.
    ok("a conflict reached twice is still reported once", unit.diagnostics.items.filter((d) => d.code === "HMYR-載-004").length === 1,
      unit.diagnostics.items.filter((d) => d.code === "HMYR-載-004").map((d) => d.message).join(" | "));
  }

  console.log("\ncircular imports are refused");
  const left = write("left.hmoca", 'import "./right.hmoca"\n\nfn left() -> Int { return 1 }\n');
  const right = write("right.hmoca", 'import "./left.hmoca"\n\nfn right() -> Int { return 2 }\n');
  {
    const unit = loadUnit(left);
    ok("a cycle is an error", codes(unit).includes("HMYR-載-001"), codes(unit).join(","));
    ok("and it says which file was already being loaded", /left\.hmoca|right\.hmoca/.test(unit.diagnostics.items.find((d) => d.code === "HMYR-載-001")?.message || ""),
      unit.diagnostics.items.find((d) => d.code === "HMYR-載-001")?.message);
    ok("it does not load forever", unit.order.length <= 2, describeUnit(unit));
  }

  console.log("\nwhat it refuses to guess about");
  {
    const missing = write("missing.hmoca", 'import "./nowhere.hmoca"\n\nfn missing() -> Int { return 0 }\n');
    const unit = loadUnit(missing);
    ok("a missing file is an error", codes(unit).includes("HMYR-載-003"), codes(unit).join(","));
  }
  {
    const pkg = write("pkg.hmoca", 'import "std/io"\n\nfn pkg() -> Int { return 0 }\n');
    const unit = loadUnit(pkg);
    ok("a package import is noted, not guessed at", codes(unit).includes("HMYR-載-002"), codes(unit).join(","));
    ok("and it is not an error yet", unit.ok, codes(unit).join(","));
  }

  console.log("\nthe package entry comes before the file that imports it");
  {
    // 后序：依赖排在前。包入口也算依赖 —— 而它以前根本不在 order 里（包名被跳过），
    // 所以这一条从来没被测过（2026-11-02）。两档都要给同一个次序。
    const 根 = path.join(SCRATCH, "包根");
    fs.mkdirSync(path.join(根, "工具包"), { recursive: true });
    fs.writeFileSync(path.join(根, "hmyr.hmkit"), "[]", "utf8");
    fs.writeFileSync(
      path.join(根, "工具包", "hmyr.hmkit"),
      JSON.stringify({ 名字: "工具包", 版本: 1, 许可: "CZGD-PL-1.1", 哈希: "sha256:" + "0".repeat(64) }),
      "utf8",
    );
    fs.writeFileSync(path.join(根, "工具包", "index.hmoca"), "pub fn 加(a: Int, b: Int) -> Int {\n  return a + b\n}\n", "utf8");
    const 包入口 = path.join(根, "main-pkg.hmoca");
    fs.writeFileSync(包入口, 'import "工具包"\n\nfn main() -> Int {\n  return 0\n}\n', "utf8");
    const unit = loadUnit(包入口);
    const 名们 = unit.order.map((f) => path.basename(f));
    const 包位 = 名们.indexOf("index.hmoca");
    const 主位 = 名们.indexOf("main-pkg.hmoca");
    ok("the package is in the order at all", 包位 >= 0, JSON.stringify(名们));
    ok("and its entry comes first", 包位 >= 0 && 主位 >= 0 && 包位 < 主位, JSON.stringify(名们));
  }

  console.log("\nthe real thing: the bootstrapping files");
  {
    // self/lex.hmoca and self/chain.hmoca both define slice, is_space and starts_with. The loader should
    // report that when they are loaded as one unit - which is the finding that made step one necessary.
    // chain.hmoca now declares its dependency on lex.hmoca, so the no-dependency case has to be a file
    // that genuinely has none.
    const unit = loadUnit(path.join(ROOT, "kpb/piece.hmoca"));
    ok("a file with no imports loads on its own", unit.ok, codes(unit).join(","));
    ok("and brings nothing else with it", unit.order.length === 1, describeUnit(unit));
    const chained = loadUnit(path.join(ROOT, "self/chain.hmoca"));
    ok("a file that declares a dependency brings it along", chained.order.length === 2 &&
      chained.order.some((f) => f.endsWith("lex.hmoca")), describeUnit(chained));
  }
} finally {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
