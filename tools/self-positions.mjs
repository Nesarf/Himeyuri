// 词法这一层的位置对齐：同一段源码，两个词法器交出的 token 在**哪里**必须一致。
//
// 只比两样：词形（text）与位置（行、列）。kind 的命名还没统一（宿主分 keyword 与 ident，
// self 那一侧一律 ident），换行 token 也只有宿主保留 —— 这两处差异不算失败，它们是
// design/FULLSELF.txt 里记着的「命名与层次」那一类，等形状那一步一起处理。
//
// 为什么位置值得单独量：诊断要说「第几行第几列」，而宿主解析器交出的每个节点都带位置。
// self 这一侧以前只有字符偏移，于是它给不出人能读的位置。
import { loadUnit, runUnit } from "./self-bridge.mjs";
import { 切 } from "../src/subset-lex.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "self/lex.hmoca"));
if (!unit.ok) {
  console.log("self/lex.hmyr 加载失败：" + JSON.stringify((unit.diagnostics.errors || []).slice(0, 2).map((e) => e.code)));
  process.exit(1);
}
const rt = runUnit(unit, { stepLimit: 40000000000 });
const 自己切 = (源) => Array.from(rt.callFunction(rt.functions.get("scan"), [源], null));

const 词形 = (t) => String(t.text ?? t.value ?? "");
const 种类 = (t) => String(t.kind ?? t.type ?? "");
const 位 = (t) => 词形(t) + "@" + t.line + ":" + t.column;
const 可比 = (t) => 种类(t) !== "newline" && 种类(t) !== "eof";

const 样本 = [
  ["一行赋值", "let x = 1\n"],
  ["多行函数", "fn f(a: Int) -> Int {\n  return a + 2\n}\n"],
  ["注释与空行", "// 开头一行\n\nlet y = 3\n// 中间\nlet z = y * 2\n"],
  ["字符串与转义", 'let s = "a\\nb"\n'],
  ["中文标识符", "let 琥珀音 = 42\n"],
  ["紧挨着的符号", "let q = (a+b)*c-d/e\n"],
];

console.log("一、词形与位置逐项比（换行 token 只在宿主那一侧，比之前滤掉）");
for (const [名, 源] of 样本) {
  const 己 = 自己切(源).map(位);
  const 彼 = 切(源).filter(可比).map(位);
  const 同 = 己.length === 彼.length && 己.every((x, i) => x === 彼[i]);
  const 差 = 同 ? "" : "第 " + (己.findIndex((x, i) => x !== 彼[i]) + 1) + " 个起不同：self=" + JSON.stringify(己.slice(0, 6)) + " 宿主=" + JSON.stringify(彼.slice(0, 6));
  ok(名 + "（" + 彼.length + " 个 token）", 同, 差);
}

console.log("二、行号真的在翻页（不是恒等于 1）");
{
  const 己 = 自己切("let a = 1\nlet b = 2\nlet c = 3\n");
  const 行们 = 己.map((t) => t.line);
  ok("出现过第 2 行与第 3 行", 行们.includes(2) && 行们.includes(3), JSON.stringify(行们));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
