// 曲线的验收：标量乘基点的结果必须落在曲线上，且 0 与 1 这两个边界对得上。
//
// 判据是曲线方程本身：-x^2 + y^2 = 1 + d x^2 y^2（mod 2^255-19）。
// 这一条是决定性的 —— 算错任何一步，结果几乎必然落不到曲线上。而它不需要一个
// 第二套实现来对照，这正是不拿自己当对手的另一种办法。
//
// 喂法在 2026-11-02 换了一回：原来每一回都是一次 spawnSync，各自把同一份
// self/curve.hmoca 从零加载、解析、编成字节码。量出来的账是 —— 标量 0 要 3.51 秒、
// 标量 8 要 3.65 秒，三次翻倍只多 0.14 秒，所以那 3.5 秒是过路费而不是计算。
// 十四回乘下来 49 秒，占整套 88.5 秒的 55%。现在由 tools/curve-batch.mjs
// 一次加载、按任务表依次调用，判据一条没改，只是把同一份源编一遍而不是十四遍。
//
// 顺带收掉一处白算：原来第三节又跑了一遍 2 与 3，而第二节已经有过这两个点的结果。
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

// 基点的压缩形式：y 的小端字节，最高位是 x 的符号（Gx 最低位为 0，所以最高位是 0）。
const 基压缩 = "5866666666666666666666666666666666666666666666666666666666666666";
// 真签名里的公钥（dist/manifest.json.sig 的公钥 blob 末尾 32 字节）。
const 公钥 = "64a89fdc0c28e4cd557905bf815cda9f25be9842ef39615854f30a48a1e819a7";
// 一、RFC 8032 的测试向量 2：消息只有一个字节 0x72。这是外部判据，不是自己跟自己比。
const rfc = [
  "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
  "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
  "72",
];
// 二、现场造的一对密钥签下的一条消息，公钥、签名、消息三样都写死在这里。
const 现场 = [
  "dde199fc5366ce6255b8fb126cc362bcdea9e6b0d29065bc2d1b68b2a2ca521f",
  "5e28c459c9567c6e91dba1e224b650dc160f25c7f4752edfa6613102ef49b0078b01ba31c1fb46a75bcbb6c19a7dca217b8c2ebbce3f683f0fe9ba2ba2f3cb0b",
  "68696d65797572692d7665726966792d70726f6265",
];
// 三、把签名里 S 的一个字节改掉：判据必须说「不通过」，否则前两条通过不算数。
const 改坏 = [
  "dde199fc5366ce6255b8fb126cc362bcdea9e6b0d29065bc2d1b68b2a2ca521f",
  "5e28c459c9567c6e91dba1e224b650dc160f25c7f4752edfa6613102ef49b0078b01ba31c1fb46a7ffcbb6c19a7dca217b8c2ebbce3f683f0fe9ba2ba2f3cb0b",
  "68696d65797572692d7665726966792d70726f6265",
];

const 步限 = 4000000000;
const 验步限 = 20000000000;

// 任务表的次序就是下面取结果的次序。九个点是「两行 x 与 y」，三回验签是「一行通过」。
const 任务表 = [
  { 参: ["0"], 步限 },              // 0
  { 参: ["1"], 步限 },              // 1
  { 参: ["2"], 步限 },              // 2
  { 参: ["3"], 步限 },              // 3
  { 参: ["4"], 步限 },              // 4
  { 参: ["5"], 步限 },              // 5
  { 参: ["8"], 步限 },              // 6
  { 参: ["--解压", 基压缩], 步限 },  // 7
  { 参: ["--解压", 公钥], 步限 },    // 8
  { 参: ["--验", ...rfc], 步限: 验步限 },   // 9
  { 参: ["--验", ...现场], 步限: 验步限 },  // 10
  { 参: ["--验", ...改坏], 步限: 验步限 },  // 11
];
const 该行数 = [2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1];

const 一个 = spawnSync(process.execPath, ["tools/curve-batch.mjs"], {
  cwd: ROOT, encoding: "utf8", timeout: 600000,
  input: JSON.stringify(任务表),
});
if (一个.status !== 0) {
  console.log("批量探针本身跑不动  " + String(一个.stderr || "").slice(0, 400));
  console.log("");
  console.log("0 passed, 1 failed");
  process.exit(1);
}
const 全 = JSON.parse(String(一个.stdout || "").trim());

// 取第 i 个任务交回的点。整个套件只朝这一个函数要结果，于是索引写错了也只错一处。
const 点 = (i) => {
  const 条 = 全[i];
  if (!条) return { 坏: "第 " + i + " 个任务没有结果" };
  if (!条.ok) return { 坏: 条.码 + " " + 条.话 };
  const 行 = String(条.出).trim().split(/\r?\n/);
  return { x: BigInt("0x" + 行[0]), y: BigInt("0x" + 行[1]) };
};
const 验 = (i) => {
  const 条 = 全[i];
  if (!条) return { 坏: "第 " + i + " 个任务没有结果" };
  if (!条.ok) return { 坏: 条.码 + " " + 条.话 };
  const 出 = String(条.出);
  return { 通过: 出.indexOf("通过") >= 0 && 出.indexOf("不通过") < 0 };
};

console.log("零、换喂法之后，每一回都还真的跑了");
{
  ok("十二个任务都交回了结果", 全.length === 任务表.length, "交回 " + 全.length + " 条");
  ok("每回的输出互不串（行数与各自的形状对得上）",
   全.length === 任务表.length && 全.every((条, i) => 条.ok && String(条.出).trim().split(/\r?\n/).length === 该行数[i]),
   "第一条与最后一条的行数分别是 " + (全[0] && String(全[0].出).trim().split(/\r?\n/).length) + " 与 " + (全[11] && String(全[11].出).trim().split(/\r?\n/).length));
}

console.log("一、零与一这两个边界");
{
  const 零 = 点(0);
  ok("0 × G 跑得动", !零.坏, 零.坏);
  if (!零.坏) {
    ok("0 × G 是单位元 (0, 1)", 零.x === 0n && 零.y === 1n, 零.x.toString(16) + " " + 零.y.toString(16));
    ok("单位元在曲线上", 在曲线上(零.x, 零.y));
  }
  const 一 = 点(1);
  ok("1 × G 跑得动", !一.坏, 一.坏);
  if (!一.坏) {
    ok("1 × G 就是基点", 一.x === Gx && 一.y === Gy, 一.x.toString(16));
    ok("基点在曲线上", 在曲线上(一.x, 一.y));
  }
}

console.log("二、二到八：每一个都要落在曲线上");
// 索引就是任务表里的位置：2、3、4、5、8 分别落在 2 至 6。
for (const [标, 索引] of [[2n, 2], [3n, 3], [4n, 4], [5n, 5], [8n, 6]]) {
  const 结 = 点(索引);
  ok(标 + " × G 跑得动", !结.坏, 结.坏);
  if (结.坏) continue;
  ok(标 + " × G 在曲线上", 在曲线上(结.x, 结.y), 结.x.toString(16).slice(0, 16));
}

console.log("三、标量不同，点就不同（不是恒定回来的）");
{
  // 与第二节用的是同一回调用的结果：同一个标量跑第二遍不会给出第二个答案。
  const 二 = 点(2), 三 = 点(3);
  ok("2G 与 3G 不是同一个点", !二.坏 && !三.坏 && (二.x !== 三.x || 二.y !== 三.y));
  ok("2G 也不是基点", !二.坏 && (二.x !== Gx || 二.y !== Gy));
}

console.log("四、点解压：32 字节还原成曲线上的点");
{
  const 基 = 点(7);
  ok("解压基点的压缩形式跑得动", !基.坏, 基.坏);
  if (!基.坏) {
    ok("解压得到基点的 x", 基.x === Gx, 基.x.toString(16).padStart(64, "0"));
    ok("解压得到基点的 y", 基.y === Gy, 基.y.toString(16).padStart(64, "0"));
  }
  const 钥 = 点(8);
  ok("解压真签名里的公钥跑得动", !钥.坏, 钥.坏);
  if (!钥.坏) {
    ok("那个公钥解出来在曲线上", 在曲线上(钥.x, 钥.y));
  }
}

console.log("五、验签：签名方程自己说了算");
{
  const 一 = 验(9);
  ok("RFC 8032 的向量 2 验得过", 一.通过 === true, 一.坏);
  const 二 = 验(10);
  ok("现场样本验得过", 二.通过 === true, 二.坏);
  const 三 = 验(11);
  ok("改一个字节就不通过", 三.通过 === false, 三.坏);
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
