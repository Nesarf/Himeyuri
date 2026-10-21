// 双精度浮点，用整数算术实现。
//
// 这一份还没有接进执行器。它先要证明自己与宿主那双精度给同一个答案：
// 加、减、乘、比。证明了之后，才谈把 src/numbers.mjs 的实现换掉。
//
// 表示：值 = (-1)^s * M * 2^E，M 是 BigInt，E 是整数。
//   正规数   M 在 [2^52, 2^53)，E = 指 - 1075
//   次正规   M < 2^52，E 固定 -1074
//   零       M = 0
// 所有运算都先算出精确结果，再一次性舍入到最近偶数。两次舍入是这类实现最容易错的地方，
// 而它会让 0.1 + 0.2 与宿主差一位 —— 对得起「看起来像」而不对得起「一样」。
//
// 借的是什么：BigInt 与位运算。那是最小机器层要提供的东西（定长整数与移位），
// 而浮点这件事本身一页都不借。
// 位模式那一对在 src/bits.mjs：它是唯一需要知道宿主双精度长什么样的地方。
import { 位, 由位 } from "./bits.mjs";

const 尾掩 = (1n << 52n) - 1n;
const 隐含 = 1n << 52n;
const 符号位 = 1n << 63n;
const 正无穷 = 0x7FF0000000000000n;

export const 位模式 = { 正零: 0n, 负零: 0x8000000000000000n, 正无穷, 负无穷: 0xFFF0000000000000n, 非数: 0x7FF8000000000000n };

// 一个位模式拆成 { 种, 负, M, E }。种是 零 / 有限 / 无穷 / 非数。
export const 拆 = (位模式值) => {
  const b = 位模式值;
  const 负 = (b & 符号位) !== 0n;
  const 指 = Number((b >> 52n) & 0x7FFn);
  const 尾 = b & 尾掩;
  if (指 === 0x7FF) return 尾 === 0n ? { 种: "无穷", 负 } : { 种: "非数", 负 };
  if (指 === 0 && 尾 === 0n) return { 种: "零", 负, M: 0n, E: 0 };
  if (指 === 0) return { 种: "有限", 负, M: 尾, E: -1074 };
  return { 种: "有限", 负, M: 隐含 | 尾, E: 指 - 1075 };
};

// 把 M * 2^E（M 为正，E 为整数）装回一个位模式。负号由调用处给。
// 一次舍入做完，中间不落地成浮点。
//
// sticky 说的是「这个 M 底下还有一点没写出来的东西」，也就是真实值是 M 加上一个
// 小于一的零头。除法必须带它：商是用整数除出来的，余数不进商的话，
// 「正好一半」那条判断就会把一次真实的余数当成 tie。
//
// 导出它，是因为十进制那一层也要走同一条路：从一串数字到一个双精度，中间算出来的
// 东西一定是个整数乘二的幂，而舍入只该有这一处。
export const 装配 = (M, E, 负, sticky = false) => {
  const s = 负 ? 符号位 : 0n;
  if (M === 0n) return s;                 // 带符号的零
  const 位长 = M.toString(2).length;
  const e = E + 位长 - 1;                 // 无偏指数
  if (e > 1023) return s | 正无穷;

  // 目标指数：正规数按 e - 52，次正规固定在 -1074（也就是精度变少）。
  let 目标E = e >= -1022 ? e - 52 : -1074;
  let M2 = 右舍(M, 目标E - E, sticky);

  // 舍入进位可能把 M2 顶到 2^53：那就降一格。
  if (M2 >= (1n << 53n)) { M2 >>= 1n; 目标E += 1; }
  if (M2 === 0n) return s;                // 舍到零
  if (目标E + 52 > 1023) return s | 正无穷;

  if (目标E === -1074 && M2 < 隐含) {
    // 次正规：指为零，尾就是 M2。
    return s | M2;
  }
  const 指 = BigInt(目标E + 1075);
  return s | (指 << 52n) | (M2 - 隐含);
};

// 右移 k 位并舍入到最近偶数。k 为负时是左移（不丢位）。
//
// sticky 只改一条判断：余数正好一半时，若底下还有零头，那就比一半大，进一；
// 没有零头才是真的 tie，那时才看商的末位。
const 右舍 = (M, k, sticky = false) => {
  if (k <= 0) return M << BigInt(-k);
  const kk = BigInt(k);
  const 商 = M >> kk;
  const 余 = M & ((1n << kk) - 1n);
  const 半 = 1n << (kk - 1n);
  if (余 > 半) return 商 + 1n;
  if (余 === 半) return sticky || (商 & 1n) === 1n ? 商 + 1n : 商;
  return 商;
};

// 加法。减法是加一个翻了符号的数（IEEE 里减法没有独立的语义）。
export const 加 = (a, b) => {
  const A = 拆(a), B = 拆(b);
  if (A.种 === "非数" || B.种 === "非数") return 位模式.非数;
  if (A.种 === "无穷" || B.种 === "无穷") {
    if (A.种 === "无穷" && B.种 === "无穷" && A.负 !== B.负) return 位模式.非数;
    if (A.种 === "无穷") return a;
    return b;
  }
  // 两边都是有限或零。零的符号只在「两个零相加」时才要紧。
  if (A.种 === "零" && B.种 === "零") return A.负 && B.负 ? 位模式.负零 : 位模式.正零;
  if (A.种 === "零") return b;
  if (B.种 === "零") return a;

  const E = Math.min(A.E, B.E);
  const Am = A.M << BigInt(A.E - E);
  const Bm = B.M << BigInt(B.E - E);

  if (A.负 === B.负) return 装配(Am + Bm, E, A.负);
  if (Am === Bm) return 位模式.正零;       // x + (-x) 在最近偶数下是正零
  if (Am > Bm) return 装配(Am - Bm, E, A.负);
  return 装配(Bm - Am, E, B.负);
};

export const 翻符号 = (x) => x ^ 符号位;

export const 减 = (a, b) => 加(a, 翻符号(b));

// 乘法：五十三位乘五十三位最多一百零六位，BigInt 一下就给准了，再舍入一次。
export const 乘 = (a, b) => {
  const A = 拆(a), B = 拆(b);
  const 负 = A.负 !== B.负;
  if (A.种 === "非数" || B.种 === "非数") return 位模式.非数;
  if (A.种 === "无穷" || B.种 === "无穷") {
    const 另一个零 = (A.种 === "零") || (B.种 === "零");
    return 另一个零 ? 位模式.非数 : (负 ? 位模式.负无穷 : 位模式.正无穷);
  }
  if (A.种 === "零" || B.种 === "零") return 负 ? 位模式.负零 : 位模式.正零;
  return 装配(A.M * B.M, A.E + B.E, 负);
};

// 除法。商要到五十五位左右，余数进粘滞位，然后一次舍入 —— 与乘法同一个形状，
// 只多了一个「底下还有零头」的信号。
export const 除 = (a, b) => {
  const A = 拆(a), B = 拆(b);
  const 负 = A.负 !== B.负;
  if (A.种 === "非数" || B.种 === "非数") return 位模式.非数;
  if (A.种 === "无穷") {
    if (B.种 === "无穷") return 位模式.非数;
    return 负 ? 位模式.负无穷 : 位模式.正无穷;
  }
  if (B.种 === "无穷") return 负 ? 位模式.负零 : 位模式.正零;
  if (B.种 === "零") return A.种 === "零" ? 位模式.非数 : (负 ? 位模式.负无穷 : 位模式.正无穷);
  if (A.种 === "零") return 负 ? 位模式.负零 : 位模式.正零;

  const n1 = A.M.toString(2).length, n2 = B.M.toString(2).length;
  const 移 = 55 + n2 - n1;               // 让商落在五十五位上下：够舍入，且不止一位
  const 被 = A.M << BigInt(移);
  const Q = 被 / B.M;
  const R = 被 % B.M;
  return 装配(Q, A.E - B.E - 移, 负, R !== 0n);
};

// 取余：fmod 的规矩 —— 符号跟被除数，而结果总能精确表示，所以它不会舍入。
export const 余 = (a, b) => {
  const A = 拆(a), B = 拆(b);
  if (A.种 === "非数" || B.种 === "非数") return 位模式.非数;
  if (B.种 === "零") return 位模式.非数;   // 零取余没有答案，除零也一样
  if (A.种 === "无穷") return 位模式.非数;
  if (B.种 === "无穷") return a;           // 无穷当除数，余数就是被除数本身
  if (A.种 === "零") return a;             // 零的余数是零，符号照留

  // 两边对齐到同一个指数，然后整数取余。余数精确，所以这一步不丢位。
  const E = Math.min(A.E, B.E);
  const Am = A.M << BigInt(A.E - E);
  const Bm = B.M << BigInt(B.E - E);
  return 装配(Am % Bm, E, A.负);
};


// 比较：-1 / 0 / 1，而不可比（有 NaN）交回 null —— 那是 IEEE 的意思。
// 把「不可比」压成 0 正是 design/SCALARS.txt 里记着的那处洞，这一层不跟着抄。
export const 比 = (a, b) => {
  const A = 拆(a), B = 拆(b);
  if (A.种 === "非数" || B.种 === "非数") return null;
  if (A.种 === "零" && B.种 === "零") return 0;
  // 零在比较里不带方向：负零与正零一样大。这一步不先归正，负零就会被当成最小的数。
  const 负A = A.种 === "零" ? false : A.负;
  const 负B = B.种 === "零" ? false : B.负;
  if (负A !== 负B) return 负A ? -1 : 1;
  const 量 = 量级比(A, B);
  if (量 === 0) return 0;
  return 负A ? -量 : 量;
};

const 量级比 = (A, B) => {
  // 两个都不是 NaN。零最小。
  if (A.种 === "零" && B.种 === "零") return 0;
  if (A.种 === "零") return -1;
  if (B.种 === "零") return 1;
  if (A.种 === "无穷" && B.种 === "无穷") return 0;
  if (A.种 === "无穷") return 1;
  if (B.种 === "无穷") return -1;
  // 有限：比较 e 与 M。先对齐到同一个 E 太贵，用位长与尾比。
  const eA = A.E + A.M.toString(2).length, eB = B.E + B.M.toString(2).length;
  if (eA !== eB) return eA < eB ? -1 : 1;
  // 同一个量级：M 的位长相同，直接比 M。
  return A.M < B.M ? -1 : A.M > B.M ? 1 : 0;
};

// 判等：两个位模式是不是同一个数。它按 IEEE 的相等走 —— 正负零相等，NaN 不等。
export const 同 = (a, b) => {
  const r = 比(a, b);
  return r === 0;
};

// 往负无穷取整。切片与码点用它。
//
// 它不是浮点运算，但落在这里有它的理由：整数部分要从指数与尾数上读出来，
// 而那两件只在这一层里有。宿主那边一行 Math.floor 就完事；这一份要对着
// 「值 = 尾数乘二的幂」自己算出往哪一头取。
//
//   已经是整数（指数不为负）、无穷、非数、零 —— 原样交回。
//   指数为负 —— 尾数右移那个位数；正数截断就是往负无穷，负数要往上进一。
export const 下整 = (b) => {
  const A = 拆(b);
  if (A.种 === "非数" || A.种 === "无穷" || A.种 === "零" || A.E >= 0) return b;
  const k = BigInt(-A.E);
  const 底 = 1n << k;
  const 商 = A.M / 底;
  const 余 = A.M % 底;
  // 正数：截断就是往小的那一头。负数：有零头才要再往下一格。
  const n = A.负 ? 商 + (余 === 0n ? 0n : 1n) : 商;
  return 装配(n, 0, A.负);
};

// 从宿主的一个双精度数收进来，与交回去，都只是过一遍 numbers 的那对函数。
export const 收 = (n) => 位(n);
export const 交 = (b) => 由位(b);
