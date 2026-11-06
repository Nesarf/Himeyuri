// tools/race-census.mjs 的判据：它抓得到竞态形状，而全仓今天是干净的。
//
// 两条缺一不可。只有「全仓 0 处」的话，工具坏掉（正则写错、净函数又把字符串抹了）
// 也会报 0，那是假绿 —— 第一版正是这样：它抓不到自己造的样本。只有「抓得到样本」
// 的话，全仓真的有一处也看不出来。
//
// 样本写在系统的临时目录里，用 --dir 指过去扫。自检不该往仓库里写文件，而
// check-all 是并行跑的，那种文件会被同一轮里别的套件看见。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 扫 = (参 = []) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools/race-census.mjs"), ...参],
    { cwd: ROOT, encoding: "utf8" });
  const m = /(\d+) 处有竞态形状/.exec(String(r.stdout || ""));
  return { 码: r.status, 处: m ? Number(m[1]) : -1, 出: String(r.stdout || "") };
};

console.log("一、全仓：今天没有这一种形状");
{
  const r = 扫();
  ok("扫得动（退出码 0）", r.码 === 0, String(r.码));
  ok("0 处", r.处 === 0, "报了 " + r.处 + " 处\n" + r.出);
}

console.log("");
console.log("二、自检：给它一个已知有问题的样本，它要抓得到");
{
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-race-"));
  // 有问题的形状：一个回调里当场 resolve，另一个回调里还有判据。
  fs.writeFileSync(path.join(临, "probe.mjs"), [
    "const ok = (l, c) => console.log(l, c);",
    "export const 探针 = async () => {",
    "  await new Promise((resolve) => {",
    '    一端.on("end", () => {',
    '      ok("那头收到了", true);',
    "      resolve();",
    "    });",
    "    另一端.then(() => {",
    '      ok("退出码是 0", true);',
    "    });",
    "  });",
    "};",
    "",
  ].join("\n"), "utf8");
  // 干净的那一份：判据与 resolve 在同一个回调里，先后有序。
  fs.writeFileSync(path.join(临, "good.mjs"), [
    "const ok = (l, c) => console.log(l, c);",
    "export const 干净 = async () => {",
    "  await new Promise((resolve) => {",
    '    一端.on("end", () => { ok("收到了", true); });',
    '    另一端.on("exit", () => {',
    '      ok("退出码是 0", true);',
    "      resolve();",
    "    });",
    "  });",
    "};",
    "",
  ].join("\n"), "utf8");
  try {
    const r = 扫(["--dir", 临]);
    ok("抓到了那一个样本", r.处 === 1, "报了 " + r.处 + " 处\n" + r.出);
    ok("而干净的写法不算", !r.出.includes("good.mjs"), r.出);
    // 兜底那一句：setTimeout(resolve, …) 是延迟的，pipe 修好之后用的正是它。
    fs.writeFileSync(path.join(临, "probe.mjs"), [
      "const ok = (l, c) => console.log(l, c);",
      "export const 探针 = async () => {",
      "  await new Promise((resolve) => {",
      '    一端.on("end", () => { ok("收到了", true); setTimeout(resolve, 3000); });',
      '    另一端.on("exit", () => { ok("退出码是 0", true); resolve(); });',
      "  });",
      "};",
      "",
    ].join("\n"), "utf8");
    const r2 = 扫(["--dir", 临]);
    ok("setTimeout 兜底的写法也不算", r2.处 === 0, "报了 " + r2.处 + " 处\n" + r2.出);
  } finally {
    fs.rmSync(临, { recursive: true, force: true });
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
