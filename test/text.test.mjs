// 文本的意思只有一处定义：src/text.mjs。
//
// 与 test/numbers.test.mjs 同一个形状：先把行为跑在三条执行路上（宿主求值器、最小求值器、
// 字节码），再补一层静态判据，说清那两份文件里不再自己写 typeof "string" 与 .slice。
// 缺了第二层，行为一致也可能只是三处各自写对了。
//
// 这一套量的东西里，最值得留着的是「半个代理对」那几条：按码元数、不按字符数，
// 是这门语言刻意的选择，而它看起来像个错。那个码点一律用 chr(128512) 在语言里造出来，
// 不在源码里写字面量 —— 写进源码的字符与运行期造出来的走同一条码元规则，
// 而后者还能把「一个码点是两个码元」这件事说清。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/eval.mjs";
import { loadUnit } from "../src/loader.mjs";
import { 最小运行 } from "../src/minimal-eval.mjs";
import { 跑字节码 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";
import * as 文 from "../src/text.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-text-"));

// 那个码点：U+1F600，在 UTF-16 里是两个码元。
const 笑 = 128512;

const 案子 = [
  ["len(\"abc\")", "长度"],
  ["len(chr(" + 笑 + "))", "一个表情是两个码元"],
  ["len(\"\")", "空串"],
  ["len(chr(0))", "一个空码元也是一个码元"],
  ["len(chr(55296))", "一个落单的代理也是一个码元"],
  ["\"abc\"[1]", "下标取一个码元"],
  ["slice(\"abcdef\", 1, 3)", "切片"],
  ["slice(\"abcdef\", 2, 1)", "止比起小给空串"],
  ["slice(\"abcdef\", 0, 99)", "超界夹到末尾"],
  ["slice(\"abcdef\", -2, 3)", "负起夹到零"],
  ["\"a\" < \"b\"", "码元序"],
  ["\"Z\" < \"a\"", "大写在前（码元序，不按字母表）"],
  ["\"\" < \"a\"", "空串比任何非空串小"],
  ["\"abc\" < \"abd\"", "前缀相同看第三个"],
  ["chr(" + 笑 + ") == chr(" + 笑 + ")", "同一个表情相等"],
  ["\"a\" + \"b\"", "拼接"],
  ["\"abc\" + 1", "串加数成串"],
  ["str(\"abc\")", "串的成串是它自己"],
  ["chr(" + 笑 + ")", "码点造一个字"],
  ["chr(65.7)", "小数码点往下取"],
];

const 外壳 = (源) => "fn main() -> Int {\n  return " + 源 + "\n}\n";
const 描述 = (v) => {
  if (typeof v === "number") return "num:" + (Object.is(v, -0) ? "-0" : String(v));
  // 字符串要连码元一起说清：一个落单的代理与一个真字符在 JSON 里长得一样。
  if (typeof v === "string") {
    const 码元 = Array.from({ length: v.length }, (_, i) => v.charCodeAt(i).toString(16));
    return "str:" + JSON.stringify(v) + " [" + 码元.join(",") + "]";
  }
  if (typeof v === "boolean") return "bool:" + v;
  if (v === null) return "nil";
  if (v === undefined) return "未定义";
  return "聚合:" + (v && v.tag ? v.tag : String(v));
};
const 约 = (s) => { const m = /^错:(HMYR-[A-Z]?\d+)/.exec(s); return m ? "错:" + m[1] : s; };
const 宿主跑 = (源文) => {
  const r = run(源文);
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

console.log("一、" + 案子.length + " 条：三条执行路给同一个答案");
{
  let 分叉 = 0;
  const 细节 = [];
  for (const [源, 类] of 案子) {
    const 源文 = 外壳(源);
    const p = path.join(临, "case.hmyr");
    fs.writeFileSync(p, 源文);
    const 甲 = 约(宿主跑(源文)), 乙 = 约(最小跑(p)), 丙 = 约(字节码跑(p));
    if (!(甲 === 乙 && 乙 === 丙)) { 分叉++; 细节.push(类 + " " + 源 + " -> " + 甲 + " / " + 乙 + " / " + 丙); }
  }
  ok(案子.length + " 条里没有一处分叉", 分叉 === 0, 细节.slice(0, 3).join("  ·  "));
}

console.log("二、半个代理对：那是码元的定义，不是意外");
{
  // chr(128512) 的第一个码元是 0xD83D，单取它得到的是半个代理对。三条路都给同一个半边，
  // 而这件事要紧的地方在于：它不能是「有时候是字符、有时候是半边」。
  const 源 = "chr(" + 笑 + ")[0]";
  const 源文 = 外壳(源);
  const p = path.join(临, "half.hmyr");
  fs.writeFileSync(p, 源文);
  const 甲 = 宿主跑(源文), 乙 = 最小跑(p), 丙 = 字节码跑(p);
  ok("取半个代理对，三条路都给出那一半的码元位置", 甲 === 乙 && 乙 === 丙, 甲 + " / " + 乙 + " / " + 丙);
  ok("那个位置是 D83D", /d83d/i.test(甲), 甲);
}

console.log("三、那两份文件不再自己写字符串的原语");
{
  const 剥注释 = (源) => 源.replace(/^[ \t]*\/\/.*$/gm, " ").replace(/([^:])\/\/.*$/gm, "$1");
  for (const 相对 of ["src/vm.mjs", "src/vm-builtins.mjs"]) {
    const 源 = 剥注释(fs.readFileSync(path.join(ROOT, 相对), "utf8"));
    ok(相对 + " 里没有自己判 typeof \"string\"", !/typeof\s+\w+\s*===\s*"string"/.test(源));
    ok(相对 + " 里没有 .slice(", !/\.slice\(/.test(源));
    ok(相对 + " 里没有 String.fromCodePoint", !源.includes("fromCodePoint"));
    ok(相对 + " 读的是同一份文本的定义", /from "\.\/text\.mjs"/.test(源));
  }
}

console.log("四、text.mjs 那几个函数各自的意思");
{
  ok("是串：空串也是串，数不是", 文.是串("") && !文.是串(1));
  ok("长：按码元数，一个表情是二", 文.长(文.码点(笑)) === 2);
  ok("在界内：零在内，长度那一头在外，负的在外", 文.在界内("ab", 0) && !文.在界内("ab", 2) && !文.在界内("ab", -1));
  ok("元：取一个码元，取不到给未定义", 文.元("abc", 1) === "b" && 文.元("abc", 9) === undefined);
  ok("切：起止都在码元位置上", 文.切("abcdef", 1, 3) === "bc");
  ok("拼：接起来", 文.拼("a", "b") === "ab");
  ok("比：码元序，交回 -1 / 0 / 1", 文.比("a", "b") === -1 && 文.比("b", "b") === 0 && 文.比("b", "a") === 1);
  ok("码点：造出一个字，代理对也算一个码点", 文.码点(笑).charCodeAt(0) === 0xD83D && 文.长(文.码点(笑)) === 2);
  ok("码点：落单的代理也造得出来", 文.长(文.码点(55296)) === 1);
}

console.log("");
fs.rmSync(临, { recursive: true, force: true });
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
