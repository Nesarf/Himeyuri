// The host side of the KPB dialect: run a .hmyr file that describes a piece and hand back the data.
//
//   node kpb/host.mjs kpb/piece.hmyr
//
// The language produces ordinary host values (records are objects, tuples are arrays), so the boundary
// is a JSON walk rather than a translation table. That is the point of putting the description in a
// language instead of a bespoke format: the engine gets plain data, and the person writing it gets
// functions, names and arithmetic.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { run } from "../src/eval.mjs";

export function loadPiece(file) {
  const source = fs.readFileSync(file, "utf8");
  const result = run(source, { path: file });
  if (result.diagnostics.errors.length) {
    return { ok: false, diagnostics: result.diagnostics };
  }
  return { ok: true, data: result.value, diagnostics: result.diagnostics };
}

// What the shape has to satisfy before anyone downstream trusts it. Kept here rather than in the
// description, so a broken description fails at the boundary instead of inside the engine.
export function validatePiece(data) {
  const problems = [];
  const need = (condition, message) => { if (!condition) problems.push(message); };

  need(data && typeof data === "object", "the piece is not a record");
  const score = data && data.score;
  need(score && typeof score === "object", "there is no score");
  if (score) {
    need(typeof score.ppq === "number" && score.ppq > 0, "score.ppq must be a positive number");
    need(typeof score.tempo === "number" && score.tempo > 0, "score.tempo must be a positive number");
    need(Array.isArray(score.tracks) && score.tracks.length > 0, "score.tracks must be a non-empty tuple");
    for (const track of score.tracks || []) {
      need(typeof track.name === "string" && track.name.length > 0, "a track has no name");
      need(Array.isArray(track.notes), "track " + track.name + " has no notes");
      for (const note of track.notes || []) {
        need(Array.isArray(note) && note.length === 3, "a note in " + track.name + " is not a triple");
      }
    }
  }
  const mix = data && data.mix;
  need(mix && Array.isArray(mix.strips) && mix.strips.length > 0, "mix.strips must be a non-empty tuple");
  for (const strip of (mix && mix.strips) || []) {
    need(typeof strip.name === "string", "a strip has no name");
    need(typeof strip.gain === "number", "strip " + strip.name + " has no gain");
  }
  const timbre = data && data.timbre;
  need(timbre && typeof timbre.name === "string", "there is no timbre");
  need(timbre && timbre.params && typeof timbre.params === "object", "the timbre has no parameters");
  return problems;
}

export function describePiece(data) {
  const counts = data.score.tracks.map((t) => t.name + " " + t.notes.length);
  return [
    "score: " + data.score.title + " · ppq " + data.score.ppq + " · tempo " + data.score.tempo,
    "tracks: " + counts.join(", "),
    "mix: " + data.mix.strips.map((s) => s.name + " " + s.gain + "dB").join(", "),
    "timbre: " + data.timbre.name + " (" + data.timbre.engine + ")",
  ].join("\n");
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const file = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), "piece.hmyr");
  const loaded = loadPiece(file);
  if (!loaded.ok) {
    for (const d of loaded.diagnostics.items) console.log("  " + d.severity + " " + d.code + "  " + d.message);
    process.exit(1);
  }
  const problems = validatePiece(loaded.data);
  if (problems.length) {
    for (const p of problems) console.log("  [不通过] " + p);
    process.exit(1);
  }
  console.log(describePiece(loaded.data));
  if (process.argv.includes("--json")) console.log(JSON.stringify(loaded.data, null, 2));
}

// pathToFileURL is used above; fileURLToPath is needed for the default path
import { fileURLToPath } from "node:url";
