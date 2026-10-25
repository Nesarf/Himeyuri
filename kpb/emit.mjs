// The other direction: data in, Himeyuri source out.
//
//   node kpb/emit.mjs kpb/piece.hmyr > piece.generated.hmyr
//
// What this writes is the data, not the program that produced it - the functions that built a track are
// gone by the time the value exists. That is the honest scope of a round trip: load, emit, load again,
// and the two values must be identical. It is also the useful half for KID, which will have data and
// may want to hand someone a readable description of it.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadPiece } from "./host.mjs";

export function emitPiece(data) {
  const lines = [
    "// 由 kpb/emit.mjs 从数据生成的描述。",
    "// 它写的是数据本身，不是生成这份数据的程序——函数在值产生之后就不在了。",
    "",
    "fn main() -> Int {",
    "  return " + emitValue(data, 1),
    "}",
    "",
  ];
  return lines.join("\n");
}

function emitValue(value, depth) {
  const pad = "  ".repeat(depth);
  const padInner = "  ".repeat(depth + 1);
  if (value === null) return "nil";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "()";
    const items = value.map((v) => padInner + emitValue(v, depth + 1));
    return "(\n" + items.join(",\n") + "\n" + pad + ")";
  }
  const fields = Object.entries(value).map(([k, v]) => padInner + k + ": " + emitValue(v, depth + 1));
  return "{\n" + fields.join(",\n") + "\n" + pad + "}";
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const file = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), "piece.hmoca");
  const loaded = loadPiece(file);
  if (!loaded.ok) {
    for (const d of loaded.diagnostics.items) console.error("  " + d.severity + " " + d.code + "  " + d.message);
    process.exit(1);
  }
  process.stdout.write(emitPiece(loaded.data));
}

import { fileURLToPath } from "node:url";
