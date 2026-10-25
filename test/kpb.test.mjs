// M4's acceptance: the KPB description is written in Himeyuri, and what comes out the other side is
// data an engine can read. The test checks the data, not the prose - if the language stopped being able
// to express a piece, this fails.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPiece, validatePiece, describePiece } from "../kpb/host.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const loaded = loadPiece(path.join(ROOT, "kpb/piece.hmoca"));
ok("the description runs", loaded.ok, loaded.diagnostics ? loaded.diagnostics.items.map((d) => d.code + " " + d.message).join("; ") : "");
if (!loaded.ok) { console.log("\n" + passed + " passed, " + failed + " failed"); process.exit(1); }

const data = loaded.data;
const problems = validatePiece(data);
ok("the shape is what the engine needs", problems.length === 0, problems.join("; "));

ok("the score names a piece and a tempo", data.score.title === "湯の岡" && data.score.tempo === 120 && data.score.ppq === 480);
ok("three tracks came through", data.score.tracks.length === 3, data.score.tracks.map((t) => t.name).join(","));
ok("notes are triples of numbers", data.score.tracks.every((t) => t.notes.every((n) => n.length === 3 && n.every((x) => typeof x === "number"))));
ok("the note counts are what the description wrote",
  data.score.tracks[0].notes.length === 4 && data.score.tracks[1].notes.length === 2 && data.score.tracks[2].notes.length === 4);
ok("a specific note is where it should be", data.score.tracks[0].notes[2][0] === 72 && data.score.tracks[0].notes[2][1] === 960);
ok("a function call built the drum line", data.score.tracks[2].notes[1][0] === 38 && data.score.tracks[2].notes[1][1] === 480);
ok("the mix has three strips with gains", data.mix.strips.length === 3 && data.mix.strips.every((s) => typeof s.gain === "number"));
ok("the master bus is there", typeof data.mix.master.gain === "number" && typeof data.mix.master.ceiling === "number");
ok("the timbre has an engine and parameters",
  data.timbre.engine === "subtractive" && data.timbre.params.cutoff === 4200 && Object.keys(data.timbre.params).length === 4);
ok("the data survives a JSON round trip", JSON.stringify(JSON.parse(JSON.stringify(data))) === JSON.stringify(data));
ok("it can be described back in one line per part", describePiece(data).split("\n").length === 4);

// A broken description must be refused at the boundary rather than inside the engine.
{
  const broken = validatePiece({ score: { ppq: 0, tempo: 120, tracks: [] }, mix: { strips: [] } });
  ok("a piece with no tracks is refused", broken.some((p) => p.includes("score.tracks")));
}
{
  const broken = validatePiece({ score: { ppq: 480, tempo: 120, tracks: [{ name: "x", notes: [[1, 2]] }] }, mix: { strips: [{ name: "a", gain: 0 }] }, timbre: { name: "t", params: {} } });
  ok("a note that is not a triple is refused", broken.some((p) => p.includes("not a triple")));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
