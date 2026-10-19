// No rendering syntax hiding in ordinary characters.
//
// A document should look like what it says. Markdown buys rendering by putting meaning into characters
// that already mean something else - and that meaning only appears if the reader happens to render it.
// This checks every document in the project for that.
//
//   node tools/check-docs.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// .md 故意不在这个集合里：markdown 的存在就是为了渲染，而这份检查针对的是
// 「本来该是普通文本、却混进了渲染语法」的文档。项目里的设计文档全是 .txt，所以它们受这一条约束。
const EXT = new Set([".txt", ".rst", ".adoc"]);
const SKIP = new Set(["node_modules", ".git", "build"]);

const MARKERS = [
  [/^#{1,6}\s/m, "hash heading"],
  [/\*\*[^*\n]+\*\*/m, "bold marker"],
  [/`[^`\n]+`/m, "backtick code span"],
  [/^\s*\|.*\|\s*$/m, "table row"],
  [/^\s*>\s/m, "blockquote"],
  [/^\s*[-*]\s+\[[ xX]\]/m, "task checkbox"],
  [/\[[^\]]+\]\([^)]+\)/m, "inline link"],
  [/^\s*```/m, "fenced code block"],
];

function walk(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (EXT.has(path.extname(entry.name))) found.push(full);
  }
  return found;
}

const files = walk(ROOT);
let failed = 0;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const offences = MARKERS.filter(([re]) => re.test(text)).map(([, label]) => label);
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  if (offences.length) { failed++; console.log("  [不通过] " + rel + "  " + offences.join(", ")); }
  else console.log("  [通过] " + rel);
}
console.log("");
console.log(files.length + " document(s) checked, " + failed + " with rendering syntax");
process.exit(failed === 0 ? 0 : 1);
