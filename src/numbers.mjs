// 数：这门语言里「数」的意思，只有一个定义处。
//
// 这一份没有把数换掉。它做的是把数的意思收成一处，好让换掉实现的时候只有一个落点。
//
// 为什么要收：数曾经散在四个地方各自定义 —— 两个切词器把字面量交给 Number()，
// 执行器自己写裸算术，内置表自己写 Math.floor 与 String()。四处一致纯属运气，
// 而运气不会在换实现之后还继续成立。design/SCALARS.txt 那五十三条量出来的行为，
// 就是这一层要保住的东西；test/numbers.test.mjs 把它们跑在三执行路上。
//
// 此刻的位置（2026-10-24）：入口与出口已经换掉了。解析与成文走 src/decimal.mjs，
// 那是自己写的十进制往返，一位不差地对过宿主；进制那一支也自己数。
// 而算术与比较仍是宿主的双精度 —— 加、减、乘、除、余、比、下整这几行还是裸运算。
// 所以 design/VM.txt 的「还没做的」里，标量那一条仍然成立，只是短了一半。
import * as 十进 from "./decimal.mjs";
import { 位, 由位 } from "./bits.mjs";
export { 位, 由位 };

// 一个值是数吗。执行器判断值是什么，问这里，而不是自己写 typeof。
export const 是数 = (v) => typeof v === "number";

// 收一个值进来当数用：数是数，布尔当一用，别的一律不是。
// 交回 null 而不是抛：报哪一个编号是执行器的事，不在这一层编。
export const 收 = (v) => (typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : null);

// 把宿主给的整数收进语言里（长度、计数这类）。它现在就是一个恒等函数，
// 而它存在的理由是：宿主整数进入语言也是一处入口，换实现之后这里要动，
// 那时候场上只该有一个地方等着改。
export const 造 = (n) => n;

// 源码里的字面量 → 数。进制给 0 表示按前缀走（0x / 0b / 0o 由文本自己说），
// 否则按给的进制读那串数字（切词器已经把前缀剥掉了）。
//
// 十进制那一支现在走 src/decimal.mjs：那是自己写的往返，一位不差地对过宿主的成文与解析。
// 进制那一支是整数，自己逐字符累加 —— 它是整数的意思，不是浮点的意思。
export const 解析 = (文, 进制 = 0) => {
  const 净 = String(文).replace(/_/g, "");
  if (进制) {
    if (!净) return NaN;
    let 值 = 0n;
    for (const ch of 净) {
      const d = 数字值(ch);
      if (d < 0 || d >= 进制) return NaN;
      值 = 值 * BigInt(进制) + BigInt(d);
    }
    return Number(值);
  }
  const 位们 = 十进.解析(净);
  return 位们 === null ? NaN : 由位(位们);
};

const 数字值 = (ch) => {
  const c = ch.codePointAt(0);
  if (c >= 48 && c <= 57) return c - 48;        // 0 到 9
  if (c >= 97 && c <= 122) return c - 87;       // a 到 z
  if (c >= 65 && c <= 90) return c - 55;        // A 到 Z
  return -1;
};

// 数 → 文本。走 src/decimal.mjs：最短的、还能读回来的那一串。
// 位数与排版都已经与宿主的 String() 逐条对过，所以这一句换过之后行为不变。
export const 成文 = (n) => 十进.成文(位(n));

// 算术。除与余不在这里判零：拒绝的编号是这门语言的选择，放在执行器那一侧。
export const 加 = (a, b) => a + b;
export const 减 = (a, b) => a - b;
export const 乘 = (a, b) => a * b;
export const 除 = (a, b) => a / b;
export const 余 = (a, b) => a % b;
export const 反 = (a) => -a;

// 零的判定要单独有名字：除法与取余都要它，而「等于零」在这里不是相等 ——
// 相等是跨类型的那一条规则（见执行器的 相等），这一条只问一个数是不是零。
export const 是零 = (n) => n === 0;

// 两个数相等。负数零与正零相等（那正是 IEEE 的规矩），NaN 与任何东西都不等。
export const 同 = (a, b) => a === b;

// 比较：-1 / 0 / 1。相等不算出错，所以它总是在这三个里交回一个。
export const 比 = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// 往小的那一头取整。切片与码点用它，而下标不用它 —— 下标不取整是一个刻意的洞，
// 见 design/SCALARS.txt「还没量的」那一节。
export const 下整 = (n) => Math.floor(n);

// 位模式：双精度 ↔ 六十四位。定义搬到 src/bits.mjs 了 —— numbers、f64 与 decimal
// 三份都要用它，而它们彼此之间已经有各自的方向，把桥单独放一份才不会有环。
// 这里转出去，是为了让「数的意思只在这里找」这句话仍然成立。

