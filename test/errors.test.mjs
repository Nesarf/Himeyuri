// 失败语义那条欠账的观察点：绕路有多少处。
//
// 背景写在 design/ERRORS.txt：内置失败是整台停机，于是「先问再取」成了唯一的写法。
// 今天的数字是六处（那是 2026-11-04 逐处分类出来的）。而那六处的收益加起来不到
// 二十行 —— 乙方案（结果型内置）要改四台执行器与四十多个调用点，甲方案（try 指令）
// 要加指令并让四台各自实现栈回滚。两个方案的成本都远大于收益，所以那一条 OPEN
// 今天的状态是「已知、有权衡、不值得启动」，不是「忘了做」。
//
// 那它凭什么再被提起？凭绕路变多。这一份就是那件事的判据：
//   - 绕路超过十处，红 —— 那时收益已经不像今天这么小，该重新开会
//   - 绕路变成零，也红 —— 那说明这个观察点没有对象了，该回来把这整条删掉
// 两种红都不是「代码坏了」，是「该重新读一遍 design/ERRORS.txt」。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 一处绕路的形状：file_exists 之后紧接着就读同一个路径。
// 四行是宽松的上界 —— 这会把「同一片区域里既有问也有读」都算进来（实测七处），
// 而逐处看过的结论是六处：manifest 142 与 vm 612 是同一段逻辑被连带数进来的。
// 粗筛偏多没关系，因为它守的是上限；逐处分类写在 design/ERRORS.txt 的第三节。
const 数绕路 = (文) => {
  const 行批 = 文.split("\n");
  const 命中 = [];
  for (let i = 0; i < 行批.length; i++) {
    if (!行批[i].includes("file_exists(")) continue;
    if (行批[i].includes('名 == "file_exists"')) continue;   // 内置表里的名字，不是调用
    const 附近 = 行批.slice(i + 1, i + 5).join("\n") + 行批[i];
    if (附近.includes("read_text(") || 附近.includes("read_bytes(")) 命中.push(i + 1);
  }
  return 命中;
};

console.log("一、self/ 里的绕路处数在观察范围内");
{
  const 目录 = path.join(ROOT, "self");
  const 文串 = fs.readdirSync(目录).filter((f) => f.endsWith(".hmoca")).sort();
  let 总 = 0;
  const 明细 = [];
  for (const f of 文串) {
    const 命 = 数绕路(fs.readFileSync(path.join(目录, f), "utf8"));
    if (命.length) 明细.push(f + ":" + 命.join(","));
    总 += 命.length;
  }
  console.log("    （粗筛 " + 总 + " 处：" + 明细.join(" · ") + "）");
  // 基线是六处（design/ERRORS.txt 第三节逐处看过）。上限设十，是「翻了一半」的位置 ——
  // 到那时收益才可能与成本相称。
  ok("粗筛不超过十处（超过就该重新读 design/ERRORS.txt）", 总 <= 10, String(总) + " 处");
  ok("也不是零（到零说明这个观察点没有对象了）", 总 >= 1, String(总));
}

console.log("二、数绕路这件事本身要被验一次");
{
  const 样 = [
    "  若 file_exists(路) {",
    "    定 文 = read_text(路)",
    "  }",
  ].join("\n");
  ok("先问再取的形状会被数出来", 数绕路(样).length === 1, String(数绕路(样).length));
  const 内建表 = '  若 名 == "file_exists" { 返回 真 }';
  ok("内置表里的名字不会被误数", 数绕路(内建表).length === 0, String(数绕路(内建表).length));
  const 真在问 = [
    "  若 file_exists(路) == 假 {",
    '    返回 {对: 对, 缺: 缺 + 1}',
    "  }",
  ].join("\n");
  ok("只问不读的不算绕路", 数绕路(真在问).length === 0, String(数绕路(真在问).length));
}

console.log("");
console.log("这条欠账的状态写在 design/ERRORS.txt：三份方案、六处绕路、成本远大于收益。");
console.log("这一份不是催它开工，是给它一个「什么时候该重新开会」的闹钟。");
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
