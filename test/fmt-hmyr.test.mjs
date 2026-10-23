// HMYR 写的格式化器第一版：表达式。
//
// 它替换不了 src/format.mjs —— 那一份排的是整文件，要完整语句树。这一份只到表达式，
// 而它证明的是两条性质在 Himeyuri 里真的立得住：打印出来的东西再解析回同一棵树，
// 以及打印两次与打印一次一样。
//
// 验收用「已知期望 + 幂等」：每个例子都要排成写下来的那一种形式，再拿排好的那一行
// 喂回去，必须得到同样的字。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { 写程序 } from "../src/code-file.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

console.log("一、格式化器的源码读得动");
const 源路 = path.join(ROOT, "self/fmt.hmyr");
ok("self/fmt.hmyr 在", fs.existsSync(源路));
const unit = loadUnit(源路);
ok("加载没有诊断", unit.ok, JSON.stringify(unit.diagnostics.errors.slice(0, 1).map((e) => e.code)));
const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))));
ok("它把表达式解析器也带了进来", 程序.函数们.size >= 15, String(程序.函数们.size));

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

console.log("二、排版与括号都照规矩");
const 例子们 = [
  ["1+2*3", "1 + 2 * 3"],
  ["(1+2)*3", "(1 + 2) * 3"],
  ["a-(b-c)", "a - (b - c)"],
  ["1+2+3", "1 + 2 + 3"],
  ["x*y+z", "x * y + z"],
  ["(a+b)*(c-d)", "(a + b) * (c - d)"],
];
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-fmt-"));
  const exe = path.join(临, "hmyr.exe");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
  if (c.status === 0) {
    const 码路 = path.join(临, "fmt.hmyrb");
    fs.writeFileSync(码路, 写程序(程序));
    const 跑 = (输入) => spawnSync(exe, [码路, "--expr"], {
      input: 输入 + "\n", encoding: "utf8", timeout: 120000,
      env: { ...process.env, HMYR_STEPS: "2000000000" },
    });
    for (const [源, 期望] of 例子们) {
      const r = 跑(源);
      ok(源 + " 排成 " + 期望, String(r.stdout || "").trim() === 期望, JSON.stringify(String(r.stdout || "").trim()));
    }
    console.log("三、幂等：排好的再排一次还是它");
    for (const [, 期望] of 例子们) {
      const r = 跑(期望);
      ok(期望 + " 再排一次不变", String(r.stdout || "").trim() === 期望, JSON.stringify(String(r.stdout || "").trim()));
    }
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("四、整文件：六份源码缩进之后还能编，而且幂等");
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-fmt-file-"));
  const exe = path.join(临, "hmyr.exe");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
  if (c.status === 0) {
    const { loadUnit } = await import("../src/loader.mjs");
    const fs2 = fs;
    const 码2 = path.join(临, "fmt2.hmyrb");
    const 源路 = path.join(ROOT, "self/fmt.hmyr");
    const u0 = loadUnit(源路);
    const 份们 = u0.order.map((文件) => 编译模块(u0.modules.get(文件)));
    fs2.writeFileSync(码2, 写程序(合并程序(份们, 份们[份们.length - 1])));
    const 跑全 = (输入) => spawnSync(exe, [码2], {
      input: 输入, encoding: "utf8", timeout: 120000,
      env: { ...process.env, HMYR_STEPS: "2000000000" },
    });
    for (const 名 of ["lex", "chain", "stmt", "body", "compile", "pack"]) {
      const 源 = fs2.readFileSync(path.join(ROOT, "self", 名 + ".hmyr"), "utf8");
      const a = 跑全(源);
      const b = 跑全(String(a.stdout || ""));
      const 幂等 = String(a.stdout || "") === String(b.stdout || "");
      const 出 = path.join(临, 名 + ".hmyr");
      fs2.writeFileSync(出, String(a.stdout || ""), "utf8");
      const u = loadUnit(出);
      ok(名 + ".hmyr 缩进之后编得动", u.ok, JSON.stringify(u.diagnostics.errors.slice(0, 1).map((e) => e.code)));
      ok(名 + ".hmyr 再排一次不变", 幂等, "");
    }
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
