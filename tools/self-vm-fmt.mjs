// 工具链的第一格：格式化器跑在虚拟机上。
//
// 与 self-vm-eval / self-vm-compile 的分工：那两件量「解释」与「造字节」，这一件量「改写源码」。
// 格式化器最合适开局：它没有副作用，输入一段源码、输出一段文本，两边一比就知道对不对。
//
// 用法：node tools/self-vm-fmt.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 读程序 } from "../src/code-file.mjs";
import { 虚拟机 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";
import { loadUnit, runUnit } from "../src/loader.mjs";
import * as 单位 from "../src/units.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 字节路 = path.join(ROOT, "runtime/fmt.hmyrb");
if (!fs.existsSync(字节路)) {
  console.log("没有 runtime/fmt.hmyrb —— 先跑 node tools/emit-code.mjs self/fmt.hmyr runtime/fmt.hmyrb");
  process.exit(1);
}

const vm = new 虚拟机(读程序(fs.readFileSync(字节路)), {
  capabilities: 本机能力(), stepLimit: 400000000, maxDepth: 4000,
});
const vm调 = (源) => {
  const r = vm.调用("整文件", [源], null);
  return r && r.ok ? r.值 : null;
};

// 宿主那一位：同一份 self/fmt.hmyr，由宿主求值器执行
const 宿主 = runUnit(loadUnit(path.join(ROOT, "self/fmt.hmyr")), { stepLimit: 400000000 });
const 宿主调 = (源) => {
  try { return 宿主.callFunction(宿主.functions.get("整文件"), [源], null); }
  catch { return null; }
};

const 样本 = [
  ["简单函数", "fn main() -> Int {\nreturn 7\n}\n"],
  ["缩进乱了", "fn f(a: Int) -> Int {\n        let x = a + 1\n   return x\n}\n"],
  ["嵌套 if", "fn main() -> Int {\n if 1 < 2 {\n   return 1\n }\n return 0\n}\n"],
  ["多个函数", "fn a() -> Int {\n return 1\n}\nfn b() -> Int {\n return 2\n}\n"],
];

console.log("格式化器：虚拟机与宿主给出同一段文本");
// 两台的字符串底不同：宿主交回宿主串，虚拟机交回码元序列。
// 比的是同一段文本，所以比之前折成宿主串 —— 那一步不改变文本，只改变表示。
const 折 = (v) => (v instanceof Uint16Array ? 单位.成宿主(v) : v);
for (const [标, 源] of 样本) {
  const 甲 = 折(vm调(源));
  const 乙 = 折(宿主调(源));
  const 同 = 甲 !== null && 乙 !== null && 甲 === 乙;
  ok(标, 同, 同 ? "" : JSON.stringify(String(甲).slice(0, 60)) + " · " + JSON.stringify(String(乙).slice(0, 60)));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
