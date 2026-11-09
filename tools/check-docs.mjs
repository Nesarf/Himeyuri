// No rendering syntax hiding in ordinary characters.
//
// A document should look like what it says. Markdown buys rendering by putting meaning into characters
// that already mean something else - and that meaning only appears if the reader happens to render it.
// This checks every document in the project for that.
//
// 原话是「不能用 md 语法写」，不是「不能用那些符号」。区别在意图：md 是再渲染的做法，
// 它把意义藏进「本来意味着别的东西」的字符里，而那些意义只在渲染时才出现；在 .txt
// 这种直接读的东西里用 md 语法，就是阅读的噪声。
//
// 而这一份检查抓的是符号，不是用法 —— 因为「这是不是 md 语法」要读意图，而意图不能
// 自动判。两个星号是粗体的必要条件，于是拿它当代理：宁可放过一个纯属符号的星号，
// 也不要让真正的粗体漏过去。代价是偶尔想写「星号本身」也得绕开，而这一条收窄时
// 数过：受检文档里含两颗星的行是 0 行，所以代价目前是零。
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
  // 这一条 2026-11-06 收紧了：原来是「两颗星、中间不含星号的文字、两颗星」，
  // 也就是只认成对的。而 HMYR 那一份（tools/check-docs.hmoca）一直是「只要出现
  // 两颗星就算」—— 两份检查器因此在同一份文档上给了不同判决，docshmyr 抓住了
  // 那次不一致。往严的那一边对齐，理由是「成对才算」有一个安静的后果：只写一边
  // 的时候看不见，而那正是最容易出的错。收之前数过：58 份受检文档里含两颗星的
  // 行是 0 行，所以这一次收紧没有让任何一份变红。
  [/\*\*/m, "bold marker"],
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
