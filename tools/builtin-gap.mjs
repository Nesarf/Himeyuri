// 内置函数的四处账本：谁有、谁没有、差的是哪几个。
//
// 为什么要有它：design/SELFRUN.txt 说「完全独立化」的最近一条路是世界面还差
// 若干个内置。差几个、差哪几个，必须从代码里数出来，而不是从旧文档里抄 ——
// 上一份账写「还差 23 个」时数字已经与分组对不上了。
//
// 六处（加内置时要一起动的地方）：
//   src/eval.mjs          宿主求值器（那一份是全部内置的定义）
//   src/minimal-eval.mjs  最小求值器（Stage 0 执行器）
//   src/bytecode.mjs      编译期「这是内置还是用户函数」那张表
//   src/vm-builtins.mjs   字节码执行器
//   self/eval.hmyr        自举求值器（if 名 == "x"）
//   vm/hmyr.c             不是 JS 的那台机器（name_is(name_idx, "x")）
//
// 用法：node tools/builtin-gap.mjs            读出一张表
//       node tools/builtin-gap.mjs --missing  只列宿主有、C 没有的
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 读 = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// 一、花括号块里的键名。缩进与形状由调用方给，这里只做一次切块。
function 块里的键(源, 开头, 形状) {
  const 起 = 源.indexOf(开头);
  if (起 < 0) throw new Error("找不到 " + 开头);
  let 深 = 0, i = 起 + 开头.length - 1;
  for (; i < 源.length; i++) {
    if (源[i] === "{") 深++;
    else if (源[i] === "}") { 深--; if (深 === 0) break; }
  }
  const 块 = 源.slice(起, i + 1);
  const 名 = [];
  for (const 行 of 块.split("\n")) {
    const m = 行.match(形状);
    if (m) 名.push(m[1]);
  }
  return 名;
}

// 二、Set([...]) 里的字符串字面量。
function 集合里的名(源, 开头) {
  const 起 = 源.indexOf(开头);
  if (起 < 0) throw new Error("找不到 " + 开头);
  const 止 = 源.indexOf("]);", 起);
  const 块 = 源.slice(起, 止);
  return [...块.matchAll(/"([a-zA-Z_][a-zA-Z0-9_]*)"/g)].map((m) => m[1]);
}

const 宿主 = 块里的键(读("src/eval.mjs"), "const BUILTINS = {", /^ {2}([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
const 最小 = 块里的键(读("src/minimal-eval.mjs"), "const 内置 = {", /^ {2}([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
const 编译 = 集合里的名(读("src/bytecode.mjs"), "const 内置名 = new Set([");
const 字节码 = 块里的键(读("src/vm-builtins.mjs"), "export const 内置表 = {", /^ {2}([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*\{/);
const 自举 = [...读("self/eval.hmoca").matchAll(/if 名 == "([a-zA-Z_][a-zA-Z0-9_]*)"/g)].map((m) => m[1]);
const C = [...new Set([...读("vm/hmyr.c").matchAll(/name_is\(name_idx, "([a-zA-Z_][a-zA-Z0-9_]*)"\)/g)].map((m) => m[1]))];
// 第七处（2026-10-25 补）：自举编译器自己的「是内置」表，在 self/compile.hmyr 里。
//
// 为什么它必须在这一份账上：种子（bootstrap/pack.hmtn）就是它的字节码，所以这张表
// 落后等于种子落后，而种子落后只表现为「HMYR-R0104 there is no such function」——
// 那个症状看起来像调用写错了，不像账没对齐。这一天量到的正是这件事：这一份报
// 「六处齐了」，而种子里缺四十一个内置。
//
// 它比别的几处多一样东西：表里还有一批中文名（数组 · 设 · 位与 … 与 校验和），
// 那些不是宿主的 BUILTINS 键，只在 C 那台的 name_is 上。所以这一处只要求
// 「宿主有的，这里都有」，不要求反向相等。
const 自举编译 = [...new Set([...读("self/compile.hmoca").matchAll(/if 名 == "([^"]+)" \{ return true \}/g)].map((m) => m[1]))];

const 去重 = (a) => [...new Set(a)].sort();
const 宿 = 去重(宿主), 小 = 去重(最小), 编 = 去重(编译), 字 = 去重(字节码), 自 = 去重(自举), 机 = 去重(C);
const 全部 = 去重([...宿, ...小, ...编, ...字, ...自, ...机, ...自举编译]);
const 有 = (集, 名) => 集.includes(名) ? "有" : "";

// 二、按组说清缺的是什么。分组来自 design/CAPABILITIES.txt。
const 组 = [
  ["文本", ["split", "slice", "ord", "chr", "to_int", "len", "str", "to_upper", "to_lower", "nfc", "is_letter", "is_mark"]],
  ["输出", ["print", "print_err"]],
  ["文件", ["read_text", "write_text", "file_exists", "write_bytes", "f64_bytes", "pack_value", "read_line", "read_lines"]],
  ["进程", ["run_program", "chdir", "argv"]],
  ["环境", ["cwd", "home_dir", "locale_env", "locale_current", "locale_set", "console_codepage", "repo_path", "python_path", "temp_path"]],
  ["时间", ["now_ms", "sleep_ms"]],
  ["终端", ["term_size", "term_clear", "term_escape", "term_color", "term_hide", "term_show"]],
  ["输入", ["key_push", "key_available", "key_read", "key_start"]],
  ["记录", ["record_new", "field_get", "field_has", "field_names"]],
  ["线程", ["thr_spawn", "thr_join", "thr_cancel", "thr_count"]],
  ["内存", ["arena"]],
];

const 分组 = new Map();
for (const [名, 们] of 组) for (const x of 们) 分组.set(x, 名);
const 未归组 = 全部.filter((x) => !分组.has(x));

if (process.argv.includes("--missing")) {
  // 只说「宿主有、C 没有」的那一批，按组排。
  const 缺 = 宿.filter((x) => !机.includes(x));
  const 按组 = new Map();
  for (const x of 缺) {
    const g = 分组.get(x) || "其他";
    if (!按组.has(g)) 按组.set(g, []);
    按组.get(g).push(x);
  }
  console.log("宿主有、C 那台没有的内置：" + 缺.length + " 个");
  for (const [g, 们] of 按组) console.log("  " + g + "  " + 们.join(" "));
  const 自缺 = 宿.filter((x) => !自.includes(x));
  console.log("宿主有、自举求值器没有： " + 自缺.length + " 个");
  process.exit(0);
}

const 宽 = Math.max(...全部.map((x) => x.length));
console.log("内置七处对照（" + 全部.length + " 个名字）");
console.log("  " + "名称".padEnd(宽 + 2) + "宿主  最小  编译  字节码  自举  C     自编");
for (const x of 全部) {
  const 行 = [有(宿, x), 有(小, x), 有(编, x), 有(字, x), 有(自, x), 有(机, x), 有(自举编译, x)];
  console.log("  " + x.padEnd(宽 + 2) + 行.map((s) => (s || "无").padEnd(6)).join(""));
}
console.log("");
console.log("宿主 " + 宿.length + " · 最小 " + 小.length + " · 编译 " + 编.length + " · 字节码 " + 字.length +
            " · 自举 " + 自.length + " · C " + 机.length + " · 自编 " + 自举编译.length);
console.log("宿主有而 C 没有：" + 宿.filter((x) => !机.includes(x)).length + " 个");
// 这一条是新的：宿主有而自举编译器没有 —— 那种缺口只会在「用种子编程序」时现形。
console.log("宿主有而自编没有：" + 宿.filter((x) => !自举编译.includes(x)).length + " 个");
if (未归组.length) console.log("没有归组的名字：" + 未归组.join(" "));
