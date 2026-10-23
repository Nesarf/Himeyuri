// HMYR 写的语料生成器：从 codepoints.txt 生成两张 C 用的区间表。
//
// 这是「语料生成」这一项的第一支（字母与记号两张表）。验收方式是最结实的那种：
// 同一段小样本喂给两份实现（tools/ucd-c.mjs 与 self/ucd-c.hmyr），
// 产物必须逐字节相同 —— 不是「看起来一样」，是比较之后相同。
//
// 小样本取 codepoints.txt 的前两千行：一份五十万行的全量对拍太慢，
// 而前两千行里字母、记号、空行、奇怪的行都有，够把解析与排版都走一遍。
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

console.log("一、生成器的源码读得动");
const 源路 = path.join(ROOT, "self/ucd-c.hmyr");
ok("self/ucd-c.hmyr 在", fs.existsSync(源路));
const unit = loadUnit(源路);
ok("加载没有诊断", unit.ok, JSON.stringify(unit.diagnostics.errors.slice(0, 1).map((e) => e.code)));
const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))));
ok("它编出了函数表", 程序.函数们.size >= 5, String(程序.函数们.size));

console.log("二、JS 那一份接得住一个输入与一个输出目录");
{
  const 源 = fs.readFileSync(path.join(ROOT, "tools/ucd-c.mjs"), "utf8");
  ok("它读命令行给的输入", 源.includes("process.argv[2]"), "");
  ok("它读命令行给的输出目录", 源.includes("process.argv[3]"), "");
}

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

console.log("三、两份喂同一段小样本，产物逐字节相同");
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-ucdc-"));
  const 甲 = path.join(临, "js");
  const 乙 = path.join(临, "hmyr");
  fs.mkdirSync(甲);
  fs.mkdirSync(乙);
  const 样本 = path.join(临, "sample.txt");
  const 全 = fs.readFileSync(path.join(ROOT, "runtime/ucd/codepoints.txt"), "utf8").split("\n");
  fs.writeFileSync(样本, 全.slice(0, 2000).join("\n") + "\n", "utf8");

  const js = spawnSync("node", [path.join(ROOT, "tools/ucd-c.mjs"), 样本, 甲], { encoding: "utf8" });
  ok("JS 那一份跑完了", js.status === 0, String(js.stderr).slice(0, 160));

  const exe = path.join(临, "hmyr.exe");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
  if (c.status === 0) {
    const 码路 = path.join(临, "ucdc.hmyrb");
    fs.writeFileSync(码路, 写程序(程序));
    const h = spawnSync(exe, [码路, 样本, 乙], {
      cwd: ROOT, encoding: "utf8", timeout: 300000,
      env: { ...process.env, HMYR_STEPS: "2000000000" },
    });
    ok("HMYR 那一份跑完了", h.status === 0, String(h.status) + " " + String(h.stderr).slice(0, 160));
    const 名们 = ["ucd-letter.h", "ucd-mark.h"];
    for (const 名 of 名们) {
      const a = fs.existsSync(path.join(甲, 名)) ? fs.readFileSync(path.join(甲, 名)) : null;
      const b = fs.existsSync(path.join(乙, 名)) ? fs.readFileSync(path.join(乙, 名)) : null;
      const 同 = !!a && !!b && a.length === b.length && Buffer.compare(a, b) === 0;
      ok(名 + " 两边逐字节相同（" + (a ? a.length : 0) + " 字节）", 同,
         a && b ? "长度 " + a.length + " 对 " + b.length : "有一边没有产物");
    }
    ok("两张表的段数都写着", String(h.stdout).includes("UCD_LETTER") && String(h.stdout).includes("UCD_MARK"), String(h.stdout).trim());
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
