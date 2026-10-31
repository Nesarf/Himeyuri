// 自举比例的两份：宿主那一份（tools/self-ratio.mjs）与 HMYR 那一份
// （tools/self-ratio.hmoca）。两份都在数同一个仓库，而数出来的行数必须一样。
//
// 比的是行数，不比份数与百分比：HMYR 那一版只报行数 —— 元组返回值在那一层的类型
// 推断过不去（见它自己的注释），所以份数与百分比只有宿主那一份有。少一半的对照仍然
// 有意义：行数是这一份工具真正报出来的东西，而份数从行数推不出来，留着等它补。
//
// 也不比打印的排版：两份的列宽与分组标签各写各的，那些是给人的，不是给判据的。
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

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc —— 自举比例的对照不运行");
  console.log("");
  console.log("0 passed, 0 failed");
  process.exit(0);
}

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-ratio-"));
const exe = path.join(临, "hmyr.exe");
const 编 = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe,
  path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
ok("vm/hmyr.c 编得出来", 编.status === 0, String(编.stderr).slice(0, 200));
if (!fs.existsSync(exe)) {
  console.log("");
  console.log(passed + " passed, " + failed + " failed");
  fs.rmSync(临, { recursive: true, force: true });
  process.exit(1);
}

// 每一条分组行交回 (组名, 行数)。「合计」那一条单独解析：它带着两个数。
const 解析 = (出) => {
  const 组 = [];
  for (const 行 of String(出).split("\n")) {
    if (/^\s*合计/.test(行)) continue;
    const m = /^\s*(.+?)\s+(?:\d+\s+份\s+)?(\d+)\s+行/.exec(行);
    if (m) 组.push([m[1].trim(), Number(m[2])]);
  }
  const t = /合计 (\d+) 行，其中 HMYR 写的 (\d+) 行/.exec(String(出));
  return { 组, 合计: t ? Number(t[1]) : -1, 自举行: t ? Number(t[2]) : -1 };
};

console.log("一、两份都跑完");
const 宿主 = spawnSync(process.execPath, [path.join(ROOT, "tools/self-ratio.mjs")],
  { cwd: ROOT, encoding: "utf8", timeout: 600000 });
ok("宿主那一份退出码 0", 宿主.status === 0, String(宿主.stderr).slice(0, 200));
const 甲 = 解析(宿主.stdout);

const 乙跑 = spawnSync(exe, ["tools/self-ratio.hmoca"], {
  cwd: ROOT, encoding: "utf8", timeout: 900000,
  env: { ...process.env, HMYR_STEPS: "2000000000" },
});
ok("HMYR 那一份退出码 0", 乙跑.status === 0,
  (String(乙跑.stdout) + String(乙跑.stderr)).slice(0, 300));
const 乙 = 解析(乙跑.stdout);

console.log("二、分组对得上");
ok("两组的分组数相同（" + 甲.组.length + " 组）", 甲.组.length === 乙.组.length && 甲.组.length > 0,
  "宿 " + 甲.组.length + " / HMYR " + 乙.组.length);
const 名甲 = 甲.组.map((x) => x[0]).join(" | ");
const 名乙 = 乙.组.map((x) => x[0]).join(" | ");
ok("分组的名字与顺序相同", 名甲 === 名乙, "宿 " + 名甲 + " / HMYR " + 名乙);

console.log("三、每一组的行数相同");
for (let i = 0; i < Math.min(甲.组.length, 乙.组.length); i++) {
  const [名, 数] = 甲.组[i];
  const 对应 = 乙.组[i] ? 乙.组[i][1] : -1;
  ok("  " + 名 + "  " + 数 + " 行", 数 === 对应, "宿 " + 数 + " / HMYR " + 对应);
}

console.log("四、合计与分子");
ok("合计行数相同（" + 甲.合计 + " 行）", 甲.合计 === 乙.合计 && 甲.合计 > 0,
  "宿 " + 甲.合计 + " / HMYR " + 乙.合计);
ok("HMYR 写的行数相同（" + 甲.自举行 + " 行）", 甲.自举行 === 乙.自举行,
  "宿 " + 甲.自举行 + " / HMYR " + 乙.自举行);
const 加和 = 甲.组.reduce((s, x) => s + x[1], 0);
ok("分组之和就是合计（两边都是）", 加和 === 甲.合计,
  "分组和 " + 加和 + " / 合计 " + 甲.合计);

console.log("");
console.log(passed + " passed, " + failed + " failed");
fs.rmSync(临, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
