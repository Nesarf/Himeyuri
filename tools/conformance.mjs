// The conformance runner - M3.
//
//   node tools/conformance.mjs             run every case, report coverage
//   node tools/conformance.mjs --clause 2.4   only the cases for one clause
//
// Three things come out of it:
//   1. every case run at the stage it declares (lex, parse or run)
//   2. clause coverage read from SPEC.txt itself, so a clause with no case is visible rather than assumed
//   3. the error-code registry checked in both directions against the sources
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { run } from "../src/eval.mjs";
import { CASES } from "../conformance/cases.mjs";
import { CODES } from "../conformance/codes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const only = process.argv.includes("--clause") ? process.argv[process.argv.indexOf("--clause") + 1] : null;

function execute(testCase) {
  if (testCase.stage === "lex") {
    const lexed = lex(testCase.source, { path: testCase.id });
    return { diagnostics: lexed.diagnostics, output: [] };
  }
  if (testCase.stage === "parse") {
    const lexed = lex(testCase.source, { path: testCase.id });
    const parsed = parse(lexed.tokens, { diagnostics: lexed.diagnostics });
    return { diagnostics: parsed.diagnostics, output: [] };
  }
  const result = run(testCase.source, { path: testCase.id });
  return { diagnostics: result.diagnostics, output: result.output };
}

function judge(testCase, observed) {
  const codes = observed.diagnostics.items.map((d) => d.code);
  const errors = observed.diagnostics.errors.map((d) => d.code);
  switch (testCase.expect.kind) {
    case "clean":
      return errors.length === 0 ? null : "expected no error, got " + errors.join(", ");
    case "warning":
      return codes.includes(testCase.expect.code) ? null : "expected warning " + testCase.expect.code;
    case "error":
      return errors.includes(testCase.expect.code) ? null : "expected error " + testCase.expect.code + ", got " + (errors.join(", ") || "none");
    case "output":
      if (JSON.stringify(observed.output) === JSON.stringify(testCase.expect.value)) return null;
      {
        // An output mismatch is usually a diagnostic in disguise, so show it.
        const notes = observed.diagnostics.items.map((d) => d.code + " " + d.message).join("; ");
        return "expected " + JSON.stringify(testCase.expect.value) + ", got " + JSON.stringify(observed.output) + (notes ? "  [" + notes + "]" : "");
      }
    default:
      return "the case declares an expectation this runner does not know";
  }
}

const selected = only ? CASES.filter((c) => c.clause === only) : CASES;
let passed = 0, failed = 0, xfailed = 0, xpassed = 0;
const failures = [];

for (const testCase of selected) {
  const reason = judge(testCase, execute(testCase));
  if (testCase.xfail) {
    if (reason) xfailed++;
    else { xpassed++; failures.push(testCase.id + " " + testCase.title + "  (marked as not implemented, but it passed)"); }
    continue;
  }
  if (reason) { failed++; failures.push(testCase.id + " " + testCase.title + "  " + reason); }
  else passed++;
}

console.log("conformance" + (only ? " (clause " + only + ")" : ""));
console.log("  " + passed + " passed, " + failed + " failed, " + xfailed + " known-missing" + (xpassed ? ", " + xpassed + " unexpectedly passing" : ""));
for (const line of failures) console.log("  [不通过] " + line);

// ---- clause coverage, read from the specification ----
const spec = fs.readFileSync(path.join(ROOT, "SPEC.txt"), "utf8");
const specLines = spec.split("\n");
const declared = new Set();
for (let i = 0; i < specLines.length; i++) {
  // A section heading is the line between two rules of equals signs. Numbered list items inside a
  // clause look the same to a regex but do not sit between rules, which is why this looks at context.
  const betweenRules = /^=+$/.test((specLines[i - 1] || "").trim()) && /^=+$/.test((specLines[i + 1] || "").trim());
  const section = /^(\d+(?:\.\d+)?)\.?\s+\S/.exec(specLines[i]);
  if (betweenRules && section) { declared.add(section[1]); continue; }
  const subsection = /^— (\d+\.\d+) /.exec(specLines[i]);
  if (subsection) declared.add(subsection[1]);
}
// Every clause that declares behaviour is expected to have cases. A clause may be excused, but an
// excuse has to be written down here - "no case yet" is a gap, "no case expected, because ..." is a
// decision, and the difference is the whole point of this list.
const PROSE = new Map([
  ["0", "how to read the document"],
  ["0.5", "the mascot: a person, not a behaviour"],
  ["1", "the use declaration: a statement of intent, nothing to run"],
  ["2", "the chapter heading itself"],
  ["3", "the borrowed-ideas table: confirmed by the standard library existing, not by a case"],
  // 2.7 的判据在五个专门的套件里，而且它们要四台机器都同意 —— 这一份 runner 跑不了那条。
  ["2.7", "the three zones and module-level names: exercised by test/zone, zone-static, zone-self, owned and global-var, which run on four machines rather than through this runner"],
  // 2.8 与 2.9 同理：一个要四套语言档案，一个要真的起线程，这一份 runner 两样都没有。
  ["2.8", "the locale profiles: exercised by test/locale, i18n and corpus, which switch profiles and run whole-table corpora rather than going through this runner"],
  ["2.9", "concurrency: exercised by test/threads-cvm and the thr suites, which need real threads; this runner is synchronous and has none"],
  ["2.10", "the outside world: three facts about strings and buffers, verified by test/c-vm and test/f64; the three open questions have no answers yet, so there is nothing to run"],
  ["2.11", "file types: nine extensions and three directory names, exercised by test/package and test/distro, which build and unpack real packages rather than going through this runner"],
  ["4", "the chapter heading itself"],
  ["4.1", "the not-doing list: prohibitions on syntax, most of which the grammar already makes impossible"],
  ["4.2", "conformance itself: this suite is the evidence"],
  ["4.3", "the stability policy: kept by the versions directory, not by a case"],
  ["5", "milestones: a record of progress"],
  ["6", "open questions: four of six are now decisions; the rest become clauses when they do"],
  ["6.4", "the module-system gap and its plan: a record of what is missing, exercised by test/module.test.mjs"],
  ["6.5", "the design papers: each is dated and marked as a draft, not as terms"],
  ["7", "the relationship to KID: descriptive"],
  ["8", "the open-source position: licence business, verified by the CZGD licence home's own selfcheck.mjs"],
]);
const wanted = [...declared].filter((c) => /^\d(\.\d+)?$/.test(c)).sort();
const covered = new Map();
for (const c of CASES) covered.set(c.clause, (covered.get(c.clause) || 0) + 1);
console.log("");
console.log("clause coverage (every chapter)");
for (const clause of wanted) {
  const n = covered.get(clause) || 0;
  const why = PROSE.get(clause);
  console.log("  " + clause.padEnd(6) + (n ? n + " case(s)" : why ? "no case expected: " + why : "NO CASES YET"));
}
const unexplained = wanted.filter((c) => !covered.get(c) && !PROSE.get(c));
const excused = wanted.filter((c) => !covered.get(c) && PROSE.get(c));
console.log("  " + (unexplained.length ? unexplained.length + " clause(s) with neither a case nor a reason: " + unexplained.join(", ")
  : "every declared clause has cases (" + (wanted.length - excused.length) + ") or a stated reason (" + excused.length + ")"));

// ---- a registered code nobody uses is a code nobody has ever seen work ----
{
  const used = new Set();
  for (const c of CASES) if (c.expect && c.expect.code) used.add(c.expect.code);
  const internal = CODES.filter((c) => c.internal).length;
  // A code can also be exercised somewhere other than the conformance suite - an embedding test, say -
  // and if the registry names that file, the runner checks the file really mentions the code.
  const exercisedElsewhere = (c) => {
    if (!c.checkedBy) return false;
    const file = path.join(ROOT, c.checkedBy);
    return fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(c.code);
  };
  const unexercised = CODES.filter((c) => !c.planned && !c.internal && !used.has(c.code) && !exercisedElsewhere(c)).map((c) => c.code);
  console.log("");
  console.log("codes exercised by the suite");
  console.log("  " + (unexercised.length ? "registered but never exercised: " + unexercised.join(", ")
    : "every code a program can reach is exercised (" + internal + " internal and " + CODES.filter((c) => c.planned).length + " planned are exempt, and say why)"));
  globalThis.__unexercised = unexercised;
}

// ---- the builtins must live inside the declared standard-library ring ----
{
  const evalSource = fs.readFileSync(path.join(ROOT, "src/eval.mjs"), "utf8");
  const block = /const BUILTINS = \{([\s\S]*?)\n\};/.exec(evalSource);
  const names = block ? [...block[1].matchAll(/^  ([a-z_][a-z0-9_]*):/gm)].map((m) => m[1]) : [];
  const spec = fs.readFileSync(path.join(ROOT, "SPEC.txt"), "utf8");
  // The ring is mentioned in the chapter of open questions and again where the standard library is
  // described. A check that reads only the first mention reads the wrong one.
  const ring = [...spec.matchAll(/标准库第一圈[^\n]*/g)].map((m) => m[0]).join("\n");
  const outside = names.filter((n) => !ring.includes(n));
  console.log("");
  console.log("standard library boundary");
  console.log("  " + names.length + " builtin(s) declared in the evaluator");
  console.log("  " + (outside.length ? "outside the declared ring: " + outside.join(", ") : "every builtin falls inside the declared first ring"));
  globalThis.__outside = outside;
}

// ---- the sources must stay portable ----
{
  // What "portable" means here is declared, not assumed: the modules all three runtimes provide
  // (Deno and Bun through node compatibility). readline belongs: reading a line-oriented stdio stream
  // is exactly what an embedded host needs, and all three have it.
  // http 也属于这一类：它只是「起一台本机服务器」用的，而三家的 node 兼容层都有它。
  // 而它出现在哪一个文件里是有讲究的 —— 只在 test/hmget.test.mjs，用来验 http 来源
  // 仍然不联网；src 与 tools 一侧用的是 fetch（全局的，不需要 import）。
  const PORTABLE = new Set(["fs", "path", "url", "crypto", "os", "zlib", "child_process", "readline", "net", "http"]);

// 专有模块：不是三个运行时都有，但某一组能力必须靠它。
// 用了就登记在这里，并且要在 design 里写明为什么——而「登记」不是「视而不见」。
const VENDOR_SPECIFIC = new Set(["worker_threads"]);
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".mjs")) files.push(full);
    }
  };
  for (const sub of ["src", "tools", "test", "kpb", "conformance"]) walk(path.join(ROOT, sub));
  const odd = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/from "node:([a-z_]+)"/g)) if (!PORTABLE.has(m[1]) && !VENDOR_SPECIFIC.has(m[1])) odd.push(m[1] + " in " + path.relative(ROOT, file));
  }
  console.log("");
  console.log("portability of the sources");
  console.log("  " + files.length + " source file(s) scanned");
  console.log("  " + (odd.length ? "modules outside the portable set: " + odd.join(", ") : "only portable built-ins are imported"));
  globalThis.__odd = odd;
}

// ---- the code registry, checked both ways ----
console.log("");
console.log("error-code registry");
const sources = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".mjs")) sources.push(full);
  }
};
// 扫 src 与 tools：两边都会 emit 编号。
//
// 只扫 src 曾经是对的 —— 那时候只有求值器与装载器会报错。现在 tools/hmget.mjs
// 也报（HMYR-載-013 / HMYR-載-014 / HMYR-載-015：来源里没有这个包、哈希不符、目标已存在），
// 而一个「登记了却没人 emit」的误报，正是这一条规则该避免的那种噪声。
walk(path.join(ROOT, "src"));
walk(path.join(ROOT, "tools"));
const emitted = new Set();
for (const file of sources) {
  const text = fs.readFileSync(file, "utf8");
  // 码的形状换过（2026-11-02：从 HMYR-E0101 变成 HMYR-詞-001），所以这里不能再限定
  // [EWR] 加四位数字 —— 那样一个都匹配不到，于是「登记的码一个都没发出」全表飘红。
  // 而放宽成「引号里任意一串」又太宽：startsWith("HMYR-詞-") 那种前缀片段会被当成码。
  // 所以认「HMYR- 开头、以三位数字结尾」—— 两种形状都满足，而前缀片段不满足。
  for (const m of text.matchAll(/"(HMYR-[^\s"]*-\d{3})"/g)) emitted.add(m[1]);
}
const registered = new Set(CODES.map((c) => c.code));
const unregistered = [...emitted].filter((c) => !registered.has(c));
const planned = new Set(CODES.filter((c) => c.planned).map((c) => c.code));
const dead = [...registered].filter((c) => !emitted.has(c) && !planned.has(c));
console.log("  " + registered.size + " registered, " + emitted.size + " emitted by the sources");
console.log("  " + (unregistered.length ? "unregistered: " + unregistered.join(", ") : "every emitted code is registered"));
console.log("  " + (dead.length ? "registered but never emitted: " + dead.join(", ") : "every registered code is emitted, apart from " + planned.size + " reserved for work not done yet"));
const duplicated = CODES.map((c) => c.code).filter((c, i, all) => all.indexOf(c) !== i);
console.log("  " + (duplicated.length ? "registered twice: " + duplicated.join(", ") : "no code is registered twice"));

// SPEC section 2.2 says every grammar point gets a positive and a negative case. The production names
// come from the EBNF itself; the case ids are declared here; the runner checks both that every EBNF
// production appears and that each named case really is positive or negative as claimed.
const PRODUCTION_CASES = new Map([
  ["module", { positive: ["C-0020"], negative: ["C-0021"] }],
  ["decl", { positive: ["C-0022"], negative: ["C-0023"] }],
  ["import", { positive: ["C-0020"], negative: ["C-0021"] }],
  ["fn", { positive: ["C-0022"], negative: ["C-0023"] }],
  ["params", { positive: ["C-0022"], negative: ["C-0023"] }],
  ["param", { positive: ["C-0022"], negative: ["C-0023"] }],
  ["effects", { positive: ["C-0051"], negative: ["C-0050"] }],
  ["contracts", { positive: ["C-0022"], negative: ["C-0028"] }],
  ["type", { positive: ["C-0024"], negative: ["C-0025"] }],
  ["stmt", { positive: ["C-0026"], negative: ["C-0027"] }],
  ["expr", { positive: ["C-0040"], negative: ["C-0028"] }],
  ["record", { positive: ["C-0101"], negative: ["C-0102"] }],
  ["field", { positive: ["C-0101"], negative: ["C-0103"] }],
]);
{
  const ebnf = fs.readFileSync(path.join(ROOT, "SPEC.txt"), "utf8");
  // The EBNF lives between the 2.2 heading and the 2.3 heading. Taking a fixed slice of text by its
  // first line missed half the productions, which is exactly the kind of quiet gap this check exists
  // to find.
  const start = ebnf.indexOf("— 2.2 ");
  const end = ebnf.indexOf("— 2.3 ", start + 1);
  const block = start >= 0 && end > start ? ebnf.slice(start, end) : "";
  const productions = [...new Set([...block.matchAll(/^([a-z][a-zA-Z]*)\s*=/gm)].map((m) => m[1]))];
  const missing = productions.filter((p) => !PRODUCTION_CASES.has(p));
  const byId = new Map(CASES.map((c) => [c.id, c]));
  const wrong = [];
  for (const [production, entry] of PRODUCTION_CASES) {
    for (const id of entry.positive) {
      const c = byId.get(id);
      if (!c) wrong.push(production + ": " + id + " does not exist");
      else if (c.expect.kind === "error") wrong.push(production + ": " + id + " is claimed positive but expects an error");
    }
    for (const id of entry.negative) {
      const c = byId.get(id);
      if (!c) wrong.push(production + ": " + id + " does not exist");
      else if (c.expect.kind !== "error") wrong.push(production + ": " + id + " is claimed negative but does not expect an error");
    }
  }
  console.log("");
  console.log("grammar coverage (SPEC 2.2)");
  console.log("  " + productions.length + " production(s) in the EBNF: " + productions.join(", "));
  console.log("  " + (missing.length ? "no case claimed for: " + missing.join(", ") : "every production has a positive and a negative case"));
  console.log("  " + (wrong.length ? "mislabelled: " + wrong.join("; ") : "every named case has the polarity it claims"));
  globalThis.__grammar = missing.length + wrong.length;
}

const bad = failed || xpassed || unregistered.length || dead.length || duplicated.length || unexplained.length ||
  (globalThis.__unexercised || []).length || (globalThis.__outside || []).length || (globalThis.__odd || []).length ||
  (globalThis.__grammar || 0);
if (process.env.HMYR_CONFORMANCE_WHY) {
  // 红的时候要能问「是哪一节」。默认不出声 —— 一份检查器不该在绿灯时也唠叨。
  console.log("");
  console.log("why: failed=" + failed + " xpassed=" + xpassed +
    " unregistered=" + unregistered.length + " dead=" + dead.length +
    " duplicated=" + duplicated.length + " unexplained=" + unexplained.length +
    " unexercised=" + (globalThis.__unexercised || []).length +
    " outside=" + (globalThis.__outside || []).length +
    " odd=" + (globalThis.__odd || []).length +
    " grammar=" + (globalThis.__grammar || 0));
}
process.exit(bad ? 1 : 0);
