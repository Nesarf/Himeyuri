// 位模式：宿主的一个双精度与六十四位整数之间的那一座桥。
//
// 这是整个标量层最底的一处：数、十进制、字符串之外的所有东西都不该知道
// 一个双精度在宿主里长什么样，而这里正好是唯一需要知道的地方。
//
// 单独一份是因为依赖的方向：numbers 要用它，f64 要用它，decimal 也要用它，
// 而三者彼此之间已经有各自的方向了（numbers 用 decimal，decimal 用 f64）。
// 把它们都指向这一份，就不必让其中任何两个互相绕。

const 缓冲 = new ArrayBuffer(8);
const 视 = new DataView(缓冲);

export const 位 = (n) => { 视.setFloat64(0, n); return 视.getBigUint64(0); };
export const 由位 = (b) => { 视.setBigUint64(0, b); return 视.getFloat64(0); };
