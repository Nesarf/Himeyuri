// 顶层 var：模块级、可写的名字。design/GLOBALS.txt 把它定下来，这一份验它成立。
//
// 三条判据：
//   一、读写都成立 —— 两次调用把模块级的计数推到 2，而四台机器都这么说。
//   二、const 不能重绑 —— 写它给一条说得清的错，不是静默改掉。
//   三、四台同一段 —— 默认、--host-eval、--compile，以及有 gcc 时的 C 那台。
//
// 自举层那一台最值得说：它的环境是纯传递的（函数体里改的那一层，函数一返回就没了），
// 所以可写的模块级名字住在一块共享的索引里，而 const 仍住环境。这一条写在
// self/eval.hmoca 的三处注释里：装常量从、Assign、Ident。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 具 = path.join(ROOT, "bin", "hmyr.mjs");
const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-gvar-"));
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 行们 = (v) => v.join("\n") + "\n";
const 投 = (内容, 名) => { const p = path.join(临, 名); fs.writeFileSync(p, 内容, "utf8"); return p; };
const 跑 = (参) => spawnSync(process.execPath, [具, ...参], { encoding: "utf8", cwd: 临, timeout: 300000 });
const 行 = (s) => String(s || "").split("\n").map((x) => x.trimEnd()).filter((x) => x.length > 0);

const 计数程序 = 行们([
  "var 计数 = 0",
  "",
  "fn 加一() -> Int {",
  "  计数 = 计数 + 1",
  "  return 计数",
  "}",
  "",
  "fn main() -> Int effects(process) {",
  "  let r = 加一()",
  "  let s = 加一()",
  "  print(\"计数=\" + str(计数) + chr(10))",
  "  return 0",
  "}",
]);

console.log("一、默认路径：读得到、写得上");
{
  const p = 投(计数程序, "甲.hmoca");
  const r = 跑([p]);
  const 出 = 行(r.stdout);
  ok("跑得动", r.status === 0, JSON.stringify({ status: r.status, err: (r.stderr || "").slice(0, 140) }));
  ok("两次调用之后是 2", 出.includes("计数=2"), JSON.stringify(出));
}

console.log("二、const 不能重绑");
{
  const p = 投(行们([
    "const 上限 = 10",
    "",
    "fn main() -> Int effects(process) {",
    "  上限 = 20",
    "  print(\"改掉了\" + chr(10))",
    "  return 0",
    "}",
  ]), "乙.hmoca");
  const r = 跑([p]);
  const 全出 = (r.stdout || "") + (r.stderr || "");
  ok("写 const 被拒", /const/.test(全出) && !全出.includes("改掉了"), JSON.stringify(全出.slice(0, 160)));
}

console.log("三、--host-eval 与 --compile 同一段");
{
  const p = 投(计数程序, "丙.hmoca");
  const 甲 = 跑([p]);
  const 乙 = 跑(["--host-eval", p]);
  const 丙 = 跑(["--compile", p]);
  ok("--host-eval 同一段", (乙.stdout || "") === (甲.stdout || ""),
    JSON.stringify([(乙.stdout || "").slice(0, 80), (甲.stdout || "").slice(0, 80)]));
  const 甲行 = 行(甲.stdout), 丙行 = 行(丙.stdout);
  ok("--compile 同一段", 丙.status === 0 && JSON.stringify(丙行) === JSON.stringify(甲行.slice(0, 丙行.length)),
    JSON.stringify([丙行, 甲行.slice(0, 丙行.length)]));
}

console.log("四、C 那台（要 gcc 编一次）");
{
  const 有gcc = (() => { try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; } })();
  if (!有gcc) {
    console.log("  跳过  这台机器上没有 gcc —— C 那台那一侧不验");
  } else {
    const exe = path.join(临, "hmyr-c.exe");
    const 编 = spawnSync("gcc", ["-std=c11", "-O2", "-Wl,--stack,67108864", "-o", exe,
      path.join(ROOT, "vm", "hmyr.c"), "-lm"], { encoding: "utf8" });
    ok("C 那台编得出来", 编.status === 0, String(编.stderr || "").slice(0, 160));
    const p = 投(计数程序, "丁.hmoca");
    const 机 = 跑(["--compile", p]);
    const 台 = spawnSync(exe, [p], {
      encoding: "utf8", cwd: 临, timeout: 300000,
      env: { ...process.env, HMYR_MEM_LIMIT: "0", HMYR_STEPS: "4000000000" },
    });
    const 台行 = 行(台.stdout), 机行 = 行(机.stdout);
    ok("C 那台跑得动", 台.status === 0, JSON.stringify({ status: 台.status, err: (台.stderr || "").slice(0, 200) }));
    ok("而且与字节码机逐行相同", JSON.stringify(台行) === JSON.stringify(机行), JSON.stringify([台行, 机行]));
  }
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
