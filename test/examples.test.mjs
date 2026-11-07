// examples/ 下每一份都要跑得通。
//
// 为什么要有这一份：README 里那句「跑得起来的示例比没有示例更糟」是自己写的，
// 而 2026-11-04 之前没有任何判据在盯它 —— 那时二十四份里有两份跑不通：
// view-window 与 probe-file 都把路径写死成 D:/himeyuri/...，在 Linux 上直接 ENOENT。
// 它们在 Windows 上看起来是好的，所以「没人报」这件事很自然。
//
// 2026-11-04 更晚：probe-* 那十四份搬到 probes/ 去了。它们本来就是诊断探针，
// 而其中两份真的 引入 ../self/run.hmoca —— 于是这一套从四十秒涨到二百三十二秒，
// 占掉全量墙钟的一半。搬走之后这里只剩十份真正的示例，五秒跑完；
// 探针那边由 test/probes.test.mjs 守住「编得动」。
//
// 判据只有三条：
//   一、examples/ 下至少八份（目录空了不能让判据永远绿）
//   二、每一份用默认路径跑，退出码为零
//   三、跑不动的要被认出来（给一个不存在的文件，判据必须说它不通过）
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
//
// 顺带记时（2026-11-07）：这一套在全量里是一百二十秒那一档，而手里只有总数。
// 与 probes 那边同一个理由 —— 知道自己慢回答不了该动哪里。
const 账 = [];
const 跑 = (相对) => {
  const 起 = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), 相对], {
    cwd: ROOT, encoding: "utf8", timeout: 180000,
    env: { ...process.env, HMYR_STEPS: "2000000000" },
  });
  账.push({ 名: 相对, 毫秒: Date.now() - 起 });
  const 行批 = String(r.stdout || "").trim().split("\n");
  return { 码: r.status, 末行: (行批[行批.length - 1] || "").trim(), 错: String(r.stderr || "") };
};

const 目录 = path.join(ROOT, "examples");
const 份簇 = fs.readdirSync(目录).filter((f) => f.endsWith(".hmoca")).sort();

console.log("一、examples/ 下有一批示例");
ok("至少八份", 份簇.length >= 8, String(份簇.length) + " 份");

console.log("二、每一份都跑得通");
{
  const 坏例 = [];
  for (const f of 份簇) {
    const r = 跑(path.join("examples", f));
    if (r.码 !== 0) 坏例.push(f + "（退出 " + r.码 + "：" + (r.末行 || r.错.split("\n")[0] || "").slice(0, 60) + "）");
  }
  // 判据不写死份数：目录会长大，而写死的数目一改就红，红的是数目不是坏的示例。
  ok("这一批全过（" + 份簇.length + " 份）", 坏例.length === 0, 坏例.join(" · "));
}

console.log("三、跑不动的会被认出来");
{
  // 一个不存在的示例：判据要报它不通过，而不是把 null 退出码当成零。
  const r = 跑("examples/没有这一份.hmoca");
  ok("不存在的示例退出码非零", r.码 !== 0, String(r.码));
}

console.log("");
if (账.length) {
  const 总 = 账.reduce((a, b) => a + b.毫秒, 0);
  const 慢 = [...账].sort((a, b) => b.毫秒 - a.毫秒).slice(0, 3)
    .map((x) => x.名.replace(/^examples[\\/]/, "").replace(/\.hmoca$/, "") + " " + (x.毫秒 / 1000).toFixed(1) + "s")
    .join(" · ");
  console.log("这一趟：跑 " + (总 / 1000).toFixed(1) + "s（" + 账.length + " 次，平均 " +
    (总 / 账.length / 1000).toFixed(1) + "s）· 最慢 " + 慢);
  console.log("");
}
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
