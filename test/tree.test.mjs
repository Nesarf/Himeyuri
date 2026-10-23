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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

console.log("一、工具的源码读得动");
const 源路 = path.join(ROOT, "self/tree.hmyr");
ok("self/tree.hmyr 在", fs.existsSync(源路));
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
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
  if (c.status === 0) {
    const 码路 = path.join(临, "tree.hmyrb");
    fs.writeFileSync(码路, 写程序(程序));
    const 样本 = path.join(临, "sample.bin");
    fs.writeFileSync(样本, fs.readFileSync(path.join(ROOT, "bootstrap/pack.hmyrb")).subarray(0, 4096));
    const r = spawnSync(exe, [码路, 样本], {
      encoding: "utf8", timeout: 600000,
      env: { ...process.env, HMYR_STEPS: "20000000000", HMYR_GC: "1", HMYR_MEM_LIMIT: "0" },
    });
    const 出 = String(r.stdout || "");
    ok("跑得动", r.status === 0, String(r.status) + " " + String(r.stderr).slice(0, 160));
    ok("字长那张表的 Kraft 和是 32768", /字长：.*Kraft 和 32768/.test(出), 出.split("\n").find((l) => l.startsWith("字长")) || "");
    ok("距长那张表的 Kraft 和是 32768", /距长：.*Kraft 和 32768/.test(出), 出.split("\n").find((l) => l.startsWith("距长")) || "");
    ok("码长码表那张表的 Kraft 和是 32768", /码长码表.*Kraft 和 32768/.test(出), 出.split("\n").find((l) => l.startsWith("码长码表")) || "");
    ok("最大深没有超过十五", !/最大深 1[6-9]|最大深 [2-9][0-9]/.test(出), "");
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
