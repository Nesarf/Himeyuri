// 语言分层门禁：src/ 下每一个 .mjs 都要在 design/LANGS.txt 的清单里登记，并且写着它属于哪一层。
//
// 为什么这一条值得有：design/LANGS.txt 立了一句规矩 ——「核心语义那一层不许再以 .mjs
// 新建」。一句话在文档里不会红，于是它只在评审时存在，而评审会忘。写成这张表的对账之后，
// 往核心加一个文件的第一步是先在表上写一个词，而那个词要说清它属于哪一层。
//
// 两个方向都要查，理由不同：
//   盘上有而清单里没有   新文件没登记 —— 这条门禁的全部意义
//   清单里有而盘上没有   清单过时 —— 一个记录过的路径不等于一个还存在的路径
//
// 层不是 tools/runtime-path.mjs 那个「工具册」的同一把尺。工具册问的是「它会不会出现在
// 跑程序的路徑上」，这张表问的是「它属于哪一层」。adapter.mjs 两边都在：它不在运行时
// 路径上（所以进工具册），而它是「宿主与自举对同一个数」那条语义的实现（所以层是 core）。
// 两个问题各有各的答案，合表就会有一个答错。
//
// 用法：node tools/check-langs.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIST = path.join(ROOT, "design", "LANGS.txt");
const SRC = path.join(ROOT, "src");
const LAYERS = new Set(["core", "tool"]);

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 清单行长这样，两个空格、一个全角中点（U+30FB）、名字、层：
//   ・lexer.mjs core
const listed = new Map();
for (const line of fs.readFileSync(LIST, "utf8").split("\n")) {
  const m = line.match(/^ {2}\u30fb(\S+\.mjs)\s+(\S+)\s*$/);
  if (m) listed.set(m[1], m[2]);
}
const onDisk = fs.readdirSync(SRC).filter((n) => n.endsWith(".mjs")).sort();

console.log("一、清单读得动");
ok("design/LANGS.txt 里有清单", listed.size > 0, String(listed.size));
{
  const 坏层 = [...listed].filter(([, layer]) => !LAYERS.has(layer));
  ok("每一项的层名只有 core 与 tool", 坏层.length === 0, 坏层.map(([f, l]) => f + "=" + l).join(" "));
}

console.log("二、盘上每一个 .mjs 都登记了");
{
  const 未登记 = onDisk.filter((f) => !listed.has(f));
  ok("src/ 下 " + onDisk.length + " 个 .mjs 全在清单里", 未登记.length === 0, 未登记.join(" "));
}

console.log("三、清单里每一个都还在盘上");
{
  const 已消失 = [...listed.keys()].filter((f) => !onDisk.includes(f));
  ok("清单里 " + listed.size + " 项都指向存在的文件", 已消失.length === 0, 已消失.join(" "));
}

const core = [...listed.values()].filter((l) => l === "core").length;
console.log("");
console.log("core " + core + " 个 · tool " + (listed.size - core) + " 个");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
