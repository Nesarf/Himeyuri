// 只建树的诊断：三张表（字长、距长、码长码表）的 Kraft 和都必须恰好是 32768。
//
// 这一套的意义在于把「动态编码对不对」拆开：树若不满，写流的每一层都会跟着错，
// 而错的位置看起来在别处。实测 4 KB 样本：字长 147 符号深 10、距长 19 符号深 8、
// 码长码表 9 符号深 6，三个和都是 32768。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { 写程序 } from "../src/code-file.mjs";
import { 平台参数 } from "../src/cc.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

console.log("一、工具的源码读得动");
const 源路 = path.join(ROOT, "self/tree.hmoca");
ok("self/tree.hmoca 在", fs.existsSync(源路));
const unit = loadUnit(源路);
ok("加载没有诊断", unit.ok, JSON.stringify(unit.diagnostics.errors.slice(0, 1).map((e) => e.code)));
const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))), 编译模块(unit.modules.get(unit.order[unit.order.length - 1])));

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-tree-"));
  const exe = path.join(临, "hmyr.exe");
  // 编译与跑分开记：2026-11-06 全量里这一套跑了二十一分钟，而「时间花在哪一段」
  // 当时没有数 —— 编 C 机器（6347 行加 466 KB 的 pack_seed.h）与跑 HMYR 程序是两件事，
  // 而它们对负载的反应不一样。
  const 编起 = Date.now();
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", ...平台参数(), "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  const 编毫秒 = Date.now() - 编起;
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
  if (c.status === 0) {
    const 码路 = path.join(临, "tree.hmoks");
    fs.writeFileSync(码路, 写程序(程序));
    const 样本 = path.join(临, "sample.bin");
    fs.writeFileSync(样本, fs.readFileSync(path.join(ROOT, "bootstrap/pack.hmtn")).subarray(0, 4096));
    const t0 = Date.now();
    const r = spawnSync(exe, [码路, 样本], {
      encoding: "utf8", timeout: 600000,
      // HMYR_OPS=1：把这趟跑掉的步数打到 stderr。与 deflate 那一套同一个理由 ——
      // 2026-11-06 全量里这一套跑了二十一分钟，而单独跑八十六秒；当时缺的就是这个数，
      // 于是「撞步限」与「走错路」两种解释分不开。实测正常是 1.38 亿步。
      env: { ...process.env, HMYR_STEPS: "20000000000", HMYR_GC: "1", HMYR_MEM_LIMIT: "0", HMYR_OPS: "1" },
    });
    const 毫秒 = Date.now() - t0;
    const 步 = (() => { const m = /ops=(\d+)/.exec(String(r.stderr || "")); return m ? Number(m[1]) : null; })();
    const 出 = String(r.stdout || "");
    ok("跑得动", r.status === 0,
       String(r.status) + (步 === null ? "" : " · " + 步 + " 步") + " " + String(r.stderr).slice(0, 160));
    ok("字长那张表的 Kraft 和是 32768", /字长：.*Kraft 和 32768/.test(出), 出.split("\n").find((l) => l.startsWith("字长")) || "");
    ok("距长那张表的 Kraft 和是 32768", /距长：.*Kraft 和 32768/.test(出), 出.split("\n").find((l) => l.startsWith("距长")) || "");
    ok("码长码表那张表的 Kraft 和是 32768", /码长码表.*Kraft 和 32768/.test(出), 出.split("\n").find((l) => l.startsWith("码长码表")) || "");
    ok("最大深没有超过十五", !/最大深 1[6-9]|最大深 [2-9][0-9]/.test(出), "");
    // 步数是这一套的基线：正常 1.38 亿步。某一次跑了二十一分钟而没有这一行，
    // 那种时候说不出「是走错路还是每步变贵」—— 现在有得比了。
    if (步 !== null) {
      console.log("");
      console.log("这一趟：编 C 机器 " + (编毫秒 / 1000).toFixed(1) + "s · 跑 " +
        (毫秒 / 1000).toFixed(1) + "s · " + 步 + " 步");
    }
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
