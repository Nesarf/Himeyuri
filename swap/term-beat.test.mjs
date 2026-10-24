// 节拍驱动的验收：动画可以跟着音乐走，而不是跟着帧率走。
//
// 这是从 plaaosert 的 credits_public（Frums - Credits EX 的终端动画）学来的一条设计：
// 按 beat 推进而不是按固定帧率。它的好处在音乐类动画里很明显——画面与节拍对齐，
// 不会因为机器快慢而漂移。我们用「一拍一幕」的简化形式：当前拍决定画哪一幕，
// 于是不需要增删场景栈，只要从表里取当前那一项。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../tools/self-bridge.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESC = String.fromCharCode(27);
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const rt = runUnit(loadUnit(path.join(ROOT, "term.hmyr")));
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

console.log("\n拍与毫秒的换算");
ok("120 bpm 时每拍 500 毫秒", call("每拍毫秒", [120]) === 500, String(call("每拍毫秒", [120])));
ok("60 bpm 时每拍 1000 毫秒", call("每拍毫秒", [60]) === 1000, String(call("每拍毫秒", [60])));
ok("非整数时向下取整（60000/7 = 8571.4…）", call("每拍毫秒", [7]) === 8571, String(call("每拍毫秒", [7])));
ok("bpm 为 0 时不崩，给一个兜底", call("每拍毫秒", [0]) === 1000, String(call("每拍毫秒", [0])));
{
  ok("经过 1000 毫秒、120bpm 时是第 2 拍", call("当前拍", [1000, 120]) === 2, String(call("当前拍", [1000, 120])));
  ok("经过 0 毫秒时是第 0 拍", call("当前拍", [0, 120]) === 0, String(call("当前拍", [0, 120])));
  ok("差一点到下一拍时仍停在原拍", call("当前拍", [999, 120]) === 1, String(call("当前拍", [999, 120])));
}

console.log("\n一拍一幕：从表里取当前拍那一幕");
const 表 = [[0, "点"], [2, "横线"], [4, "点"]];
ok("第 0 拍是第一幕", call("拍上的场景", [表, 0]) === "点", call("拍上的场景", [表, 0]));
ok("第 1 拍还是第一幕（尚未到下一个事件）", call("拍上的场景", [表, 1]) === "点", call("拍上的场景", [表, 1]));
ok("第 2 拍换成第二幕", call("拍上的场景", [表, 2]) === "横线", call("拍上的场景", [表, 2]));
ok("第 3 拍仍停在第二幕", call("拍上的场景", [表, 3]) === "横线", call("拍上的场景", [表, 3]));
ok("第 4 拍换回第三幕", call("拍上的场景", [表, 4]) === "点", call("拍上的场景", [表, 4]));
ok("远超表尾时停在最后一幕", call("拍上的场景", [表, 99]) === "点", call("拍上的场景", [表, 99]));
ok("空表不崩，返回空名", call("拍上的场景", [[], 5]) === "", JSON.stringify(call("拍上的场景", [[], 5])));

console.log("\n跑一段带节拍的动画：帧数对、画面随拍切换");
{
  const src = 'fn main() -> Int effects(process) {\n  print(跑节拍(((0, "点"),) + ((1, "横线"),), 1200, 6, 50))\n  return 0\n}\n';
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });
  const errs = d.items.filter((x) => x.s === "error");
  ok("那段小程序解析得动", errs.length === 0, errs.map((x) => x.c).join(","));
  let buffer = "";
  rt.write = (s) => { buffer += s; };
  rt.registerModule(ast);
  rt.callFunction(rt.functions.get("main"), [], null);
  const 帧数 = buffer.split(ESC + "[2J").length - 1;
  ok("六帧都画出来了", 帧数 === 6, String(帧数));
  const 点数 = (buffer.split("*").length - 1);
  const 横线数 = (buffer.split("-").length - 1);
  ok("第 0 帧是「点」，恰好出现一次", 点数 === 1, String(点数));
  ok("第 1 到 5 帧是「横线」，恰好五次", 横线数 === 5, String(横线数));
  ok("没有替换字符", !buffer.includes("\uFFFD"));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
