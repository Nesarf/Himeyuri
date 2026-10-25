// SHA-256：拿 node 的 createHash 逐条对，包括空串与跨块的那种。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
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
const 真 = (b) => createHash("sha256").update(b).digest("hex");

console.log("一、源码读得动");
const 源路 = path.join(ROOT, "self/sha256.hmoca");
ok("self/sha256.hmoca 在", fs.existsSync(源路));
const unit = loadUnit(源路);
ok("加载没有诊断", unit.ok, JSON.stringify(unit.diagnostics.errors.slice(0, 1).map((e) => e.code)));

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-sha-"));
  const exe = path.join(临, "hmyr.exe");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
  if (c.status === 0) {
    const 码路 = path.join(临, "sha256.hmoks");
    fs.writeFileSync(码路, 写程序(合并程序(unit.order.map((f) => 编译模块(unit.modules.get(f))), 编译模块(unit.modules.get(unit.order[unit.order.length - 1])))));

    console.log("二、拿 node 的 sha256 对");
    const 样本 = [
      ["空串", Buffer.alloc(0)],
      ["一个字节", Buffer.from("a")],
      ["abc", Buffer.from("abc")],
      // 55 字节：填充后正好跨进第二块，是长度写法的边界。
      ["55 字节", Buffer.from("x".repeat(55))],
      ["64 字节", Buffer.from("y".repeat(64))],
      ["200 字节", Buffer.from("z".repeat(200))],
    ];
    for (const [名, 数据] of 样本) {
      const 路 = path.join(临, "s.bin");
      fs.writeFileSync(路, 数据);
      const r = spawnSync(exe, [码路, 路], {
        encoding: "utf8", timeout: 600000,
        env: { ...process.env, HMYR_STEPS: "40000000000", HMYR_GC: "1", HMYR_MEM_LIMIT: "0" },
      });
      const 出 = String(r.stdout || "").trim();
      const 应 = 真(数据);
      ok(名 + " 与 node 一致", 出 === 应, (出 || "（空）") + " 对 " + 应);
    }
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
