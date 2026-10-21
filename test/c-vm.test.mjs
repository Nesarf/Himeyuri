// C 版虚拟机：同一份字节码，两台机器，同一个答案。
//
// 这一套的意思是「这门语言不再只有 JS 那一台机器」。它做三件事：
//   一、找一个 C 编译器（没有就明说跳过，不算失败 —— 那不是这门语言的问题）
//   二、把 vm/hmyr.c 编起来
//   三、对同一份源码，JS 那台与 C 那台各跑一遍，比输出
//
// 比输出而不是比值：值在这一层没有共同的表示，而输出是两边都要负责的东西。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { 写程序 } from "../src/code-file.mjs";
import { 虚拟机, 类元组, 类记录 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-cvm-"));

// 一、有没有编译器
const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc —— C 版虚拟机这一套不运行");
  console.log("");
  console.log("0 passed, 0 failed");
  fs.rmSync(临, { recursive: true, force: true });
  process.exit(0);
}

// 二、把它编起来
const exe = path.join(临, "hmyr-vm.exe");
{
  const r = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-o", exe, path.join(ROOT, "vm/hmyr.c")], { encoding: "utf8" });
  ok("vm/hmyr.c 编得出来", r.status === 0, String(r.stderr).slice(0, 200));
  ok("而且没有警告", String(r.stderr).trim() === "", String(r.stderr).slice(0, 200));
}
if (!fs.existsSync(exe)) {
  console.log("");
  console.log(passed + " passed, " + failed + " failed");
  fs.rmSync(临, { recursive: true, force: true });
  process.exit(1);
}

// 同一份源码：JS 那台跑内存里的字节码，C 那台跑文件里的字节码。
const 两侧跑 = (源码, 名字) => {
  const 源路 = path.join(临, 名字 + ".hmyr");
  fs.writeFileSync(源路, 源码, "utf8");
  const unit = loadUnit(源路);
  if (!unit.ok) return { 错: "加载失败 " + JSON.stringify(unit.diagnostics.errors.slice(0, 1).map((e) => e.code)) };
  const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))));

  let js出 = "";
  const vm = new 虚拟机(程序, {
    capabilities: 本机能力(),
    write: (s) => { js出 += s; },
  });
  const jsr = vm.调用("main", [], null);

  const 码路 = path.join(临, 名字 + ".hmyrb");
  fs.writeFileSync(码路, 写程序(程序));
  const c = spawnSync(exe, [码路], { encoding: "utf8" });

  return {
    js: js出, js码: jsr.ok ? jsr.值 : null,
    c: String(c.stdout || ""), c码: c.status,
  };
};

console.log("一、算数、递归、字符串、元组、记录");
{
  const 源码 = fs.readFileSync(path.join(ROOT, "examples/arith.hmyr"), "utf8");
  const r = 两侧跑(源码, "arith");
  ok("两台机器输出一样", r.js === r.c, JSON.stringify(r.js) + " 对 " + JSON.stringify(r.c));
  ok("输出里有算对的那个数", r.c.includes("42"), JSON.stringify(r.c));
  ok("递归也算对了", r.c.includes("120"), JSON.stringify(r.c));
}

console.log("二、比较与分支");
{
  const 源码 = [
    "fn 分(n: Int) -> String {",
    '  if n < 0 { return "负" }',
    '  if n == 0 { return "零" }',
    '  return "正"',
    "}",
    "fn main() -> Int {",
    "  print(分(0 - 3))",
    "  print(分(0))",
    "  print(分(5))",
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "branch");
  ok("三分支都说对了", r.js === r.c && r.c === "负零正", JSON.stringify(r.js) + " 对 " + JSON.stringify(r.c));
}

console.log("三、字符串上的东西");
{
  const 源码 = [
    "fn main() -> Int {",
    '  let s = "琥珀音"',
    "  print(str(len(s)))",
    "  print(s)",
    '  let t = "ab" + "cd"',
    "  print(t)",
    "  print(slice(t, 1, 3))",
    "  print(str(ord(s)))",
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "strings");
  ok("字符串那一套两边一样", r.js === r.c, JSON.stringify(r.js) + " 对 " + JSON.stringify(r.c));
  ok("中文原样出来", r.c.includes("琥珀音"), JSON.stringify(r.c));
}

console.log("四、坏文件要被拒绝，而不是跑出怪结果");
{
  const 坏 = path.join(临, "bad.hmyrb");
  fs.writeFileSync(坏, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  const r = spawnSync(exe, [坏], { encoding: "utf8" });
  ok("不是 .hmyrb 就拒绝", r.status !== 0, String(r.status));
  const 空 = path.join(临, "empty.hmyrb");
  fs.writeFileSync(空, Buffer.alloc(0));
  const r2 = spawnSync(exe, [空], { encoding: "utf8" });
  ok("空文件也拒绝", r2.status !== 0, String(r2.status));
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
