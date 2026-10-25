// 求值器自举的第一块实地：把 self/run.hmyr（解析器 + 求值器）编成字节码，
// 交给虚拟机跑，然后让它解释几段程序，与宿主求值器比答案。
//
// 这不是「桥」那条线 —— 那条量的是加载器的替换。这一件量的是更根本的一句：
// 这台机器能不能跑自己的解释器，并且给出同样的答案。
//
// 用法：node tools/self-vm-eval.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 读程序 } from "../src/code-file.mjs";
import { 虚拟机 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 字节路 = path.join(ROOT, "runtime/run.hmyrb");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

if (!fs.existsSync(字节路)) {
  console.log("没有 runtime/run.hmyrb —— 先跑 node tools/emit-code.mjs self/run.hmyr runtime/run.hmyrb");
  process.exit(1);
}

// 1. 字节码那台：解析器与求值器都在它里面
const vm = new 虚拟机(读程序(fs.readFileSync(字节路)), {
  capabilities: 本机能力(), stepLimit: 40000000000, maxDepth: 4000,
});
const 调 = (名, 参) => {
  const r = vm.调用(名, 参, null);
  if (!r || !r.ok) return { err: String(r && r.码 ? r.码 + " " + r.话 : "停机") };
  return { value: r.值 };
};

// 2. 宿主那台：同一份 run.hmyr，但由宿主求值器执行
const 宿主 = runUnit(loadUnit(path.join(ROOT, "self/run.hmyr")), { stepLimit: 40000000000 });
const 宿主调 = (名, 参) => {
  try { return { value: 宿主.callFunction(宿主.functions.get(名), 参, null) }; }
  catch (e) { return { err: String(e && e.message).slice(0, 80) }; }
};

const 样本 = [
  ["算术", "fn main() -> Int {\n  return 1 + 2 * 3\n}\n"],
  ["if 与 return", "fn main() -> Int {\n  let a = 5\n  if a > 3 {\n    return 9\n  }\n  return 0\n}\n"],
  ["while", "fn main() -> Int {\n  var i = 0\n  while i < 4 {\n    i = i + 1\n  }\n  return i\n}\n"],
  ["函数调用", "fn add(a: Int, b: Int) -> Int {\n  return a + b\n}\nfn main() -> Int {\n  return add(20, 22)\n}\n"],
  // 下面这批是「语言本身的形状」：字符串、元组、记录、下标、逻辑、一元、嵌套。
  // 求值器的调用只认内置，所以样本里不放自定义函数调用。
  ["字符串比较", 'fn main() -> Int {\n  if "ab" == "ab" {\n    return 1\n  }\n  return 0\n}\n'],
  ["字符串长度", 'fn main() -> Int {\n  return len("abcde")\n}\n'],
  ["元组与下标", "fn main() -> Int {\n  let t = (10, 20, 30)\n  return t[1]\n}\n"],
  ["记录字段", "fn main() -> Int {\n  let r = {a: 3, b: 4}\n  return r.a + r.b\n}\n"],
  ["逻辑短路", "fn main() -> Int {\n  if 1 < 2 && 3 > 2 {\n    return 5\n  }\n  return 0\n}\n"],
  ["一元负号", "fn main() -> Int {\n  return 0 - (0 - 7)\n}\n"],
  ["嵌套 if", "fn main() -> Int {\n  let a = 2\n  if a > 1 {\n    if a > 2 {\n      return 3\n    }\n    return 2\n  }\n  return 1\n}\n"],
  ["while 里套 if", "fn main() -> Int {\n  var i = 0\n  var s = 0\n  while i < 5 {\n    if i > 2 {\n      s = s + i\n    }\n    i = i + 1\n  }\n  return s\n}\n"],
  ["十六进制与下划线", "fn main() -> Int {\n  return 0x1_0\n}\n"],
];

console.log("一、字节码那台能跑自己的解释器吗");
{
  const 空 = 调("函数名们", ["fn main() -> Int {\n  return 7\n}\n"]);
  ok("函数名们 在 vm 上跑得动", !空.err, 空.err || JSON.stringify(空.value).slice(0, 40));
}

console.log("二、同一段程序，两台机器给出同一个答案");
for (const [标, 源] of 样本) {
  const 甲 = 调("跑程序文字", [源]);
  const 乙 = 宿主调("跑程序文字", [源]);
  const 同 = !甲.err && !乙.err && JSON.stringify(甲.value) === JSON.stringify(乙.value);
  ok(标, 同, 甲.err || 乙.err || ("vm " + JSON.stringify(甲.value).slice(0, 40) + " · 宿主 " + JSON.stringify(乙.value).slice(0, 40)));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
