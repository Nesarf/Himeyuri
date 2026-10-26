// 实时档位的标尺：量一个回调的最坏耗时与分配量。
//
// design/MEMORY.txt 第 3 节的第三条验收是「回调的最坏耗时有上界（多次运行的最大值
// 不超过阈值的 1.5 倍）」。这一份把那条做成一个可复查的数：同一份程序跑若干次，
// 报中位数与最大值，以及最大值是几倍中位数。
//
// 它不证明零停顿。零停顿要等运行时有「不经过托管区的内存」，而 MEMORY.txt 第八节
// 那次实测已经说明那件事今天换不来速度。这一份量的是「离那条承诺还有多远」。
//
//   node bench/realtime.mjs           默认各跑五次
//   node bench/realtime.mjs --runs 7
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 临 = path.join(ROOT, "dist", "_realtime");
const 参 = process.argv.slice(2);
const 次数 = (() => {
  const i = 参.indexOf("--runs");
  const n = i >= 0 ? Number(参[i + 1]) : 5;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
})();

fs.mkdirSync(临, { recursive: true });

// 编 C 那台与那份回调：基准自己负责准备它的输入（与 bench/run.mjs 同一条规矩）。
const exe = path.join(临, "hmyr-rt.exe");
const 编 = spawnSync("gcc", ["-std=c11", "-O2", "-Wl,--stack,67108864", "-o", exe,
  path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
if (编.status !== 0) {
  console.error("C 那台编不出来：" + String(编.stderr).slice(0, 200));
  process.exit(2);
}

const 源 = path.join(ROOT, "bench/realtime-callback.hmoca");
const 码 = path.join(临, "callback.hmoks");
const 编码 = spawnSync(process.execPath, [path.join(ROOT, "tools/emit-code.mjs"), 源, 码], { encoding: "utf8" });
if (编码.status !== 0) {
  console.error("回调编不出来：" + String(编码.stderr).slice(0, 200));
  process.exit(2);
}

// 一次跑：时间与分配。分配那一列靠 C 那台的 HMYR_MEM —— 它在退出时把堆账打到 stderr。
const 跑一次 = () => {
  const t0 = Date.now();
  const r = spawnSync(exe, [码], {
    encoding: "utf8", timeout: 3600000,
    env: { ...process.env, HMYR_STEPS: "4000000000", HMYR_GC: "1", HMYR_MEM: "1", HMYR_MEM_LIMIT: "0" },
  });
  const 秒 = (Date.now() - t0) / 1000;
  const 分配 = /(\d+)\s*(?:字节|bytes)/.exec(String(r.stderr || ""));
  return { 秒, 出: String(r.stdout || "").trim(), 分配: 分配 ? Number(分配[1]) : null, 码: r.status };
};

console.log("回调 " + 源.replace(ROOT, "") + "，跑 " + 次数 + " 次");
const 次们 = [];
for (let k = 0; k < 次数; k++) {
  const 一 = 跑一次();
  if (一.码 !== 0) console.error("  第 " + (k + 1) + " 次失败，退出码 " + 一.码);
  次们.push(一);
}

const 秒们 = 次们.map((x) => x.秒).sort((a, b) => a - b);
const 中 = 秒们.length % 2 ? 秒们[(秒们.length - 1) / 2] : (秒们[秒们.length / 2 - 1] + 秒们[秒们.length / 2]) / 2;
const 最 = 秒们[秒们.length - 1];
const 比 = 中 > 0 ? 最 / 中 : 0;

console.log("");
console.log("| 读数 | 值 |");
console.log("| --- | --- |");
console.log("| 中位数 | " + 中.toFixed(3) + "s |");
console.log("| 最大值 | " + 最.toFixed(3) + "s |");
console.log("| 最大值 / 中位数 | " + 比.toFixed(2) + " |");
console.log("| 输出 | " + JSON.stringify(次们[0].出) + " |");
const 分配们 = 次们.map((x) => x.分配).filter((x) => x !== null);
if (分配们.length > 0) console.log("| 堆账（字节，最后一行） | " + 分配们[0] + " |");

console.log("");
if (比 > 1.5) {
  console.log("  最坏耗时超过中位数的 1.5 倍 —— design/MEMORY.txt 第 3 节那条验收没过。");
  console.log("  这一句话不是「回调写坏了」：它说这台机器上「上界」还不成立。");
} else {
  console.log("  最坏耗时在 1.5 倍中位数以内（第 3 节那条验收的形状）。");
  console.log("  仍然要说清：这个数只覆盖这一份回调与这一次测量，不是全称承诺。");
}

fs.rmSync(临, { recursive: true, force: true });
