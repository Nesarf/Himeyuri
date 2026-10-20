// 数：这门语言里「数」的意思，只有一个定义处。
//
// 这一份没有把数换掉。它做的是把数的意思收成一处，好让换掉实现的时候只有一个落点。
//
// 为什么要收：数曾经散在四个地方各自定义 —— 两个切词器把字面量交给 Number()，
// 执行器自己写裸算术，内置表自己写 Math.floor 与 String()。四处一致纯属运气，
// 而运气不会在换实现之后还继续成立。design/SCALARS.txt 那五十三条量出来的行为，
// 就是这一层要保住的东西；test/numbers.test.mjs 把它们跑在三执行路上。
//
// 而实现仍是宿主的双精度浮点：加、减、乘、除、比较、成串、解析，一件都不是自己做的。
// 所以 design/VM.txt 的「还没做的」里，标量那一条仍然成立。这一层只是第一次让
// 「数是什么」有一个地址。

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
// `1e308` 与 `0.1` 都要照宿主那一套读写，因为那是双精度的十进制往返：
// 换实现时最麻烦的一件正是这个，所以它必须在这一层，而不是藏在某个切词器里。
export const 解析 = (文, 进制 = 0) => {
  const 净 = String(文).replace(/_/g, "");
  return 进制 ? Number.parseInt(净, 进制) : Number(净);
};

// 数 → 文本。最短往返由实现决定（现在是宿主那双精度打印）。
export const 成文 = (n) => String(n);

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

// 位模式：双精度 ↔ 六十四位。这一对现在只有套件在用，而它是下一格的地基——
// 要用自己的整数算术实现双精度，第一件事就是能把它拆成符号、指数、尾数。
// 一个 ArrayBuffer 与一个 DataView 就是宿主要提供的全部东西。
const 缓冲 = new ArrayBuffer(8);
const 视 = new DataView(缓冲);
export const 位 = (n) => { 视.setFloat64(0, n); return 视.getBigUint64(0); };
export const 由位 = (b) => { 视.setBigUint64(0, b); return 视.getFloat64(0); };
