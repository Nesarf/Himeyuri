// 内置函数的三面对照：代码、规格第一圈、能力契约。
//
// 为什么要有它：一个内置若只存在于代码里，它就是隐形的；若只写在文档里，
// 它就是假的。三面对照把「说了」与「做了」钉在一起。
//
//   node tools/check-builtins.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 读 = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// 一、代码里有什么：BUILTINS 里两个空格缩进的键名
const eval源 = 读("src/eval.mjs");
const 起 = eval源.indexOf("const BUILTINS = {");
if (起 < 0) { console.error("  找不到 BUILTINS"); process.exit(2); }
let 深 = 0, 终 = -1;
for (let i = eval源.indexOf("{", 起); i < eval源.length; i++) {
  if (eval源[i] === "{") 深++;
  else if (eval源[i] === "}") { 深--; if (深 === 0) { 终 = i; break; } }
}
const 主体 = eval源.slice(eval源.indexOf("{", 起) + 1, 终);
const 代码里 = [];
for (const 行 of 主体.split("\n")) {
  const m = /^  ([a-z_][a-z0-9_]*):/.exec(行);
  if (m) 代码里.push(m[1]);
}

// 二、规格第一圈：那一行里点名了哪些
const spec = 读("SPEC.txt");
// 规格里「标准库第一圈」说了两处：一处是枚举，一处是定稿叙述。两处都算。
const 环行们 = spec.split("\n").filter((l) => l.includes("标准库第一圈"));
if (环行们.length === 0) { console.error("  找不到「标准库第一圈」"); process.exit(2); }
const 环里 = Array.from(new Set(环行们.flatMap((l) =>
  Array.from(l.matchAll(/[a-z_][a-z0-9_]*/g)).map((m) => m[0]))));

// 三、能力契约文档：分组列出的名字
const 契约 = 读("design/CAPABILITIES.txt");
const 契约里 = Array.from(new Set(Array.from(契约.matchAll(/[a-z_][a-z0-9_]*/g)).map((m) => m[0])));

let 问题 = 0;
const 报 = (说明, 名字们) => {
  if (名字们.length === 0) return;
  问题++;
  console.log("  [不通过] " + 说明 + "（" + 名字们.length + " 个）：" + 名字们.join(" "));
};

console.log("  代码里的内置 " + 代码里.length + " 个 · 第一圈点名 " + 环里.length + " 个 · 契约里出现 " + 契约里.length + " 个");

报("代码里有、第一圈没有点名", 代码里.filter((n) => !环里.includes(n)));
报("第一圈点名了、代码里没有（写了个不存在的东西）", 环里.filter((n) => 代码里.includes(n) === false && ["abs","min","max","len","int","str","print","arena","read_text","write_text","run_program","now_ms","is_letter","is_mark","nfc","split","console_codepage","term_size","term_clear","term_escape","term_color","term_hide","term_show","sleep_ms","floor","slice","ord","chr","to_upper","to_lower","to_int","cwd","home_dir","chdir","key_push","key_available","key_read","key_start","locale_env","locale_current","locale_set","record_new","field_get","field_has","thr_spawn","thr_join","thr_cancel","thr_count","repo_path","python_path","temp_path"].includes(n)));
报("代码里有、契约文档没提到", 代码里.filter((n) => !契约里.includes(n)));

// 效果：登记了效果的，契约里该说清
const 效果行 = eval源.split("\n").find((l) => l.includes("const BUILTIN_EFFECTS"));
console.log("  有效果的内置：" + (效果行 ? 效果行.replace(/.*=\s*/, "").replace(/[{};]/g, "").trim() : "（没找到那一行）"));

if (问题 === 0) console.log("  三面一致（代码、第一圈、契约互相对得上）");
console.log(问题 === 0 ? "  通过" : "  不通过");
process.exit(问题 === 0 ? 0 : 1);
