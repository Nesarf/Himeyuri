// else 之前可以有换行。
//
// 这是 SPEC 2.2 那条边界被放宽的那一次：换行仍然是 token、仍然是语句分界，
// 但「if 块之后」这个位置不是 —— 于是 } 换行 else { 与 } else { 读成同一棵树。
//
// 验收两条：两种写法都编得过、都跑得出同一个答案；以及无障碍的那一种（else 同行）没被改坏。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 同行 = "fn 选(n: Int) -> Int {\n  if n > 0 { return 1 } else { return 2 }\n}\n\nfn main() -> Int {\n  print(str(选(1)) + str(选(0)) + chr(10))\n  return 0\n}\n";
const 换行 = "fn 选(n: Int) -> Int {\n  if n > 0 { return 1 }\n  else { return 2 }\n}\n\nfn main() -> Int {\n  print(str(选(1)) + str(选(0)) + chr(10))\n  return 0\n}\n";

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-else-"));
const 甲路 = path.join(临, "same.hmyr");
const 乙路 = path.join(临, "next.hmyr");
fs.writeFileSync(甲路, 同行, "utf8");
fs.writeFileSync(乙路, 换行, "utf8");

console.log("一、两种写法都能读成树");
const 甲 = loadUnit(甲路);
ok("} else { 能编", 甲.ok, JSON.stringify(甲.diagnostics.errors.slice(0, 1).map((e) => e.code)));
const 乙 = loadUnit(乙路);
ok("} 换行 else { 也能编", 乙.ok, JSON.stringify(乙.diagnostics.errors.slice(0, 1).map((e) => e.code)));
ok("两种写法的 diagnostic 都干净", 甲.diagnostics.errors.length === 0 && 乙.diagnostics.errors.length === 0, "");

console.log("二、它们跑出同一个答案");
const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const exe = path.join(临, "hmyr.exe");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
  if (c.status === 0) {
    const 跑 = (路, 名) => {
      const 码 = path.join(临, 名 + ".hmyrb");
      const e = spawnSync("node", [path.join(ROOT, "tools/emit-code.mjs"), 路, 码], { encoding: "utf8" });
      if (e.status !== 0) return { 错: String(e.stderr).slice(0, 200) };
      const r = spawnSync(exe, [码], { encoding: "utf8", timeout: 60000, env: { ...process.env, HMYR_STEPS: "2000000000" } });
      return { 码: r.status, 出: String(r.stdout || "") };
    };
    const 甲跑 = 跑(甲路, "same");
    const 乙跑 = 跑(乙路, "next");
    ok("同行那一份跑得出 12", 甲跑.码 === 0 && 甲跑.出 === "12\n", JSON.stringify(甲跑));
    ok("换行那一份跑得出同一个 12", 乙跑.码 === 0 && 乙跑.出 === "12\n", JSON.stringify(乙跑));
  }
}
fs.rmSync(临, { recursive: true, force: true });

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
