// 数的意思只有一处定义：src/numbers.mjs。
//
// 这一套钉三件事：
//   一、那一处定义被三条执行路一起用，而三条路给出的答案相同（五十七条，含错误编号）。
//   二、那四份文件里不再自己写数的原语：没有 Math.floor、没有 Number()、没有 typeof 判数。
//   三、位模式那对函数说得对——它是下一格的地基（要用自己的整数实现双精度，先得能拆位）。
//
// 为什么要有第二与第三条：第一件事只证明「行为一样」，而行为一样可能来自四处各自
// 写对了。这一格要的不是巧合，是一个地址。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/eval.mjs";
import { loadUnit } from "../src/loader.mjs";
import { 最小运行 } from "../src/minimal-eval.mjs";
import { 跑字节码 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";
import * as 数 from "../src/numbers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-num-"));

// 一个表达式，三种跑法。
const 案子 = [
  ["0.1 + 0.2", "加"],
  ["9007199254740993", "字面量"],
  ["7 / 2", "除"],
  ["1 / 3", "除"],
  ["1e308 * 10", "溢"],
  ["0 - 0", "零"],
  ["len(\"abc\")", "串长"],
  ["len(\"😀\")", "串长"],
  ["\"abc\"[1]", "下标"],
  ["slice(\"abcdef\", 1, 3)", "切片"],
  ["\"a\" < \"b\"", "比较"],
  ["true + 1", "布尔当一"],
  ["nil == 0", "跨型相等"],
  ["1 == \"1\"", "跨型相等"],
  ["len(\"\")", "串长"],
  ["1 / 0", "除零"],
  ["1 % 0", "余零"],
  ["\"abc\" + 1", "串加数"],
  ["str(1e21)", "大数成串"],
  ["str(0.1)", "小数成串"],
  ["str(-0)", "负零成串"],
  ["chr(128512)", "码点"],
  ["len(chr(128512))", "码点长"],
  ["to_int(\" 42 \")", "回转"],
  ["nfc(\"e\")", "归一"],
  ["is_letter(\"あ\")", "字母"],
  ["\"abc\"[1.5]", "非整数下标"],
  ["\"abc\"[-1]", "负下标"],
  ["slice(\"abcdef\", 1.5, 3)", "小数起"],
  ["slice(\"abcdef\", 2, 1)", "止比起小"],
  ["slice(\"abcdef\", -2, 3)", "负起"],
  ["slice(\"abcdef\", 0, 99)", "超界止"],
  ["chr(65.7)", "小数码点"],
  ["str(1 / 0)", "无穷成串（被拦）"],
  ["to_int(\"-0\")", "负零回转"],
  ["to_int(\"1e3\")", "指数回转（被拦）"],
  ["to_int(\"0x10\")", "进制回转（被拦）"],
  ["str(123456789012345678901)", "长整数成串"],
  ["str(1e-7)", "极小数成串"],
  ["0.000001", "小数字面量"],
  ["1 == 1.0", "整浮相等"],
  ["nil < 1", "跨型比较（被拦）"],
  ["str(true)", "布尔成串"],
  ["str(nil)", "nil 成串"],
  ["len(123)", "len 收数（被拦）"],
  ["2 * 3 + 4", "优先级"],
  ["(2 + 3) * 4", "括号"],
  ["7 % 3", "取余"],
  ["-7 % 3", "负数取余"],
  ["5 / 2 * 2", "连除"],
  // 进制字面量这一组曾经分叉：宿主的切词器漏了 numeric，于是 0x10 成了一个字符串，
  // 0x10 + 0 给 "0x100"。子集那条路一直是对的，所以它只在有人写下进制时才现形。
  ["0x10 + 0", "十六进制"],
  ["0b101", "二进制"],
  ["0o17", "八进制"],
  ["str(0x1F)", "进制成串"],
  ["0x1_0", "进制带分隔"],
  ["0xFF / 2", "进制参与除法"],
];

const 外壳 = (源) => "fn main() -> Int {\n  return " + 源 + "\n}\n";
const 描述 = (v) => {
  if (typeof v === "number") return "num:" + (Object.is(v, -0) ? "-0" : String(v));
  if (typeof v === "string") return "str:" + JSON.stringify(v);
  if (typeof v === "boolean") return "bool:" + v;
  if (v === null) return "nil";
  if (v === undefined) return "未定义";
  return "聚合:" + (v && v.tag ? v.tag : String(v));
};
// 错误只看编号：消息的措辞是三条路各自的，编号才是契约。
const 约 = (s) => { const m = /^错:(HMYR-[A-Z]?\d+)/.exec(s); return m ? "错:" + m[1] : s; };

const 宿主跑 = (文) => {
  const r = run(文);
  if (r.diagnostics.errors.length) return "错:" + r.diagnostics.errors[0].code;
  return 描述(r.value);
};
const 最小跑 = (p) => {
  const 层 = loadUnit(p);
  if (!层.ok) return "读:" + 层.diagnostics.errors.map((e) => e.code).join("|");
  try {
    const rt = 最小运行(层, { write: () => {}, capabilities: 本机能力(), argv: ["hmyr", p] });
    return 描述(rt.callFunction(rt.functions.get("main"), [], null));
  } catch (e) { return "错:" + (e.code || "?"); }
};
const 字节码跑 = (p) => {
  const 层 = loadUnit(p);
  if (!层.ok) return "读:" + 层.diagnostics.errors.map((e) => e.code).join("|");
  const rt = 跑字节码(层, { write: () => {}, capabilities: 本机能力(), argv: ["hmyr", p] });
  const r = rt.调用("main", [], null);
  if (!r.ok) return "错:" + r.码;
  return 描述(r.值);
};

console.log("一、五十七条：三条执行路给同一个答案");
{
  let 分叉 = 0;
  const 细节 = [];
  for (const [源, 类] of 案子) {
    const 文 = 外壳(源);
    const p = path.join(临, "case.hmyr");
    fs.writeFileSync(p, 文);
    const 甲 = 约(宿主跑(文)), 乙 = 约(最小跑(p)), 丙 = 约(字节码跑(p));
    const 同 = 甲 === 乙 && 乙 === 丙;
    if (!同) { 分叉++; 细节.push(类 + " " + 源 + " -> " + 甲 + " / " + 乙 + " / " + 丙); }
  }
  ok("五十七条里没有一处分叉", 分叉 === 0, 细节.slice(0, 3).join("  ·  "));
  console.log("    （" + 案子.length + " 条，覆盖算术、比较、相等、成串、解析、取整与五个拒绝编号）");
}

console.log("二、那四份文件不再自己写数的原语，而入口与出口也交出去了");
{
  // 判据要剥掉注释：注释里提到那些名字，是为了说明「不用它们」，那不算用到。
  const 剥注释 = (文) => 文.replace(/^[ \t]*\/\/.*$/gm, " ").replace(/([^:])\/\/.*$/gm, "$1");
  const 读 = (相对) => 剥注释(fs.readFileSync(path.join(ROOT, 相对), "utf8"));

  for (const 相对 of ["src/vm.mjs", "src/vm-builtins.mjs"]) {
    const 文 = 读(相对);
    ok(相对 + " 里没有 Math.", !文.includes("Math."));
    ok(相对 + " 里没有 Number(", !文.includes("Number("));
    ok(相对 + " 里没有自己判「是不是数」", !/typeof\s+\w+\s*===\s*"number"/.test(文));
    ok(相对 + " 里没有 Infinity 与 NaN 这两个字面名", !/\bInfinity\b/.test(文) && !/\bNaN\b/.test(文));
    ok(相对 + " 读的是同一份数的定义", /from "\.\/numbers\.mjs"/.test(文));
  }
  // 数的入口与出口：解析与成文现在走 src/decimal.mjs，而位模式那一对搬到了 bits。
  const 数源 = 读("src/numbers.mjs");
  ok("numbers.mjs 里不再有 parseInt", !/Number\.parseInt/.test(数源));
  ok("numbers.mjs 读的是自己的十进制往返", /from "\.\/decimal\.mjs"/.test(数源));
  ok("numbers.mjs 不再自己碰 DataView", !/DataView|setFloat64|getBigUint64/.test(数源));
  const 桥 = 读("src/bits.mjs");
  ok("位模式那一对住在 bits.mjs", /setFloat64/.test(桥) && /getBigUint64/.test(桥));
  ok("f64 也读那一份桥，不读 numbers", /from "\.\/bits\.mjs"/.test(读("src/f64.mjs")));
  for (const 相对 of ["src/lexer.mjs", "src/subset-lex.mjs"]) {
    const 文 = 读(相对);
    ok(相对 + " 里没有 Number(", !文.includes("Number("));
    ok(相对 + " 里没有 parseInt / parseFloat", !/\bparseInt\(|\bparseFloat\(/.test(文));
    ok(相对 + " 读的是同一份数的定义", /from "\.\/numbers\.mjs"/.test(文));
  }
}

console.log("三、位模式：下一格的地基说得对");
{
  // 五个位置各有它存在的理由：普通数、零、负零、无穷、次正规（指数为 0 的那一档）。
  const 例 = [0.1, 1, 0, -0, Infinity, -Infinity, 5e-324, 1.7976931348623157e308];
  let 全同 = true, 错 = "";
  for (const n of 例) {
    const 位 = 数.位(n);
    const 对照 = (() => { const b = new ArrayBuffer(8); new DataView(b).setFloat64(0, n); return new DataView(b).getBigUint64(0); })();
    if (位 !== 对照) { 全同 = false; 错 = String(n) + " 位模式不同"; break; }
    if (!Object.is(数.由位(位), n)) { 全同 = false; 错 = String(n) + " 往返不回来"; break; }
  }
  ok("八个位置的位模式与宿主一致，且往返回来是原来那个数", 全同, 错);
  ok("0.1 的位模式是那一个已知的常数", 数.位(0.1) === 0x3FB999999999999An, 数.位(0.1).toString(16));
  ok("一那一半是最高位（符号位是第六十四位）", 数.位(-0) === 0x8000000000000000n, 数.位(-0).toString(16));
  ok("负零与正零位模式不同，而它们相等", 数.位(-0) !== 数.位(0) && 数.同(-0, 0));
  // NaN 与谁都不等，位模式也有一个固定值（安静 NaN）。
  ok("NaN 与它自己不等", 数.同(NaN, NaN) === false);
  ok("解析与成串走同一处：0.1 往返成一个 0.1", 数.成文(数.解析("0.1")) === "0.1", 数.成文(数.解析("0.1")));
  ok("进制那一侧：解析 0x1F 是三十一", 数.解析("1F", 16) === 31);
  ok("下整往下取，不是往零取", 数.下整(-1.5) === -2);
  ok("比交回 -1 / 0 / 1", 数.比(1, 2) === -1 && 数.比(2, 2) === 0 && 数.比(2, 1) === 1);
  ok("布尔收进来当一用", 数.收(true) === 1 && 数.收(false) === 0);
  ok("别的一律不是数（交回 null，不抛）", 数.收("1") === null && 数.收(null) === null);
}

console.log("");
fs.rmSync(临, { recursive: true, force: true });
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
