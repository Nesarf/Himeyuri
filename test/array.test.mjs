// 可变数组：读、写、越界、元组不被污染、解释器与字节码两条路一致。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 一个测试程序：数组的四种用法各一次。
const 程序 = [
  "fn main() -> Int {",
  "  let t = (1, 2, 3)",
  "  let a = 数组(t)",
  "  设(a, 0, 10)",
  "  设(a, 2, 30)",
  "  print(str(a[0]) + \",\" + str(a[1]) + \",\" + str(a[2]) + chr(10))",
  "  print(str(len(a)) + chr(10))",
  "  // 原元组不该被改",
  "  print(str(t[0]) + \",\" + str(t[2]) + chr(10))",
  "  // 加出来的是新元组，不是数组",
  "  let b = a + (4,)",
  "  print(str(len(b)) + chr(10))",
  "  return 0",
  "}",
].join("\n");

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-array-"));
const 源 = path.join(临, "arr.hmoca");
fs.writeFileSync(源, 程序 + "\n");

console.log("一、解释器那条路");
{
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), 源], { encoding: "utf8", timeout: 120000 });
  const 出 = String(r.stdout || "").trim();
  ok("跑得动", r.status === 0, String(r.status) + " " + String(r.stderr).slice(0, 200));
  ok("设 之后读到的是新值", 出.split("\n")[0] === "10,2,30", 出.split("\n")[0] || "");
  ok("len 认数组", 出.split("\n")[1] === "3", 出.split("\n")[1] || "");
  ok("原元组没被改", 出.split("\n")[2] === "1,3", 出.split("\n")[2] || "");
  ok("加出来的是元组（长度四）", 出.split("\n")[3] === "4", 出.split("\n")[3] || "");
}

console.log("二、越界要报错，而不是悄悄写坏");
{
  const 源2 = path.join(临, "oob.hmoca");
  fs.writeFileSync(源2, [
    "fn main() -> Int {",
    "  let a = 数组((1, 2))",
    "  设(a, 5, 9)",
    "  return 0",
    "}",
    "",
  ].join("\n"));
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), 源2], { encoding: "utf8", timeout: 120000 });
  ok("越界不通过", r.status !== 0, String(r.status));
  ok("报的是下标那条", String(r.stderr).includes("下标越出数组") || String(r.stdout).includes("下标越出数组"), String(r.stderr).slice(0, 160));
}

console.log("三、设 拒绝元组");
{
  const 源3 = path.join(临, "tuple.hmoca");
  fs.writeFileSync(源3, [
    "fn main() -> Int {",
    "  let t = (1, 2)",
    "  设(t, 0, 9)",
    "  return 0",
    "}",
    "",
  ].join("\n"));
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), 源3], { encoding: "utf8", timeout: 120000 });
  ok("对元组设 不通过", r.status !== 0, String(r.status));
  ok("报的是「要可变数组」", String(r.stderr).includes("可变数组") || String(r.stdout).includes("可变数组"), String(r.stderr).slice(0, 160));
}

console.log("四、C 那台也认：同一份程序给出同一个答案");
{
  const 有编译器 = (() => {
    try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
  })();
  if (!有编译器) {
    console.log("  跳过  这台机器上没有 gcc");
  } else {
    const exe = path.join(临, "hmyr-array.exe");
    const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
    ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 200));
    if (c.status === 0) {
      const r = spawnSync(exe, [源], { encoding: "utf8", timeout: 300000 });
      const 出 = String(r.stdout || "").trim().split("\n");
      ok("C 那台跑得动", r.status === 0, String(r.status) + " " + String(r.stderr).slice(0, 200));
      ok("设 在 C 那台也生效", 出[0] === "10,2,30", 出[0] || "");
      ok("原元组在 C 那台也没被改", 出[2] === "1,3", 出[2] || "");
    }
  }
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
