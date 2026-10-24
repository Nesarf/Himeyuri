// HMYR 写的嵌入器：把一份 .hmyrb 摊成 C 源码。
//
// 这是「工具链搬进 HMYR」的第二项。它只用三件世界面：读字节、拼文本、写文本 ——
// 而读字节（read_bytes）是这一轮新加的那一格，因为 read_text 会按 UTF-8 解码，
// 二进制一过就坏。
//
// 它顺带证实了一件事：在这个语言里「逐字节往一个串上拼」是平方级 ——
// 四万三千字节的字节码摊成 C 源码，逐字节拼会顶到四吉的内存上限。
// 所以它先入行、再折半拼接；这一条写在源码的注释里。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../tools/self-bridge.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { 写程序 } from "../src/code-file.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

console.log("一、嵌入器的源码读得动");
const 源路 = path.join(ROOT, "self/embed.hmyr");
ok("self/embed.hmyr 在", fs.existsSync(源路));
const unit = loadUnit(源路);
ok("加载没有诊断", unit.ok, JSON.stringify(unit.diagnostics.errors.slice(0, 1).map((e) => e.code)));
const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))));
ok("它编出了三个函数", 程序.函数们.size === 3, String(程序.函数们.size));

console.log("二、读字节那一格在四处都有");
{
  const 源 = [
    ["src/eval.mjs", fs.readFileSync(path.join(ROOT, "src/eval.mjs"), "utf8")],
    ["src/minimal-eval.mjs", fs.readFileSync(path.join(ROOT, "src/minimal-eval.mjs"), "utf8")],
    ["src/vm-builtins.mjs", fs.readFileSync(path.join(ROOT, "src/vm-builtins.mjs"), "utf8")],
    ["src/bytecode.mjs", fs.readFileSync(path.join(ROOT, "src/bytecode.mjs"), "utf8")],
    ["self/eval.hmyr", fs.readFileSync(path.join(ROOT, "self/eval.hmyr"), "utf8")],
    ["vm/hmyr.c", fs.readFileSync(path.join(ROOT, "vm/hmyr.c"), "utf8")],
  ];
  for (const [名, 文] of 源) ok(名 + " 认识 read_bytes", 文.includes("read_bytes"), "");
}

console.log("三、它真的嵌入得动：把种子摊成 C 源码");
const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-embed-"));
  const exe = path.join(临, "hmyr.exe");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
  if (c.status === 0) {
    const 码路 = path.join(临, "embed.hmyrb");
    fs.writeFileSync(码路, 写程序(程序));
    const 出 = path.join(临, "pack.c");
    const r = spawnSync(exe, [码路, path.join(ROOT, "bootstrap/pack.hmyrb"), 出, "pack_hmyrb"], {
      cwd: ROOT, encoding: "utf8", timeout: 300000,
      env: { ...process.env, HMYR_STEPS: "2000000000" },
    });
    ok("嵌入器跑完了", r.status === 0, String(r.status) + " " + String(r.stderr).slice(0, 160));
    if (fs.existsSync(出)) {
      const 文 = fs.readFileSync(出, "utf8");
      const 行们 = 文.split("\n");
      const 字节 = fs.statSync(path.join(ROOT, "bootstrap/pack.hmyrb")).size;
      ok("生成的行数在三千上下", 行们.length > 3000 && 行们.length < 4000, String(行们.length));
      ok("首行写着字节数", 行们[0].includes(String(字节) + " 字节"), JSON.stringify(行们[0]));
      ok("数组从 HMYRB 的魔数开始", (行们[2] || "").trim().startsWith("0x48, 0x4d, 0x59, 0x52, 0x42"), JSON.stringify((行们[2] || "").slice(0, 60)));
      ok("末行给出长度", 文.includes("pack_hmyrb_len = " + 字节 + ";"), "");
      ok("没有一行长到离谱", 行们.every((l) => l.length < 400), String(Math.max(...行们.map((l) => l.length))));
    } else {
      ok("生成的行数在三千上下", false, "没有产物");
    }
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
