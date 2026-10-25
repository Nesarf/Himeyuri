// 桥与宿主 loader 的代价对比：同一份文件，两条路各要多久。
//
// 这件事不是好奇 —— 「把桥做成默认」需要先知道它贵多少，而贵在哪一段（引导还是每次加载）。
// 引导是一次性的（跑 self/run.hmyr 的 6 份），之后每次 loadUnit 只付造整棵那份钱。
//
// 用法：node tools/bridge-cost.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit as 宿主载 } from "../src/loader.mjs";
import { loadUnit as 桥载 } from "./self-bridge.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 样本 = ["locale.hmoca", "color.hmoca", "json.hmoca", "self/run.hmoca", "examples/demo.hmoca"];

const 计时 = (fn, 次数 = 3) => {
  const 各次 = [];
  for (let i = 0; i < 次数; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    各次.push(Number(t1 - t0) / 1e6);
  }
  各次.sort((a, b) => a - b);
  return 各次[Math.floor(各次.length / 2)];
};

// 引导：桥的第一次加载把 self/run.hmyr 的六份读完，之后复用。单独量它。
const 引导 = 计时(() => { 桥载(path.join(ROOT, "self/run.hmoca")); }, 1);
console.log("桥的引导（一次性）   " + 引导.toFixed(0) + " ms");
console.log("");
console.log("样本                    宿主 loader     桥        倍数");
for (const 名 of 样本) {
  const 路 = path.join(ROOT, 名);
  const 宿 = 计时(() => 宿主载(路));
  const 桥 = 计时(() => 桥载(路));
  const 倍 = 宿 > 0 ? (桥 / 宿).toFixed(1) : "?";
  console.log(名.padEnd(22) + 宿.toFixed(1).padStart(8) + " ms" + 桥.toFixed(1).padStart(9) + " ms" + 倍.padStart(8));
}
