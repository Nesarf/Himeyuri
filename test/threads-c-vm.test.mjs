// 线程：两台机器同一个答案 —— 这一套现在本该红。
//
// 为什么写一套现在红的验收：design/SELFRUN.txt 的第三刀是「真正的实例化」，
// 而那一刀要改函数签名。签名一改，现有套件能证明的就不再是「行为不变」，
// 而是「改到这里还没坏」。所以在动它之前，先把「什么样算做完了」写下来，
// 让它红着 —— 红的验收是尺子，绿的才是账。
//
// 判据三条，都是两台机器逐字相同：
//   一、两个线程同时活着，各自算出一加到九十九的和
//   二、隔离是硬的：worker 里那个 x 与主线程那个 x 互不相干
//   三、都在 join 之前活着（thr_count 是 2，不是 1，也不是 0）
//
// C 那台现在交回的是「这一台没有线程」：spawn 给 -1、join 报 R0221。
// 那不是缺陷，是它如实说了；这一套要的是它不再这么说。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { 写程序 } from "../src/code-file.mjs";
import { 虚拟机 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc —— 线程的两台对照不运行");
  console.log("");
  console.log("0 passed, 0 failed");
  process.exit(0);
}

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-thrc-"));
const exe = path.join(临, "hmyr-vm.exe");
{
  const r = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("vm/hmyr.c 编得出来", r.status === 0, String(r.stderr).slice(0, 200));
}
if (!fs.existsSync(exe)) {
  console.log("");
  console.log(passed + " passed, " + failed + " failed");
  fs.rmSync(临, { recursive: true, force: true });
  process.exit(1);
}

const 写 = (名, 内容) => {
  const p = path.join(临, 名);
  fs.writeFileSync(p, 内容, "utf8");
  return p.replace(/\\/g, "/");
};

// 与 c-vm 那一套同一个形状：同一份字节码，JS 那台跑内存里的，C 那台跑文件里的。
const 两侧跑 = (源码, 名字) => {
  const 源路 = path.join(临, 名字 + ".hmoca");
  fs.writeFileSync(源路, 源码, "utf8");
  const unit = loadUnit(源路);
  if (!unit.ok) return { js: "", c: "", 错: "加载失败" };
  const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))));
  let js出 = "";
  const vm = new 虚拟机(程序, { capabilities: 本机能力(), write: (s) => { js出 += s; } });
  const jsr = vm.调用("main", [], null);
  const 码路 = path.join(临, 名字 + ".hmoks");
  fs.writeFileSync(码路, 写程序(程序));
  const c = spawnSync(exe, [码路], { encoding: "utf8", timeout: 120000 });
  return { js: js出, c: String(c.stdout || ""), js码: jsr.ok ? jsr.值 : null, c码: c.status, c错: String(c.stderr || "") };
};

// 两个任务：一个是求和，一个验隔离（worker 里的 x 从 100 起）。
const 求和任务 = 写("sum.hmoca", [
  "fn 工作() -> Int {",
  "  var i = 0",
  "  var s = 0",
  "  while i < 100 {",
  "    s = s + i",
  "    i = i + 1",
  "  }",
  "  return s",
  "}",
  "",
].join("\n"));
const 隔离任务 = 写("iso.hmoca", [
  "fn 工作() -> Int {",
  "  var x = 100",
  "  x = x + 1",
  "  return x",
  "}",
  "",
].join("\n"));

console.log("一、两个线程同时活着，各自算完");
{
  const 源码 = [
    "fn main() -> Int effects(thread, file) {",
    '  let 源码 = read_text("' + 求和任务 + '", "utf8")',
    '  let 甲 = thr_spawn(源码, "工作")',
    '  let 乙 = thr_spawn(源码, "工作")',
    "  print(str(thr_count()))",
    "  let 一 = thr_join(甲, 30000)",
    "  let 二 = thr_join(乙, 30000)",
    '  print("|" + str(一) + "|" + str(二))',
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "twothreads");
  // 先断言 JS 那台自己对 —— 少了这一条，「两台输出一样」在两边都错的时候也成立，
  // 而那正是这一套第一次跑出来的样子（两台都只打了一个 0）。
  ok("JS 那台自己先跑对", r.js.trim().startsWith("2|4950|4950"), JSON.stringify(r.js));
  ok("两台机器输出一样", r.js === r.c, JSON.stringify(r.js) + " 对 " + JSON.stringify(r.c));
  ok("两个都算对了（一加到九十九是 4950）", r.c.includes("4950|4950"), JSON.stringify(r.c));
  ok("join 之前两个都活着", /^2\|/.test(r.c.trim()), JSON.stringify(r.c));
}

console.log("二、隔离是硬的：worker 里的名字与主线程无关");
{
  const 源码 = [
    "fn main() -> Int effects(thread, file) {",
    "  var x = 1",
    '  let 源码 = read_text("' + 隔离任务 + '", "utf8")',
    '  let 手 = thr_spawn(源码, "工作")',
    "  let 果 = thr_join(手, 30000)",
    '  print(str(果) + "|" + str(x))',
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "isolation");
  ok("JS 那台自己先跑对", r.js.trim() === "101|1", JSON.stringify(r.js));
  ok("两台机器输出一样", r.js === r.c, JSON.stringify(r.js) + " 对 " + JSON.stringify(r.c));
  ok("worker 算出 101，而主线程的 x 还是 1", r.c.trim() === "101|1", JSON.stringify(r.c.trim()));
}

console.log("三、句柄用完之后就没了");
{
  const 源码 = [
    "fn main() -> Int effects(thread, file) {",
    '  let 源码 = read_text("' + 求和任务 + '", "utf8")',
    '  let 手 = thr_spawn(源码, "工作")',
    "  let 一 = thr_join(手, 30000)",
    "  print(str(一) + \"|\" + str(thr_count()))",
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "gone");
  ok("JS 那台自己先跑对", r.js.trim() === "4950|0", JSON.stringify(r.js));
  ok("两台机器输出一样", r.js === r.c, JSON.stringify(r.js) + " 对 " + JSON.stringify(r.c));
  ok("join 之后没有活着的线程", r.c.trim() === "4950|0", JSON.stringify(r.c.trim()));
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
