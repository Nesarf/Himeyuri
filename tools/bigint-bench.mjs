// 大整数的分段账：一次模乘的钱，花在乘、进位、还是分配上。
//
// 为什么要有这一份：curve 套件里的标量乘约 3.9 秒、点解压 2.1 秒、验签 16.6 秒，
// 而加载与编译只有 61 毫秒 —— 时间几乎全在 self/bigint.hmoca 的算术里。可「算术」
// 是个笼统的词：一次模乘 = 一次 256 位乘（16 位字时 256 次内层小乘，24 位字之后
// 121 次，每次带取余与整除）+ 一次模约简（进位 + 折叠 + 条件减）。改字宽能减少
// 内层小乘的次数，但如果钱主要花在进位或分配上，改字宽就是白改 —— 这一份就是为了
// 在动手之前把这件事问清楚，问完才换的 24 位（结论在 design/SCALARS.txt）。
//
// 所以这一份只做一件事：把每个函数单独计时，让人看见钱落在哪一段。
//
// 为什么它不是套件：套件回答「对不对」，这一份回答「多快」。而快慢没有通过与否，
// 只有数字，且随机器浮动 —— 所以它单独一个工具，不进 check-all（与 tools/bench.mjs 同一条规矩）。
//
//   node tools/bigint-bench.mjs           人读的表格
//   node tools/bigint-bench.mjs --json    同样的东西，机器读
//
// 一处口径要写清：加载器与 vm 都不看「公开」这个标记，所以 乘、模约简、零组
// 这些没标公开的名字，在这里与非公开的同一个形状地能调（src/vm.mjs 的 调用
// 只查函数表）。这不是绕过封装 —— 是这一层的函数表本来就并成了一张。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";
import { 跑字节码 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 要JSON = process.argv.includes("--json");

// 两个模 p 之内的数。长度各 64 个十六进制字符（256 位），且都小于
// p = 2 的 255 次方减 19 —— 第一个是 p 减 1（最坏情形：全是 1 位），
// 第二个是随机样子的一串。取最坏情形是有意的：模约简里那条「第 255 位置位
// 就减掉它再加 19」的循环，只有在高位满的时候才真的转。
const 甲 = "7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed";
const 乙 = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";

const 起载 = Date.now();
const 层 = loadUnit(path.join(ROOT, "self/bigint.hmoca"));
const 载毫秒 = Date.now() - 起载;
if (!层.ok) {
  for (const e of 层.diagnostics.errors) console.error(e.code + " " + e.message);
  process.exit(1);
}

const vm = 跑字节码(层, {
  capabilities: 本机能力(),
  argv: [],
  stepLimit: 2000000000,
  contracts: process.env.HMYR_CONTRACTS === "1",
  字符串用码元序列: true,
});

// 每一回都从干净状态起跑：步数、停机标志、输出口都重设，
// 与「原来的一次新进程」等价（curve-batch 那里同样的理由）。
const 调 = (名, 参) => {
  vm.步 = 0;
  vm.停机 = null;
  vm.write = () => {};
  const r = vm.调用(名, 参, null);
  if (!r.ok) throw new Error(名 + " 失败：" + r.码 + " " + r.话);
  return r.值;
};

const 表 = [];
// 先热身一次：第一回会带上 JIT 与文件缓存的开销，算进去就失真。
const 计 = (标签, 次, fn) => {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < 次; i++) fn();
  const 毫秒 = (performance.now() - t0) / 次;
  const 行 = { 标签, 次, 毫秒 };
  表.push(行);
  if (!要JSON) console.log("  " + 标签.padEnd(26) + 毫秒.toFixed(4).padStart(10) + " ms");
  return 行;
};

const a = 调("从十六进制", [甲]);
const b = 调("从十六进制", [乙]);
const 积 = 调("乘", [a, b]);

if (!要JSON) {
  console.log("  测于 " + new Date().toISOString().slice(0, 19).replace("T", " ") + " · Node " + process.version);
  console.log("  加载与编译 " + 载毫秒 + " ms（八件全部在这个数之外）");
  console.log("");
  console.log("分配");
}
计("零组(22)（一个乘积）", 3000, () => 调("零组", [22]));
计("零组(11)（一个数）", 3000, () => 调("零组", [11]));

if (!要JSON) console.log("");
if (!要JSON) console.log("轻运算（各 11 个字）");
计("加", 3000, () => 调("加", [a, b]));
计("减", 3000, () => 调("减", [a, b]));
计("比", 20000, () => 调("比", [a, b]));

if (!要JSON) console.log("");
if (!要JSON) console.log("重运算（256 次内层小乘那一层）");
计("乘", 200, () => 调("乘", [a, b]));
计("模约简", 200, () => 调("模约简", [积]));
计("模乘（乘 + 模约简）", 200, () => 调("模乘", [a, b]));

if (!要JSON) console.log("");
if (!要JSON) console.log("进出");
计("从十六进制（64 字符）", 2000, () => 调("从十六进制", [甲]));
计("成十六进制", 2000, () => 调("成十六进制", [a]));
计("从数(65535)", 3000, () => 调("从数", [65535]));
计("取位(128)", 20000, () => 调("取位", [a, 128]));

// 模幂一次要 255 轮、每轮一到两次模乘，二十秒上下 —— 单独一轮就够，
// 它的用处是给出「模乘的单价 × 轮数能不能对上实测」这条交叉检验。
if (!要JSON) console.log("");
if (!要JSON) console.log("一次完整的模幂（255 轮，约十几秒）");
const 指 = 调("减", [调("模数", []), 调("从数", [2])]);
const 幂 = 计("模幂（求逆用）", 1, () => 调("模幂", [a, 指]));

if (要JSON) {
  console.log(JSON.stringify({ 载毫秒, 表 }, null, 0));
} else {
  // 收尾把最要紧的两笔对照算出来：乘与模约简各占模乘的几成。
  const 取 = (标签) => 表.find((x) => x.标签 === 标签).毫秒;
  const 单乘 = 取("乘");
  const 单约 = 取("模约简");
  const 单模乘 = 取("模乘（乘 + 模约简）");
  console.log("");
  console.log("  读法");
  console.log("    和 = " + (单乘 + 单约).toFixed(4) + " ms，模乘 = " + 单模乘.toFixed(4) + " ms。");
  console.log("    两项分开量各有自己的一次调用开销，所以和比一次模乘略大 —— 比例只作参照：");
  console.log("    乘 " + Math.round((单乘 / 单模乘) * 100) + "%，模约简 " + Math.round((单约 / 单模乘) * 100) + "%（两者相加会过一百）。");
  console.log("    一次内层小乘 = 乘 / 121 = " + (单乘 / 121).toFixed(5) + " ms（24 位字：11 个字两两相乘）");
  console.log("    一次模幂 = " + 幂.毫秒.toFixed(0) + " ms，按 255 轮乘单价估算是 " +
    Math.round(255 * 单模乘 * 1.5) + " ms（每轮一到两次乘）");
}
