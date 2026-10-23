// 基准：同一算法，只换桶结构。
//
// 两份字节码来自同一份源码，只在 哈希 与 链们 两处不同（bench/deflate-firstbyte.hmyr
// 由 self/deflate.hmyr 复制后改那两处而成）。同一份输入、同一个  --固定 开关，
// 各跑若干次取中位数 —— 中位数比平均更能说明「平时要多久」，方差说明这台机器稳不稳。
//
//   node bench/run.mjs            默认各跑五次
//   node bench/run.mjs --runs 7
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 临 = path.join(ROOT, "dist", "_bench");
const 参 = process.argv.slice(2);
const 次数 = (() => {
  const i = 参.indexOf("--runs");
  const n = i >= 0 ? Number(参[i + 1]) : 5;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
})();

const 样本 = path.join(ROOT, "bootstrap/pack.hmyrb");
const 数据 = fs.readFileSync(样本);
fs.mkdirSync(临, { recursive: true });

// 两份字节码都在这里现编：基准脚本自己负责准备它的输入。
const 编码 = (源, 出) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools/emit-code.mjs"), 源, 出], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error("编不出 " + 源 + "：" + String(r.stderr).slice(0, 200));
    process.exit(2);
  }
};
编码(path.join(ROOT, "bench/deflate-firstbyte-array.hmyr"), path.join(临, "firstbyte-array.hmyrb"));
编码(path.join(ROOT, "bench/deflate-firstbyte-tuple.hmyr"), path.join(临, "firstbyte-tuple.hmyrb"));
编码(path.join(ROOT, "self/deflate.hmyr"), path.join(临, "threebyte-array.hmyrb"));

const 清场 = () => spawnSync("taskkill", ["/IM", "hmyr-bench.exe", "/F"], { encoding: "utf8" });

const exe = path.join(临, "hmyr-bench.exe");
const 编 = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
if (编.status !== 0) {
  console.error("C 那台编不出来：" + String(编.stderr).slice(0, 200));
  process.exit(2);
}

const 跑一批 = (码路, 次数) => {
  const 秒们 = [];
  for (let k = 0; k < 次数; k++) {
    const 出 = path.join(临, "out-" + k + ".z");
    try { fs.unlinkSync(出); } catch {}
    const t0 = Date.now();
    const r = spawnSync(exe, [码路, 样本, 出, "--固定"], {
      encoding: "utf8", timeout: 3600000,
      env: { ...process.env, HMYR_STEPS: "400000000000", HMYR_GC: "1", HMYR_MEM_LIMIT: "0" },
    });
    if (r.error || r.signal) 清场();
    秒们.push((Date.now() - t0) / 1000);
    if (r.status !== 0) {
      console.error("  第 " + (k + 1) + " 次失败：" + String(r.stderr).slice(0, 160));
    }
  }
  return 秒们;
};

const 统计 = (秒们) => {
  const 排 = [...秒们].sort((a, b) => a - b);
  const 中 = 排.length % 2 ? 排[(排.length - 1) / 2] : (排[排.length / 2 - 1] + 排[排.length / 2]) / 2;
  const 均 = 秒们.reduce((a, b) => a + b, 0) / 秒们.length;
  const 方 = 秒们.reduce((a, b) => a + (b - 均) ** 2, 0) / 秒们.length;
  return { 中, 均, 方, 最小: 排[0], 最大: 排[排.length - 1] };
};

const 两份 = [
  ["首字节桶 · 元组（256）", path.join(临, "firstbyte-tuple.hmyrb")],
  ["首字节桶 · 数组（256）", path.join(临, "firstbyte-array.hmyrb")],
  ["三字节桶 · 数组（4096）", path.join(临, "threebyte-array.hmyrb")],
];

console.log("样本 " + 数据.length + " 字节，各跑 " + 次数 + " 次");
const 结果 = {};
for (const [名, 码路] of 两份) {
  console.log("  跑 " + 名 + " ...");
  结果[名] = 统计(跑一批(码路, 次数));
}
清场();

console.log("");
console.log("| 桶 | 中位数 | 最小 | 最大 | 均值 | 方差 |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const [名] of 两份) {
  const s = 结果[名];
  console.log("| " + 名 + " | " + s.中.toFixed(2) + "s | " + s.最小.toFixed(2) + "s | " + s.最大.toFixed(2) + "s | " + s.均.toFixed(2) + "s | " + s.方.toFixed(3) + " |");
}
fs.rmSync(临, { recursive: true, force: true });
