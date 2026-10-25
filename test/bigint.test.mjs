// 大整数的验收：16 位字组成的 256 位数，加、减、乘，与 node 的 BigInt 逐位对照。
//
// 这一层存在的理由写在 design/SIGNING.txt 里：双精度在 2 的 53 次方以上就不精确，
// 所以 32 位乘 32 位不能直接用普通数算。验收因此必须拿一个真的任意精度实现当对手，
// 而不是拿这门语言自己的另一种写法当对手。
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 掩 = (1n << 256n) - 1n;
const P = (1n << 255n) - 19n;
const 转 = (v) => (v & 掩).toString(16).padStart(64, "0");
const 高位 = (v) => (v >> 256n).toString(16).padStart(64, "0");
// 模幂：求逆的对照要用它。指数是 p 减二，255 位，平方与乘。
const 幂模 = (底, 指) => {
  let a = 底 % P, e = 指, r = 1n;
  while (e > 0n) {
    if (e & 1n) r = (r * a) % P;
    a = (a * a) % P;
    e >>= 1n;
  }
  return r;
};

// 固定样本 + 两个由种子推出来的 255 位数（可重复，不用随机源）。
const 甲 = (() => { let x = 0x1234567890abcdefn; for (let i = 0; i < 8; i++) x = (x * 0x9e3779b97f4a7c15n) & ((1n << 256n) - 1n); return x; })();
const 乙 = (() => { let x = 0xfedcba0987654321n; for (let i = 0; i < 8; i++) x = (x * 0xc2b2ae3d27d4eb4fn) & ((1n << 256n) - 1n); return x; })();

const 样本组 = [
  ["三与五", 3n, 5n],
  ["零与零", 0n, 0n],
  ["模数 2^255-19 与一", (1n << 255n) - 19n, 1n],
  ["全一与二", (1n << 256n) - 1n, 2n],
  ["两个伪随机 256 位", 甲, 乙],
];

for (const [名, a, b] of 样本组) {
  const r = spawnSync(process.execPath, ["bin/hmyr.mjs", "--compile", "self/bigint.hmoca", a.toString(16), b.toString(16)], {
    cwd: ROOT, encoding: "utf8", timeout: 120000,
  });
  ok(名 + "：跑得动", r.status === 0, String(r.stderr || "").slice(0, 120));
  if (r.status !== 0) continue;
  const 行 = String(r.stdout || "").trim().split(/\r?\n/);
  const 积 = a * b;
  ok(名 + "：加", 行[0] === 转(a + b), 行[0] + " 对 " + 转(a + b));
  ok(名 + "：减（模 2^256）", 行[1] === 转(a - b), 行[1] + " 对 " + 转(a - b));
  ok(名 + "：乘的低半", 行[2] === 转(积), 行[2] + " 对 " + 转(积));
  ok(名 + "：乘的高半", 行[3] === 高位(积), 行[3] + " 对 " + 高位(积));
  const 应比 = a > b ? "1" : a < b ? "-1" : "0";
  ok(名 + "：比大小", 行[4] === 应比, 行[4] + " 对 " + 应比);
  // 模 2^255-19 的乘：这一条是曲线运算真正要用的那一步。
  const 应模 = 转((a * b) % ((1n << 255n) - 19n));
  ok(名 + "：模乘（模 2^255-19）", 行[5] === 应模, 行[5] + " 对 " + 应模);
  // 求逆：费马小定理说 a 的 p 减一次方是一，所以 p 减二次方就是逆。
  const 应逆 = 转(幂模(a, P - 2n));
  ok(名 + "：求逆", 行[6] === 应逆, 行[6] + " 对 " + 应逆);
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
