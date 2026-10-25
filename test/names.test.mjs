// 两套名字并存：新名与旧名都要跑得动。
//
// 这一套是 design/FILETYPE.txt 第七节第一步的验收。改名分三步走，第一步是
// 「工具同时认两套」，而那一步最容易出的错不是报错 —— 是某一处漏了判断，
// 于是某一个名字安静地不被认。所以三种名字各验一遍，而且两台机器都验。
//
//   .hmyr  ↔ .hmoca     源码
//   .hmyrb ↔ .hmoks     字节码
//   .hmtn               种子（字节码的特例，单独一个名字）
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

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-names-"));
const 源码 = [
  "fn main() -> Int {",
  '  print("名字")',
  "  return 0",
  "}",
  "",
].join("\n");

console.log("一、同一个程序的两个名字，宿主那侧都读得进");
{
  const 甲 = path.join(临, "a.hmyr");
  const 乙 = path.join(临, "b.hmoca");
  fs.writeFileSync(甲, 源码, "utf8");
  fs.writeFileSync(乙, 源码, "utf8");
  const 一 = loadUnit(甲);
  const 二 = loadUnit(乙);
  ok("旧名读得进", 一.ok, JSON.stringify(一.diagnostics?.errors?.slice(0, 1) || []));
  ok("新名读得进", 二.ok, JSON.stringify(二.diagnostics?.errors?.slice(0, 1) || []));
  const 树一 = 一.ok ? JSON.stringify(一.modules.get(一.order[0])) : "";
  const 树二 = 二.ok ? JSON.stringify(二.modules.get(二.order[0])) : "";
  ok("两棵树一样", 树一 !== "" && 树一 === 树二, 树一.slice(0, 80) + " 对 " + 树二.slice(0, 80));
}

// 下面几节要 C 那台：扩展名分派在它那里是真的判定，宿主那侧不判名字。
const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc —— C 那台那几节不运行");
} else {
  const exe = path.join(临, "hmyr.exe");
  {
    const r = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe,
      path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
    ok("vm/hmyr.c 编得出来", r.status === 0, String(r.stderr).slice(0, 200));
  }

  const unit = loadUnit(path.join(临, "a.hmyr"));
  const 程序 = 合并程序(unit.order.map((f) => 编译模块(unit.modules.get(f))));
  const 字节 = 写程序(程序);

  console.log("二、字节码的两个名字，C 那台都跑得对");
  {
    const 甲 = path.join(临, "p.hmyrb");
    const 乙 = path.join(临, "p.hmoks");
    fs.writeFileSync(甲, 字节);
    fs.writeFileSync(乙, 字节);
    const 一 = spawnSync(exe, [甲], { encoding: "utf8" });
    const 二 = spawnSync(exe, [乙], { encoding: "utf8" });
    ok("旧名跑出 名字", String(一.stdout).trim() === "名字", JSON.stringify(String(一.stdout)));
    ok("新名跑出同样的东西", String(二.stdout) === String(一.stdout), JSON.stringify(String(二.stdout)));
    ok("两边退出码都是零", 一.status === 0 && 二.status === 0, 一.status + " / " + 二.status);
  }

  console.log("三、新名的源码走「种子编了再跑」那条路");
  {
    const 源路 = path.join(临, "c.hmoca");
    fs.writeFileSync(源路, 源码, "utf8");
    const r = spawnSync(exe, [源路], { encoding: "utf8", timeout: 300000, env: { ...process.env, HMYR_STEPS: "4000000000" } });
    ok("C 那台把它当源码编", String(r.stdout).trim() === "名字", JSON.stringify(String(r.stdout)) + " / " + String(r.stderr).slice(0, 80));
  }

  console.log("四、种子换个名字（.hmtn）也认得");
  {
    const 种子 = path.join(临, "pack.hmtn");
    fs.copyFileSync(path.join(ROOT, "bootstrap/pack.hmyrb"), 种子);
    const 源路 = path.join(临, "d.hmoca");
    fs.writeFileSync(源路, 源码, "utf8");
    const r = spawnSync(exe, [源路], {
      encoding: "utf8", timeout: 300000,
      env: { ...process.env, HMYR_SEED: 种子, HMYR_STEPS: "4000000000" },
    });
    ok("用 .hmtn 当种子也跑出 名字", String(r.stdout).trim() === "名字", JSON.stringify(String(r.stdout)) + " / " + String(r.stderr).slice(0, 80));
  }
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
