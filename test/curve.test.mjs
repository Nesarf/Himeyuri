// 曲线的验收：标量乘基点的结果必须落在曲线上，且 0 与 1 这两个边界对得上。
//
// 判据是曲线方程本身：-x^2 + y^2 = 1 + d x^2 y^2（mod 2^255-19）。
// 这一条是决定性的 —— 算错任何一步，结果几乎必然落不到曲线上。而它不需要一个
// 第二套实现来对照，这正是不拿自己当对手的另一种办法。
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const P = (1n << 255n) - 19n;
const md = (v) => ((v % P) + P) % P;
const 幂模 = (底, 指) => {
  let a = md(底), e = 指, r = 1n;
  while (e > 0n) { if (e & 1n) r = (r * a) % P; a = (a * a) % P; e >>= 1n; }
  return r;
};
const D = md(-121665n * 幂模(121666n, P - 2n));

const Gx = 0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51an;
const Gy = 0x6666666666666666666666666666666666666666666666666666666666666658n;

const 在曲线上 = (x, y) => {
  const x2 = (x * x) % P, y2 = (y * y) % P;
  return md(y2 - x2) === md(1n + (((D * x2) % P) * y2) % P);
};

const 跑 = (标) => {
  const r = spawnSync(process.execPath, ["bin/hmyr.mjs", "--compile", "self/curve.hmyr", 标.toString(16)], {
    cwd: ROOT, encoding: "utf8", timeout: 300000,
    env: { ...process.env, HMYR_STEPS: "4000000000" },
  });
  if (r.status !== 0) return { 坏: String(r.stderr || "").slice(0, 140) };
  const 行 = String(r.stdout || "").trim().split(/\r?\n/);
  return { x: BigInt("0x" + 行[0]), y: BigInt("0x" + 行[1]) };
};

console.log("一、零与一这两个边界");
{
  const 零 = 跑(0n);
  ok("0 × G 跑得动", !零.坏, 零.坏);
  if (!零.坏) {
    ok("0 × G 是单位元 (0, 1)", 零.x === 0n && 零.y === 1n, 零.x.toString(16) + " " + 零.y.toString(16));
    ok("单位元在曲线上", 在曲线上(零.x, 零.y));
  }
  const 一 = 跑(1n);
  ok("1 × G 跑得动", !一.坏, 一.坏);
  if (!一.坏) {
    ok("1 × G 就是基点", 一.x === Gx && 一.y === Gy, 一.x.toString(16));
    ok("基点在曲线上", 在曲线上(一.x, 一.y));
  }
}

console.log("二、二到八：每一个都要落在曲线上");
for (const 标 of [2n, 3n, 4n, 5n, 8n]) {
  const 点 = 跑(标);
  ok(标 + " × G 跑得动", !点.坏, 点.坏);
  if (点.坏) continue;
  ok(标 + " × G 在曲线上", 在曲线上(点.x, 点.y), 点.x.toString(16).slice(0, 16));
}

console.log("三、标量不同，点就不同（不是恒定回来的）");
{
  const 二 = 跑(2n), 三 = 跑(3n);
  ok("2G 与 3G 不是同一个点", !二.坏 && !三.坏 && (二.x !== 三.x || 二.y !== 三.y));
  ok("2G 也不是基点", !二.坏 && (二.x !== Gx || 二.y !== Gy));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
