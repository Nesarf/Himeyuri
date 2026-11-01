// 两份套件清单必须一模一样：check-all.mjs 里的 SUITES（权威，--list 导出的就是它）
// 与 tools/suite-list.txt（手抄的那一份，给 HMYR 写的调度器与文档引用）。
//
// 为什么需要这一套：2026-11-02 发现 cembed 只住在 suite-list.txt 里，没进 SUITES ——
// 于是它四天没有在全量里跑过，而手动跑它是能过的。两份文件都说「有这个套件」，
// 只有一份会真的跑它。这种不一致不报错，它只让一个套件静静消失。
//
// 不靠正则去读 check-all.mjs：那一份自己就有 --list，是同一个来源导出的。
// 用正则解析源码，等于在这一套里再抄一遍格式，而格式一变这里就假红。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

console.log("一、两份都读得动");
const 权威 = spawnSync(process.execPath, [path.join(ROOT, "tools/check-all.mjs"), "--list"],
  { cwd: ROOT, encoding: "utf8", timeout: 120000 });
ok("check-all.mjs --list 退出码 0", 权威.status === 0, String(权威.stderr).slice(0, 200));
const 权威行 = String(权威.stdout || "").split("\n").filter((l) => l.trim());
ok("权威清单不是空的", 权威行.length > 0, String(权威行.length));

// 手抄那一份是 CRLF —— 它是 Windows 上写出来的，按 \n 切开之后每行尾巴带一个 \r。
// 不脱掉它，路径比的是 "test/lexer.test.mjs\r"：那会既报「对应脚本不同」，又报「文件不在」，
// 而两条都会把读者引向完全错误的方向。
const 手抄行 = fs.readFileSync(path.join(ROOT, "tools/suite-list.txt"), "utf8")
  .split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim());
ok("手抄清单不是空的", 手抄行.length > 0, String(手抄行.length));

console.log("二、条数");
ok("两份的条数相同（" + 权威行.length + " 条）", 权威行.length === 手抄行.length,
  "权威 " + 权威行.length + " / 手抄 " + 手抄行.length);

console.log("三、一条不多一条不少");
{
  const 权威名 = 权威行.map((l) => l.split("\t")[0]);
  const 手抄名 = 手抄行.map((l) => l.split("\t")[0]);
  const 只在权威 = 权威名.filter((n) => !手抄名.includes(n));
  const 只在手抄 = 手抄名.filter((n) => !权威名.includes(n));
  ok("没有哪一条只在权威清单里", 只在权威.length === 0, 只在权威.slice(0, 5).join(", "));
  ok("没有哪一条只在手抄清单里", 只在手抄.length === 0, 只在手抄.slice(0, 5).join(", "));

  // 名字重复会让「按名字挑」这个动作变得不确定：--only 会把两条都跑起来。
  const 重名 = 权威名.filter((n, i) => 权威名.indexOf(n) !== i);
  ok("名字没有重复", 重名.length === 0, 重名.slice(0, 5).join(", "));
  const 手抄重名 = 手抄名.filter((n, i) => 手抄名.indexOf(n) !== i);
  ok("手抄那份也没有重名", 手抄重名.length === 0, 手抄重名.slice(0, 5).join(", "));
}

console.log("四、同一条的两份说法一致");
{
  const 权威表 = new Map(权威行.map((l) => { const [名, 路] = l.split("\t"); return [名, 路]; }));
  const 分歧 = [];
  for (const l of 手抄行) {
    const [名, 路] = l.split("\t");
    if (权威表.has(名) && 权威表.get(名) !== 路) 分歧.push(名 + ": " + 权威表.get(名) + " 对 " + 路);
  }
  ok("同一个名字对应的脚本相同", 分歧.length === 0, 分歧.slice(0, 3).join(" · "));
}

console.log("五、每一条指的文件真的在");
{
  const 缺 = [];
  for (const l of 权威行) {
    const [名, 路] = l.split("\t");
    if (!路 || !fs.existsSync(path.join(ROOT, 路))) 缺.push(名 + " -> " + 路);
  }
  ok("权威清单里每一条都指向存在的文件", 缺.length === 0, 缺.slice(0, 5).join(", "));
  const 手抄缺 = [];
  for (const l of 手抄行) {
    const [名, 路] = l.split("\t");
    if (!路 || !fs.existsSync(path.join(ROOT, 路))) 手抄缺.push(名 + " -> " + 路);
  }
  ok("手抄清单里每一条也都在", 手抄缺.length === 0, 手抄缺.slice(0, 5).join(", "));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
