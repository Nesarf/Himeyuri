// M5's acceptance, from the language's side: a host can run a script inside an envelope, and the
// envelope is enforced rather than described.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runEmbedded, describeHost } from "../src/embed.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const codesOf = (r) => r.diagnostics.items.map((d) => d.code);

// ---- in-process: the envelope ----
console.log("the envelope");
{
  const r = runEmbedded('fn main() effects(file) {\n  print("inside")\n}\n', ["file"]);
  ok("a script inside the grant runs", r.ok && r.output.join("") === "inside", codesOf(r).join(","));
}
{
  const r = runEmbedded('fn main() effects(file, net) {\n  print("nope")\n}\n', ["file"]);
  ok("a script asking for more than the host grants is refused", !r.ok && codesOf(r).includes("HMYR-內-002"), codesOf(r).join(","));
  ok("and it is refused before running", r.output.length === 0 && r.stage === "grant", r.stage);
}
{
  const r = runEmbedded('fn main() {\n  print("bare")\n}\n', []);
  ok("a script declaring nothing runs under no grant", r.ok && r.output.join("") === "bare", codesOf(r).join(","));
}
{
  const r = runEmbedded('fn main() effects(file) {\n  print(read_text("definitely-missing-9f3a.txt"))\n}\n', ["file"]);
  ok("reading needs the file effect", !r.ok, "it should have failed on a missing file, not on the effect");
}

// ---- read_text really reads, and only when allowed ----
console.log("\nread-only file access");
const scratch = path.join(os.tmpdir(), "hmyr-embed-sample.txt");
fs.writeFileSync(scratch, "content from disk\n", "utf8");
{
  const source = 'fn main() effects(file) {\n  print(read_text(' + JSON.stringify(scratch) + '))\n}\n';
  const r = runEmbedded(source, ["file"]);
  ok("a granted script reads a real file", r.ok && r.output.join("").trim() === "content from disk", codesOf(r).join(","));
}
{
  const source = 'fn main() {\n  print(read_text(' + JSON.stringify(scratch) + '))\n}\n';
  const r = runEmbedded(source, ["file"]);
  ok("an undeclared read is refused", !r.ok && codesOf(r).includes("HMYR-內-001"), codesOf(r).join(","));
}
{
  const r = runEmbedded('fn main() {\n  print(write_text("x", "y"))\n}\n', []);
  ok("writing now exists, and needs the file effect just like reading", !r.ok && codesOf(r).includes("HMYR-內-001"), codesOf(r).join(","));
}
fs.rmSync(scratch, { force: true });

// ---- the host describes itself ----
{
  const d = describeHost();
  ok("the host says what it grants", Array.isArray(d.granted) && d.granted.includes("file"));
  ok("the host says which builtins are effectful", d.effectful.read_text === "file");
  ok("and it says plainly that it is read-only", /read/i.test(d.readOnly));
}

// ---- over a subprocess, which is how KID will do it ----
console.log("\nthe stdio boundary");
function talk(requests) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, "src/embed.mjs")], { stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("close", () => resolve(out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))));
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
    child.stdin.end();
  });
}
{
  const replies = await talk([
    { jsonrpc: "2.0", id: 1, method: "describe" },
    { jsonrpc: "2.0", id: 2, method: "run", params: { source: 'fn main() effects(file) {\n  print("hi")\n}\n', granted: ["file"] } },
    { jsonrpc: "2.0", id: 3, method: "run", params: { source: 'fn main() effects(net) {\n  print("no")\n}\n', granted: ["file"] } },
    { jsonrpc: "2.0", id: 4, method: "nonsense" },
    { jsonrpc: "2.0", id: 5, method: "run", params: { source: "fn main() {\n  print(1 + 1)\n}\n" } },
  ]);
  ok("five frames, five answers", replies.length === 5, String(replies.length));
  ok("describe answers with the host's terms", replies[0].result && replies[0].result.granted.includes("file"));
  ok("a granted run answers ok with its output", replies[1].result.ok && replies[1].result.output.join("") === "hi");
  ok("a run outside the grant answers not-ok with the code", replies[2].result.ok === false && replies[2].result.diagnostics[0].code === "HMYR-內-002");
  ok("an unknown method is a JSON-RPC error", replies[3].error && replies[3].error.code === -32601);
  ok("a run with no grant falls back to the host's own", replies[4].result.ok && replies[4].result.output.join("") === "2");
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
