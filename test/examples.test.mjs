// examples/ 下每一份都要跑得通。
//
// 为什么要有这一份：README 里那句「跑得起来的示例比没有示例更糟」是自己写的，
// 而 2026-11-04 之前没有任何判据在盯它 —— 二十四份示例里有两份跑不通：
// view-window 与 probe-file 都把路径写死成 D:/himeyuri/...，在 Linux 上直接 ENOENT。
// 它们在 Windows 上看起来是好的，所以「没人报」这件事很自然。
//
// 判据只有三条：
//   一、examples/ 下至少二十份（目录空了不能让判据永远绿）
//   二、每一份用默认路径跑，退出码为零
//   三、跑不动的要被认出来（给一个不存在的文件，判据必须说它不通过）
//
// 跑一份大约一到两秒，二十四份四十秒上下 —— 这套的耗时主要花在那上面。
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

// 跑一份源码，交回退出码与最后一行输出（失败时那一行是诊断）。
const 跑 = (相对) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), 相对], {
    cwd: ROOT, encoding: "utf8", timeout: 180000,
    env: { ...process.env, HMYR_STEPS: "2000000000" },
  });
  const 行们 = String(r.stdout || "").trim().split("\n");
  return { 码: r.status, 末行: (行们[行们.length - 1] || "").trim(), 错: String(r.stderr || "") };
};

const 目录 = path.join(ROOT, "examples");
const 份们 = fs.readdirSync(目录).filter((f) => f.endsWith(".hmoca")).sort();

console.log("一、examples/ 下有一批示例");
ok("至少二十份", 份们.length >= 20, String(份们.length) + " 份");

console.log("二、每一份都跑得通");
{
  const 坏们 = [];
  for (const f of 份们) {
    const r = 跑(path.join("examples", f));
    if (r.码 !== 0) 坏们.push(f + "（退出 " + r.码 + "：" + (r.末行 || r.错.split("\n")[0] || "").slice(0, 60) + "）");
  }
  ok("二十四份全过（或这个数目本身）", 坏们.length === 0, 坏们.join(" · "));
}

console.log("三、跑不动的会被认出来");
{
  // 一个不存在的示例：判据要报它不通过，而不是把 null 退出码当成零。
  const r = 跑("examples/没有这一份.hmoca");
  ok("不存在的示例退出码非零", r.码 !== 0, String(r.码));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
