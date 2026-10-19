// M5: the language as something another program can host.
//
// The decided shape is a subprocess speaking JSON-RPC (SPEC chapter 6), and the thing that makes the
// embedding worth anything is the envelope: the host says which effects it grants, and a script whose
// main declares anything outside that set is refused before it runs. "Read-only file access" is then a
// fact rather than a promise - the host grants {file} and provides a reading builtin, and there is no
// writing builtin to call at all.
//
//   node src/embed.mjs --file kpb/piece.hmyr --grant file
//   node src/embed.mjs                 (then send JSON-RPC frames on stdin, one per line)
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { lex } from "./lexer.mjs";
import { parse } from "./parser.mjs";
import { Runtime, describe } from "./eval.mjs";

export const HOST_EFFECTS = ["file"];

export function runEmbedded(source, granted = []) {
  const grantedSet = new Set(granted);
  const diagnostics = { items: [], errors: [], warnings: [], add(s, c, m, l, col) { this.items.push({ severity: s, code: c, message: m, line: l, column: col }); if (s === "error") this.errors.push(this.items[this.items.length - 1]); }, error(c, m, l = 0, col = 0) { this.add("error", c, m, l, col); }, warn(c, m, l = 0, col = 0) { this.add("warning", c, m, l, col); } };

  const lexed = lex(source, {});
  const parsed = parse(lexed.tokens, { diagnostics });
  if (diagnostics.errors.length) return { ok: false, stage: "parse", output: [], value: null, diagnostics };

  const main = parsed.ast.decls.find((d) => d.kind === "Fn" && d.name === "main");
  if (!main) return { ok: false, stage: "link", output: [], value: null, diagnostics, reason: "no main function" };

  // The envelope: what the script asks for must fit inside what the host grants.
  const asked = main.effects || [];
  const excess = asked.filter((e) => !grantedSet.has(e));
  if (excess.length) {
    diagnostics.error("HMYR-R0202", "the script declares effect(s) the host did not grant: " + excess.join(", ") + " (granted: " + (granted.join(", ") || "none") + ")", main.line, 0);
    return { ok: false, stage: "grant", output: [], value: null, diagnostics };
  }

  const runtime = new Runtime({});
  try {
    const value = runtime.run(parsed.ast);
    return { ok: true, stage: "run", output: runtime.output, value, diagnostics, granted: [...grantedSet] };
  } catch (e) {
    diagnostics.error(e.code || "HMYR-R0100", e.message, 0, 0);
    return { ok: false, stage: "run", output: runtime.output, value: null, diagnostics };
  }
}

export function describeHost() {
  return {
    language: "Himeyuri",
    version: "0.1.0-m2",
    granted: HOST_EFFECTS,
    builtins: ["print", "len", "str", "int", "abs", "min", "max", "arena", "read_text"],
    effectful: { read_text: "file" },
    readOnly: "the host provides reading and no writing builtin: that is what makes {file} mean reading",
  };
}

// ---- JSON-RPC over stdio, one frame per line ----
function handle(request) {
  const { id, method, params } = request || {};
  try {
    if (method === "describe") return { jsonrpc: "2.0", id, result: describeHost() };
    if (method === "run") {
      const granted = Array.isArray(params?.granted) ? params.granted : HOST_EFFECTS;
      const source = params?.source ?? (params?.file ? fs.readFileSync(params.file, "utf8") : null);
      if (typeof source !== "string") return { jsonrpc: "2.0", id, error: { code: -32602, message: "run needs params.source or params.file" } };
      const result = runEmbedded(source, granted);
      return {
        jsonrpc: "2.0", id,
        result: {
          ok: result.ok, stage: result.stage, output: result.output,
          value: result.value === undefined ? null : result.value,
          diagnostics: result.diagnostics.items.map((d) => ({ severity: d.severity, code: d.code, message: d.message, line: d.line })),
        },
      };
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: "unknown method: " + method } };
  } catch (e) {
    return { jsonrpc: "2.0", id, error: { code: -32603, message: e.message } };
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  const valueOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const file = valueOf("--file");
  const grant = (valueOf("--grant") || HOST_EFFECTS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);

  if (file) {
    const result = runEmbedded(fs.readFileSync(file, "utf8"), grant);
    for (const line of result.output) console.log(line);
    for (const d of result.diagnostics.items) console.log("  " + d.severity + " " + d.code + "  " + d.message);
    if (argv.includes("--json")) console.log(JSON.stringify({ ok: result.ok, stage: result.stage, output: result.output, value: result.value, granted: result.granted || grant }, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let request = null;
    try { request = JSON.parse(trimmed); } catch { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "not JSON" } }) + "\n"); return; }
    process.stdout.write(JSON.stringify(handle(request)) + "\n");
  });
}
