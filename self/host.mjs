// The host side of the bootstrapping scanner: feed a real file to the Himeyuri-written front end and
// bring back what it found, so it can be compared with the JavaScript reflector.
//
//   node self/host.mjs kpb/etude.hmyr
//
// The scanner is written in Himeyuri and runs on the evaluator; this file is only the bridge - read the
// file (the host grants {file}, nothing else), split it into bounded pieces, and call scan() on each.
// The pieces exist because the language has no tail-call elimination yet: a recursive descent over a
// long file would run into the depth limit, and a limit that is hidden is worse than one that is stated.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Runtime } from "../src/eval.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";

const LINES_PER_PIECE = 100;

export function loadScanner() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "scan.hmyr");
  const source = fs.readFileSync(file, "utf8");
  const diagnostics = { items: [], errors: [], warnings: [], add(s, c, m, l, col) { this.items.push({ severity: s, code: c, message: m, line: l, column: col }); if (s === "error") this.errors.push(this.items[this.items.length - 1]); }, error(c, m, l, col) { this.add("error", c, m, l, col); }, warn(c, m, l, col) { this.add("warning", c, m, l, col); } };
  const { ast } = parse(lex(source, {}).tokens, { diagnostics });
  if (diagnostics.errors.length) {
    return { ok: false, diagnostics };
  }
  const runtime = new Runtime({});
  // The scanner declares no effects, so it may not read anything by itself: the host reads, and hands
  // the text in. That is the envelope working in the direction that matters here.
  try {
    runtime.run(ast);
  } catch (e) {
    diagnostics.error(e.code || "HMYR-R0100", e.message, 0, 0);
    return { ok: false, diagnostics };
  }
  return { ok: true, runtime, diagnostics };
}

/** Scan a whole file, piece by piece, and return one flat list of declarations. */
export function scanText(text, lineOffset = 1) {
  const loaded = loadScanner();
  if (!loaded.ok) return { ok: false, diagnostics: loaded.diagnostics };

  const lines = text.split("\n");
  const found = [];
  let offset = lineOffset;
  for (let at = 0; at < lines.length; at += LINES_PER_PIECE) {
    const piece = lines.slice(at, at + LINES_PER_PIECE).join("\n");
    const scan = loaded.runtime.functions.get("scan");
    let result = null;
    try {
      result = loaded.runtime.callFunction(scan, [piece, offset], null);
    } catch (e) {
      loaded.diagnostics.error(e.code || "HMYR-R0100", e.message, 0, 0);
      return { ok: false, diagnostics: loaded.diagnostics };
    }
    for (const item of result || []) found.push({ kind: item.kind, name: item.name, line: item.line });
    offset += LINES_PER_PIECE;
  }
  return { ok: true, found, diagnostics: loaded.diagnostics };
}

export function scanFile(file) {
  return scanText(fs.readFileSync(file, "utf8"), 1);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const file = process.argv[2];
  if (!file) { console.log("usage: node self/host.mjs <file.hmyr>"); process.exit(1); }
  const result = scanFile(file);
  if (!result.ok) {
    for (const d of result.diagnostics.items) console.log("  " + d.severity + " " + d.code + "  " + d.message);
    process.exit(1);
  }
  console.log(path.basename(file) + ": " + result.found.length + " declaration(s), found by the scanner written in Himeyuri");
  for (const s of result.found) console.log("  line " + String(s.line).padStart(4) + "  " + s.kind.padEnd(6) + s.name);
}
