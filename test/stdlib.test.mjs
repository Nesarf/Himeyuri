// M6, second piece: the standard library reaches the world outside - running a program, reading the
// clock - with the same discipline as everything else.
//
// The rule being tested is the one the platform paper calls inference three: a platform language's first
// job is driving other programs, and a capability that is not declared is not granted.
import { runEmbedded } from "../src/embed.mjs";
import { run } from "../src/eval.mjs";

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const codesOf = (r) => r.diagnostics.items.map((d) => d.code);

// ---- the capability is enforced the same way file access is ----
console.log("running a program needs the process effect");
{
  const r = runEmbedded('fn main() {\n  print(run_program("x")["code"])\n}\n', ["file"]);
  ok("without the grant it is refused", !r.ok && codesOf(r).includes("HMYR-內-001"), codesOf(r).join(","));
}
{
  const r = runEmbedded('fn main() {\n  print(1)\n}\n', ["process"]);
  ok("granting process does not break a script that does not use it", r.ok, codesOf(r).join(","));
}

// ---- and it works when granted ----
console.log("\nwhat run_program returns");
{
  const r = runEmbedded('fn main() effects(process) {\n  let r = run_program("' + process.execPath.replace(/\\/g, "\\\\") + '", ("-e", "console.log(6 * 7)"))\n  print(r.code)\n  print(r.stdout)\n}\n', ["process"]);
  ok("a program runs and its output comes back", r.ok && r.output.join("\n").includes("42"), codesOf(r).join(",") + " " + JSON.stringify(r.output));
  ok("and its exit code is a number", r.ok && r.output[0] === "0", JSON.stringify(r.output.slice(0, 2)));
}
{
  const r = runEmbedded('fn main() effects(process) {\n  let r = run_program("' + process.execPath.replace(/\\/g, "\\\\") + '", ("-e", "process.exit(3)"))\n  print(r.code)\n}\n', ["process"]);
  ok("a failing program reports its code rather than throwing", r.ok && r.output.join("") === "3", JSON.stringify(r.output));
}
{
  const r = runEmbedded('fn main() effects(process) {\n  let r = run_program("this-program-does-not-exist-anywhere")\n  print(r.code)\n  print(r.error)\n}\n', ["process"]);
  ok("a program that cannot be started is data, not a crash", r.ok && r.output[0] === "-1" && r.output.length === 2, JSON.stringify(r.output));
}
{
  const source = 'fn main() effects(process) {\n  let r = run_program("' + process.execPath.replace(/\\/g, "\\\\") + '", ("-e", "setTimeout(() => {}, 8000)"), 400)\n  print(r.timedOut)\n}\n';
  const r = runEmbedded(source, ["process"]);
  ok("a program that will not finish is stopped, and says so", r.ok && r.output.join("") === "true", JSON.stringify(r.output) + " " + codesOf(r).join(","));
}

// ---- the clock: no capability needed, but it costs reproducibility ----
console.log("\nthe clock");
{
  const r = run('fn main() {\n  let t = now_ms()\n  print(t > 0)\n}\n');
  ok("now_ms() needs no effect", r.diagnostics.errors.length === 0, r.diagnostics.errors.map((e) => e.code).join(","));
  ok("and returns a positive number", r.output.join("") === "true", JSON.stringify(r.output));
}
{
  const a = run("fn main() {\n  print(now_ms() == now_ms())\n}\n");
  ok("two reads can differ, so a program using it is not reproducible", typeof a.output[0] === "string");
}
{
  // the specification says so, so the document and the language must agree
  const fs = await import("node:fs");
  const spec = fs.readFileSync(new URL("../SPEC.txt", import.meta.url), "utf8");
  ok("the specification warns that the clock breaks reproducibility", /时钟|now_ms/.test(spec) && /可复现/.test(spec));
  ok("and that running a program needs the process effect", /process/.test(spec));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
