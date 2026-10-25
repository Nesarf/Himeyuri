// 深转占多少：直接调 造整棵，与走完整 loadUnit 比一比。
//
// 两者差的那些就是桥的包装：深转、诊断（重名/包导入/rev）、别名表。
// 若差距大，说明瓶颈在跨层搬运，而那是「让造整棵 直接产宿主形状」这件事的目标。
import fs from "node:fs";
import path from "node:path";
import { 读程序 } from "file:///D:/himeyuri/src/code-file.mjs";
import { 虚拟机 } from "file:///D:/himeyuri/src/vm.mjs";
import { 本机能力 } from "file:///D:/himeyuri/src/capabilities.mjs";
import { loadUnit as 桥载 } from "file:///D:/himeyuri/tools/self-bridge.mjs";

const ROOT = "D:/himeyuri";
const vm = new 虚拟机(读程序(fs.readFileSync(path.join(ROOT, "runtime/run.hmyrb"))), {
  capabilities: 本机能力(), stepLimit: 40000000000, maxDepth: 4000,
});

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

// 先热一次（vm 的引导）
vm.调用("造整棵", ["examples/demo.hmyr"], null);

for (const 名 of ["locale.hmyr", "json.hmyr", "self/run.hmyr"]) {
  const 裸 = 计时(() => vm.调用("造整棵", [名], null));
  const 全 = 计时(() => 桥载(path.join(ROOT, 名)));
  const 包 = 全 - 裸;
  console.log(名.padEnd(18) + "裸 " + 裸.toFixed(1).padStart(7) + " ms   完整 " + 全.toFixed(1).padStart(7) +
    " ms   包装 " + 包.toFixed(1).padStart(7) + " ms  （" + (包 / 全 * 100).toFixed(0) + "%）");
}
