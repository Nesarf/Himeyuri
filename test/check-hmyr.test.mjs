// HMYR 写的那一份测试调度器：读清单、跑套件、汇总。
//
// 这是「工具链搬进 HMYR」的第一项。它只用两件世界面：读文本与跑程序，
// 而两件都在 C 机器上验过了。套件本身仍是 node 脚本 —— 它们要拿 src/ 当对照。
//
// 这一套跑一个小清单（三个快套件），因为全量清单串行跑要好几分钟，
// 而这里要验的是「调度器算得对」，不是「套件都过」。
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

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

console.log("一、调度器的源码读得动");
const 源路 = path.join(ROOT, "self/check.hmyr");
ok("self/check.hmyr 在", fs.existsSync(源路));
const unit = loadUnit(源路);
ok("加载没有诊断", unit.ok, JSON.stringify(unit.diagnostics.errors.slice(0, 1).map((e) => e.code)));
const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))));
ok("它编出了函数表", 程序.函数们.size >= 3, String(程序.函数们.size));

console.log("二、全量清单在仓库里，而且是从 check-all 导出来的");
{
  const 全清单 = path.join(ROOT, "tools/suite-list.txt");
  ok("tools/suite-list.txt 在", fs.existsSync(全清单));
  if (fs.existsSync(全清单)) {
    const 行们 = fs.readFileSync(全清单, "utf8").trim().split("\n").filter((l) => l.includes("\t"));
    ok("清单至少一百条", 行们.length >= 100, String(行们.length));
    ok("每条都是「名字 + 路径」", 行们.every((l) => {
      const 列 = l.split("\t");
      return 列.length === 2 && (列[1].startsWith("test/") || 列[1].startsWith("tools/"));
    }), 行们[0] || "");
  }
}

console.log("三、它真的调度得动：跑三个快套件");
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc —— 调度器跑不起来");
} else {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-check-"));
  const exe = path.join(临, "hmyr.exe");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
  if (c.status === 0) {
    const 码路 = path.join(临, "check.hmyrb");
    fs.writeFileSync(码路, 写程序(程序));
    const 小清单 = path.join(临, "list.txt");
    fs.writeFileSync(小清单, "lexer\ttest/lexer.test.mjs\nparser\ttest/parser.test.mjs\neval\ttest/eval.test.mjs\n", "utf8");
    const r = spawnSync(exe, [码路, 小清单], {
      cwd: ROOT, encoding: "utf8", timeout: 300000,
      env: { ...process.env, HMYR_STEPS: "2000000000" },
    });
    ok("三个套件都跑完了", r.status === 0, String(r.status) + " " + String(r.stderr).slice(0, 160));
    ok("汇总写着 3 passed, 0 failed", String(r.stdout).includes("3 passed, 0 failed"), JSON.stringify(String(r.stdout).trim().slice(-60)));
    ok("没有一行不通过", !String(r.stdout).includes("不通过"), String(r.stdout).slice(0, 120));
    ok("每一行都有套件名", ["lexer", "parser", "eval"].every((名) => String(r.stdout).includes(名)), String(r.stdout).slice(0, 120));
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
