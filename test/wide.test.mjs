// 宽整数的验收：24 位字组成的 840 位数，移位、乘一个小整数、除以一个小整数，
// 与 node 的 BigInt 逐位对照。
//
// 为什么这一份要单独存在：十进制装配那一条路上（把 5 的 324 次方乘进去、再移回来）
// 需要 840 位，而 self/bigint.hmoca 只有 264 位 —— 那一份是为 mod 2^255-19 写的。
// 两份的分界写在 self/wide.hmoca 的头注释里。
//
// 对手同样是 node 的 BigInt，理由与 test/bigint.test.mjs 一样：拿一个真的任意精度实现
// 当对手，而不是拿这门语言自己的另一种写法当对手。
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 35 个字、每个 24 位。
const 掩 = (1n << 840n) - 1n;
const 转 = (v) => (v & 掩).toString(16);
const 位长 = (v) => (v === 0n ? 0 : v.toString(2).length);

// 两个由种子推出来的 840 位数：可重复，不用随机源。
const 甲 = (() => {
  let x = 0x0123456789abcdefn;
  for (let i = 0; i < 14; i++) x = (x * 0x9e3779b97f4a7c15n) & 掩;
  return x;
})();
const 乙 = (() => {
  let x = 0xfedcba9876543210n;
  for (let i = 0; i < 14; i++) x = (x * 0xc2b2ae3d27d4eb4fn) & 掩;
  return x;
})();

const 样本组 = [
  ["零", 0n, 3],
  ["小整三乘七", 3n, 7],
  ["一个字满", (1n << 24n) - 1n, 5],
  ["字的边界", 1n << 24n, 24],
  ["满顶", 掩, 11],
  ["伪随机甲", 甲, 13],
  ["伪随机乙", 乙, 37],
];

// 探针的七行：乘小、除小的商、除小的余、乘二、除二的商、除二的余非零、位数。
for (const [名, a, k] of 样本组) {
  const r = spawnSync(process.execPath,
    [path.join(ROOT, "bin/hmyr.mjs"), "--compile", "self/wide.hmoca", a.toString(16), String(k)],
    { cwd: ROOT, encoding: "utf8", timeout: 300000 });
  ok(名 + "：跑得动", r.status === 0, String(r.stderr || "").slice(0, 140));
  if (r.status !== 0) continue;
  const 行 = String(r.stdout || "").trim().split(/\r?\n/);
  const K = BigInt(k);
  ok(名 + "：乘小", 行[0] === 转(a * K), 行[0] + " 对 " + 转(a * K));
  ok(名 + "：除小的商", 行[1] === 转(a / K), 行[1] + " 对 " + 转(a / K));
  ok(名 + "：除小的余", 行[2] === String(a % K), 行[2] + " 对 " + String(a % K));
  ok(名 + "：乘二", 行[3] === 转(a << K), 行[3] + " 对 " + 转(a << K));
  ok(名 + "：除二的商", 行[4] === 转(a >> K), 行[4] + " 对 " + 转(a >> K));
  // sticky：移出去的那几位有没有非零。只有真假，没有大小。
  const 应余 = (a & ((1n << K) - 1n)) !== 0n ? "真" : "假";
  ok(名 + "：除二的余非零", 行[5] === 应余, 行[5] + " 对 " + 应余);
  ok(名 + "：位数", 行[6] === String(位长(a)), 行[6] + " 对 " + String(位长(a)));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
