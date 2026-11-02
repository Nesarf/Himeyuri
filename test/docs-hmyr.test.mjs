// 文档检查器的对照：宿主那一份（tools/check-docs.mjs）与 HMYR 那一份
// （tools/check-docs.hmoca，跑在 C 那台机器上）看同一棵树，给同一张清单。
//
// 为什么要有这一套：HMYR 版早就写好了（见 design/FULLSELF.txt「第三件的第一刀」），
// 但没有任何套件跑它 —— 于是「它能查」只是一次人手动跑过的记忆。这一套把那份记忆
// 变成判据：两份清单的路径集合相同、每一份的结论相同、末行的统计相同。
//
// 顺序不比。JS 版按 readdir 交回的顺序打印，HMYR 版按自己的遍历顺序打印，两者今天
// 就不一样；拿顺序当判据会红，而那种红说明不了任何事。
//
// 步限：HMYR 版默认的两亿步不够（撞在 17 个块上），这里放到二十亿。这不是它能改的
// 常量，是这一份工具在当前仓库规模下的真实代价 —— 写在这里，免得下一次又量一遍。
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

// 一、有没有编译器（没有就明说跳过，不算失败 —— 那不是这门语言的问题）
const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc —— 文档检查器的对照不运行");
  console.log("");
  console.log("0 passed, 0 failed");
  process.exit(0);
}

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-docs-"));
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

// 一张清单：路径 → 通过/不通过，外加末行的两个数。
const 解析 = (出) => {
  const 表 = new Map();
  for (const 行 of String(出).split("\n")) {
    const m = /^\s*\[(通过|不通过)\]\s+(\S+)\s*$/.exec(行);
    if (m) 表.set(m[2], m[1]);
  }
  const t = /(\d+) document\(s\) checked, (\d+) with rendering syntax/.exec(String(出));
  return { 表, 份数: t ? Number(t[1]) : -1, 违规: t ? Number(t[2]) : -1 };
};

console.log("一、两份清单");
const 宿主 = spawnSync(process.execPath, [path.join(ROOT, "tools/check-docs.mjs")],
  { cwd: ROOT, encoding: "utf8", timeout: 600000 });
ok("宿主那一份跑完（退出码 0）", 宿主.status === 0, String(宿主.stderr).slice(0, 200));
const 甲 = 解析(宿主.stdout);

const 乙跑 = spawnSync(exe, ["tools/check-docs.hmoca"], {
  cwd: ROOT, encoding: "utf8", timeout: 900000,
  env: { ...process.env, HMYR_STEPS: "2000000000" },
});
ok("HMYR 那一份跑完（退出码 0）", 乙跑.status === 0,
  (String(乙跑.stdout) + String(乙跑.stderr)).slice(0, 300));
const 乙 = 解析(乙跑.stdout);

console.log("二、条数对得上");
ok("两份的份数相同（" + 甲.份数 + " 份）", 甲.份数 === 乙.份数 && 甲.份数 > 0,
  "宿 " + 甲.份数 + " / HMYR " + 乙.份数);
ok("两份的违规数相同（" + 甲.违规 + " 份）", 甲.违规 === 乙.违规,
  "宿 " + 甲.违规 + " / HMYR " + 乙.违规);
ok("清单条目数与末行的份数一致", 甲.表.size === 甲.份数 && 乙.表.size === 乙.份数,
  "宿 " + 甲.表.size + " / HMYR " + 乙.表.size);

console.log("三、一份不多一份不少");
const 只有宿 = [...甲.表.keys()].filter((k) => !乙.表.has(k));
const 只有乙 = [...乙.表.keys()].filter((k) => !甲.表.has(k));
ok("没有哪一份只在宿主那边", 只有宿.length === 0, 只有宿.slice(0, 3).join(", "));
ok("没有哪一份只在 HMYR 那边", 只有乙.length === 0, 只有乙.slice(0, 3).join(", "));

console.log("四、同一份文档同一个结论");
const 分歧 = [...甲.表.entries()].filter(([k, v]) => 乙.表.has(k) && 乙.表.get(k) !== v).map(([k]) => k);
ok("没有一份是两边判得不一样", 分歧.length === 0, 分歧.slice(0, 3).join(", "));

console.log("");
console.log(passed + " passed, " + failed + " failed");
fs.rmSync(临, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
