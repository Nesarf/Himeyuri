// HMYR 的标量语义，逐条量出来。
//
// 这一套不验「实现对不对」，验的是「这台机器此刻给出的意思是什么」。原因是第三层
// 要换掉标量，而在换之前得知道要保住的是哪些行为。没有这张表，换掉之后只能靠手感判断
// 「好像还一样」。
//
// 每一条都同时是一份未来的验收：谁把标量换掉，就得让这些行继续通过。
import { run } from "../src/eval.mjs";

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 跑一段程序，交回它的返回值。程序一律写成 fn main。
const 值 = (源) => {
  const r = run("fn main() -> Int {\n  return " + 源 + "\n}\n");
  if (r.diagnostics.errors.length) return { 错: r.diagnostics.errors[0].code + " " + r.diagnostics.errors[0].message };
  return { 值: r.value };
};

console.log("一、数字：双精度浮点，整数与浮点是同一个类型");
{
  const a = 值("0.1 + 0.2");
  ok("0.1 + 0.2 不等于 0.3（二进制浮点的老事实）", a.值 !== 0.3, String(a.值));
  ok("而它等于那一个确定的值", a.值 === 0.30000000000000004, String(a.值));
  const b = 值("9007199254740993");
  ok("2 的 53 次方加一存不住（精度按双精度走）", b.值 === 9007199254740992, String(b.值));
  const c = 值("7 / 2");
  ok("除法给小数，不截断", c.值 === 3.5, String(c.值));
  const d = 值("1 / 3");
  ok("三份之一是那个十进制的近似", d.值 === 0.3333333333333333, String(d.值));
  const e = 值("1e308 * 10");
  ok("溢出给 Infinity 而不是报错", e.值 === Infinity, String(e.值));
  const f = 值("0 - 0");
  ok("零减零是零（没有负零的坑在这里）", Object.is(f.值, 0) || f.值 === 0, String(f.值));
}

console.log("二、字符串：按 UTF-16 码元数，不按字符数");
{
  const a = 值("len(\"abc\")");
  ok("三个字母长度三", a.值 === 3, String(a.值));
  const b = 值("len(\"😀\")");
  ok("一个表情符号长度二（代理对算两个码元）", b.值 === 2, String(b.值));
  const c = 值("\"abc\"[1]");
  ok("下标取的是一个码元", c.值 === "b", JSON.stringify(c.值));
  const d = 值("slice(\"abcdef\", 1, 3)");
  ok("切片按码元位置", d.值 === "bc", JSON.stringify(d.值));
  const e = 值("\"a\" < \"b\"");
  ok("字符串比较按码元序", e.值 === true);
  // 下标与 slice 的起止、设()、chr() 同一条规矩：小数先往下取整。
  // 原来这里是把宿主的 undefined 直接当值交出来 —— 那不是这门语言的值。
  // 三条执行路的一致性由 numbers 套件那张对照表盯着，这里钉住语义本身。
  const f = 值("\"abc\"[1.5]");
  ok("小数下标往下取整（一点五取到的是一那一位）", f.值 === "b", JSON.stringify(f.值 || f.错));
  const g = 值("\"abc\"[-0.5]");
  ok("负的小数下标取整之后越界，报 R0151", String(g.错 || "").includes("HMYR-R0151"), g.错 || "（没有报）");
}

console.log("三、布尔与 null：它们在运算里怎么变");
{
  const a = 值("true + 1");
  ok("true 当一用", a.值 === 2, String(a.值));
  const b = 值("nil == 0");
  ok("nil 不等于零（相等先看类型）", b.值 === false, String(b.值));
  const c = 值("1 == \"1\"");
  ok("数字一与字符串一相等（跨类型走成串比较）", c.值 === true, String(c.值));
  const d = 值("len(\"\")");
  ok("空串长度零", d.值 === 0, String(d.值));
}

console.log("四、拒绝的那几条：编号是语义的一部分");
{
  const a = 值("1 / 0");
  ok("除零报 R0120", String(a.错 || "").includes("HMYR-R0120"), a.错 || "（没有报）");
  const b = 值("1 % 0");
  ok("取余除零也报 R0120", String(b.错 || "").includes("HMYR-R0120"), b.错 || "（没有报）");
  const c = 值("\"abc\" + 1");
  ok("字符串加数字给字符串（一加一不是数字）", c.值 === "abc1", JSON.stringify(c.值));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
