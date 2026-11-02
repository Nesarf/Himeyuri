// doc-stats.hmoca 的数字：tools/ 下唯一一件只数数、不判断的 HMYR 工具。
//
// design/ 里那句「39 份 11106 行」是一次手动跑的记忆，而这个套件把记忆变成判据 ——
// 让工具数一遍，测试自己用 JS 再数一遍，两份数字必须一样。
//
// 为什么测试自己数，而不是调一个「对照工具」：这一件从来没有 JS 版。对着 JS 的
// readdir 与 split 各走一趟，比对着另一个同名工具更直接，也不会多养一份要维护的实现。
//
// 行的口径要照工具那一份来：末尾一个换行不算多出一行（tools/doc-stats.hmoca 的 数行）。
// 用别处的口径来比会让这一套莫名其妙地红，而那种红说明不了任何事。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { 平台参数 } from "../src/cc.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc —— doc-stats 这一套不运行");
  console.log("");
  console.log("0 passed, 0 failed");
  process.exit(0);
}

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-docstats-"));
const exe = path.join(临, "hmyr.exe");
const 编 = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", ...平台参数(), "-o", exe,
  path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
ok("vm/hmyr.c 编得出来", 编.status === 0, String(编.stderr).slice(0, 200));
if (!fs.existsSync(exe)) {
  console.log("");
  console.log(passed + " passed, " + failed + " failed");
  fs.rmSync(临, { recursive: true, force: true });
  process.exit(1);
}

// 与工具里 数行 同一个口径：末尾一个换行不算多出一行。
const 数行 = (内容) => {
  const 段 = 内容.split("\n");
  if (段.length > 0 && 段[段.length - 1] === "") return 段.length - 1;
  return 段.length;
};

const 自己数 = (起) => {
  let 份 = 0, 行 = 0;
  const 走 = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const 全 = path.join(dir, e.name);
      if (e.isDirectory()) { 走(全); continue; }
      if (!e.name.endsWith(".txt")) continue;
      份++;
      行 += 数行(fs.readFileSync(全, "utf8"));
    }
  };
  走(起);
  return { 份, 行 };
};

console.log("一、工具跑得动");
const 跑 = spawnSync(exe, ["tools/doc-stats.hmoca"], {
  cwd: ROOT, encoding: "utf8", timeout: 600000,
  env: { ...process.env, HMYR_STEPS: "2000000000" },
});
ok("退出码 0", 跑.status === 0, (String(跑.stdout) + String(跑.stderr)).slice(0, 300));

const 份行 = /(\d+) 份，(\d+) 行/.exec(String(跑.stdout));
ok("输出里报出了份数与行数", 份行 !== null, String(跑.stdout).slice(0, 200));
const 甲 = 份行 ? { 份: Number(份行[1]), 行: Number(份行[2]) } : { 份: -1, 行: -1 };

console.log("二、数字对得上");
const 乙 = 自己数(path.join(ROOT, "design"));
ok("design/ 下有 .txt（" + 乙.份 + " 份）", 乙.份 > 0, String(乙.份));
ok("份数相同", 甲.份 === 乙.份, "工具 " + 甲.份 + " / 自己数 " + 乙.份);
ok("行数相同", 甲.行 === 乙.行, "工具 " + 甲.行 + " / 自己数 " + 乙.行);

console.log("三、平均那一行");
const 平 = /平均 (\d+) 行一份/.exec(String(跑.stdout));
ok("平均行数对得上", 平 !== null && Number(平[1]) === Math.floor(乙.行 / 乙.份),
  平 ? "工具 " + 平[1] + " / 自己算 " + Math.floor(乙.行 / 乙.份) : "没有这一行");

console.log("");
console.log(passed + " passed, " + failed + " failed");
fs.rmSync(临, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
