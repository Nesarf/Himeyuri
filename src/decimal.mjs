// 十进制：一串数字与一个双精度之间的往返。
//
// 两条路都走整数：
//
//   成文  先把值展开成精确的十进制（它一定是有限的），再把它舍到最短的有效位数，
//         而那一位数的判据只有一条 —— 读回来还是原来那个双精度。
//   解析  把数字串收起成一个整数，再经 src/f64.mjs 的 装配 一次舍入。
//
// 这一份借的只有 BigInt 与幂。十进制与双精度之间那条「最短还能读回来」的规矩
// 写在这里，不从宿主抄结果；而 test/decimal.test.mjs 拿宿主的结果逐条对。
//
// 为什么它值得单独一份：字面量从这里进来（0.1、1e308），输出从这里出去（str 一个数）。
// 它在标量那一层的两头，而两头都不许含糊。
import { 拆, 装配 } from "./f64.mjs";

const 五 = 5n;
const 十 = 10n;
const 负零 = 0x8000000000000000n;

// 值 = 数字 乘 10 的指数次。数字非负，符号分开给。
// 一进入这里，双精度就被摊成了一串精确的十进制数字，没有近似。
const 精确 = (位模式) => {
  const A = 拆(位模式);
  if (A.种 === "零") return { 零: true, 负: A.负 };
  if (A.种 === "无穷") return { 无穷: A.负 ? -1 : 1 };
  if (A.种 === "非数") return { 非数: true };
  if (A.E >= 0) return { 负: A.负, 数字: A.M << BigInt(A.E), 指数: 0 };
  const k = -A.E;
  // 值 = M 除以 2 的 k 次方 = M 乘 5 的 k 次方 除以 10 的 k 次方。后者是精确的。
  return { 负: A.负, 数字: A.M * 五 ** BigInt(k), 指数: -k };
};

// 十进制到双精度。分子分母都是整数，舍入只发生一次（在 装配 里）。
export const 装十进制 = (数字, 指数, 负) => {
  if (数字 === 0n) return 负 ? 负零 : 0n;
  if (指数 >= 0) {
    // 值 = 数字 乘 10 的指数次 = (数字 乘 5 的指数次) 乘 2 的指数次
    return 装配(数字 * 五 ** BigInt(指数), 指数, 负);
  }
  const k = -指数;
  const 分母 = 五 ** BigInt(k);
  const 位 = 数字.toString(2).length;
  // 商留在六十七位上下：够五十三位的舍入，也够舍入之后还剩一位可判。
  const 移 = Math.max(0, 67 + 分母.toString(2).length - 位);
  const 被 = 数字 << BigInt(移);
  const Q = 被 / 分母;
  const 余 = 被 % 分母;
  return 装配(Q, -k - 移, 负, 余 !== 0n);
};

// 把十进制数字串舍到 d 位有效数字，交回 { 数, 进一 }。
// 进一表示「舍入让位数多出一位」，那时数字要回到十的 d-1 次方，指数加一。
const 舍到 = (文, d) => {
  if (文.length <= d) return { 数: BigInt(文), 进一: 0 };
  const 前 = BigInt(文.slice(0, d));
  const 后 = 文.slice(d);
  const 余 = BigInt(后);
  // 一半是五后面跟这么多个零。写成一后面跟零（也就是十进制十的幂）就少了一半，
  // 于是每一位上都被判成「比一半大」，最短化一路失败，最后落到十七位。
  // 这个错在一千零三十个值里有十个现形，全是最短表示恰好短于十七位的那些。
  const 半 = 五 * 十 ** BigInt(后.length - 1);
  let 数 = 前;
  if (余 > 半) 数 += 1n;
  else if (余 === 半 && (前 & 1n) === 1n) 数 += 1n;
  if (数.toString().length > d) return { 数: 十 ** BigInt(d - 1), 进一: 1 };
  return { 数, 进一: 0 };
};

// 最短的那一个：从一位试到十七位，第一个能读回原值的就留下。
// 十七是上界 —— 再多一位也不会更短，而更短的那些已经试过了。
const 最短 = (位模式) => {
  const p = 精确(位模式);
  const 文 = p.数字.toString();
  const 长 = 文.length;
  for (let d = 1; d <= 17 && d <= 长; d++) {
    const 舍 = 舍到(文, d);
    const 指数 = p.指数 + (长 - d) + 舍.进一;
    if (装十进制(舍.数, 指数, p.负) === 位模式) return { 数: 舍.数, 指数 };
  }
  return { 数: p.数字, 指数: p.指数 };   // 到不了这里，留着当一条边界
};

// 去掉尾零，指数跟着加。最短的一串不该以零收尾。
const 去零 = (数, 指数) => {
  if (数 === 0n) return { 串: "0", 指数 };
  let 串 = 数.toString();
  while (串.length > 1 && 串.codePointAt(串.length - 1) === 48) {
    串 = 串.slice(0, -1);
    指数 += 1;
  }
  return { 串, 指数 };
};

// 排版照 ECMAScript 那一套：定点与指数形式的分界是它定的，而这一层要与它一字不差。
// 值 = 0.串 乘 10 的 n 次方，n = 指数 + 串的长度。
const 排 = (串, 指数, 负) => {
  const k = 串.length;
  const n = 指数 + k;
  let 体;
  if (k <= n && n <= 21) 体 = 串 + "0".repeat(n - k);
  else if (0 < n && n <= 21) 体 = 串.slice(0, n) + "." + 串.slice(n);
  else if (-6 < n && n <= 0) 体 = "0." + "0".repeat(-n) + 串;
  else {
    const e = n - 1;
    const 指 = (e >= 0 ? "+" : "-") + Math.abs(e);
    体 = k === 1 ? 串 + "e" + 指 : 串[0] + "." + 串.slice(1) + "e" + 指;
  }
  return (负 ? "-" : "") + 体;
};

// 双精度 → 最短的、还能读回来的那个串。
export const 成文 = (位模式) => {
  const p = 精确(位模式);
  if (p.非数) return "NaN";
  if (p.无穷) return p.无穷 < 0 ? "-Infinity" : "Infinity";
  if (p.零) return "0";                       // 走宿主的规矩：负零也打成零
  const { 数, 指数 } = 最短(位模式);
  const 干 = 去零(数, 指数);
  return 排(干.串, 干.指数, p.负);
};

// 串 → 双精度。认得出符号、小数点与指数；认不出就交回 null，
// 报哪一个编号是调用处的事（与 numbers 的 收 交回 null 同一个立场）。
export const 解析 = (文本) => {
  const 原 = String(文本).trim();
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(原);
  if (!m) return null;
  const 号 = m[1], 整 = m[2] || "", 小 = m[3] || "", 指 = m[4];
  const 串 = 整 + 小;
  if (!串) return null;
  const 数字 = BigInt(串);
  const 指数 = (指 ? Number(指) : 0) - 小.length;
  return 装十进制(数字, 指数, 号 === "-");
};
