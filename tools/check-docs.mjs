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
// data/ 是第三方原始数据（Unicode 的 UCD 与 Unihan），它们有自己的格式与自己的规矩，
// 而这份检查针对的是我们写下的文档。把它们扫进来会得到二十八份「不通过」，
// 而那些「违规」全是数据本身：行首的井号、竖线表格、方括号引用，都是 UCD 的写法。
//
// 2026-11-02 补三处，与 tools/check-docs.hmoca 对齐：swap/（量具的临时工作台）、
// ucd/ 与 conformance/（同样是数据表，前者是码点表 42 MB，后者是 Unihan 与 NFC 的
// 对照 29 MB 与 17 MB）、以及所有点开头的目录（测试留下的 .tmp-* 也在其中）。
// 对齐之后两份数一样：61 份变 43 份 —— 少掉的 18 份全是数据，不是我们写下的文档。
const SKIP = new Set(["node_modules", ".git", "build", "data", "swap", "ucd", "conformance"]);

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
    if (entry.name.startsWith(".")) continue;
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
  // 报的时候带上第一处违规的行号。只说「bold marker」不说哪一行，
  // 找起来要翻整份文件——而一份文档里同一类标记往往只错一处。
  const offences = [];
  for (const [re, label] of MARKERS) {
    const m = re.exec(text);
    if (!m) continue;
    const 行 = text.slice(0, m.index).split("\n").length;
    offences.push(label + " (line " + 行 + ")");
  }
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  if (offences.length) { failed++; console.log("  [不通过] " + rel + "  " + offences.join(", ")); }
  else console.log("  [通过] " + rel);
}
console.log("");
console.log(files.length + " document(s) checked, " + failed + " with rendering syntax");
process.exit(failed === 0 ? 0 : 1);
