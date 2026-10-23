// 32 位位运算：SHA-256 的地基，先把它自己验准。
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

console.log("一、源码读得动");
const 源路 = path.join(ROOT, "self/bitops.hmyr");
ok("self/bitops.hmyr 在", fs.existsSync(源路));
const unit = loadUnit(源路);
ok("加载没有诊断", unit.ok, JSON.stringify(unit.diagnostics.errors.slice(0, 1).map((e) => e.code)));

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-bitops-"));
  const exe = path.join(临, "hmyr.exe");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
  if (c.status === 0) {
    const 码路 = path.join(临, "bitops.hmyrb");
    fs.writeFileSync(码路, 写程序(合并程序(unit.order.map((f) => 编译模块(unit.modules.get(f))), 编译模块(unit.modules.get(unit.order[unit.order.length - 1])))));
    const r = spawnSync(exe, [码路], { encoding: "utf8", timeout: 300000 });
    const 出 = String(r.stdout || "").trim().split("\n");
    ok("跑得动", r.status === 0, String(r.status) + " " + String(r.stderr).slice(0, 160));
    // 与 node 自己的位运算逐条对照。
    const 应 = [
      String((12 & 10)),
      String((12 | 10)),
      String((12 ^ 10)),
      String((255 >>> 4)),
      String((4294967295 + 1) % 4294967296),
      String(((1 >>> 1 | 1 << 31) >>> 0)),
      String((((2147483648 << 1) | (2147483648 >>> 31)) >>> 0)),
    ];
    for (let k = 0; k < 应.length; k++) {
      ok("第 " + (k + 1) + " 条与 node 一致（" + 应[k] + "）", 出[k] === 应[k], 出[k] || "（空）");
    }
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
