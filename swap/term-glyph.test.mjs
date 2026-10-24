// 字形与渲染的验收：定义在 glyphs.hmyr，逻辑在 term.hmyr，两边各自可核对。
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
rt.registerModule(loadUnit(path.join(ROOT, "glyphs.hmyr")).modules.values().next().value);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

console.log("\n字形定义：形状要齐");
{
  const 表 = call("字形表", []);
  ok("数字十个、字母二十六个、标点五个，共四十一项", Array.isArray(表) && 表.length === 41, String(表 && 表.length));
  ok("高五宽三", call("字形高", []) === 5 && call("字形宽", []) === 3);
  const 齐 = 表.every((项) => Array.isArray(项[1]) && 项[1].length === 5 && 项[1].every((行) => 行.length === 3));
  ok("每个字形都是五行、每行三列", 齐, JSON.stringify(表.slice(0, 2)));
  const 只含两种记号 = 表.every((项) => 项[1].every((行) => [...行].every((c) => c === "#" || c === ".")));
  ok("只含 # 与 .（定义本身看得见形状）", 只含两种记号);
}
{
  const 一个 = call("找字形", ["7"]);
  ok("找得到 7", Array.isArray(一个) && 一个.length === 5, JSON.stringify(一个));
  ok("7 的形状是「### / ..# / ..# / ..# / ..#」", JSON.stringify(一个) === JSON.stringify(["###", "..#", "..#", "..#", "..#"]), JSON.stringify(一个));
  ok("找不到就返回空，不拿别的字顶上", JSON.stringify(call("找字形", ["@"])) === "[]", JSON.stringify(call("找字形", ["@"])));
}

ok("A 与 Z 都在", call("找字形", ["A"]).length === 5 && call("找字形", ["Z"]).length === 5);
ok("小写按大写找", JSON.stringify(call("找字形", ["a"])) === JSON.stringify(call("找字形", ["A"])), JSON.stringify(call("找字形", ["a"])));
ok("空格有自己的字形（五行全空）", JSON.stringify(call("找字形", [" "])) === JSON.stringify(["...", "...", "...", "...", "..."]), JSON.stringify(call("找字形", [" "])));
{
  const 行 = call("字形行", ["HI", 0]);
  ok("两个字母的一行接得起来（H 的 #.# 与 I 的 ###，中间留一列）", 行 === "#.# ### ", JSON.stringify(行));
}

console.log("\n渲染：把字形贴到画布上");
ok("换点把 . 变成空格", call("换点", ["#.#"]) === "# #", JSON.stringify(call("换点", ["#.#"])));
ok("贴行把片段放在指定位置", call("贴行", ["..........", "###", 2]) === "..###.....", JSON.stringify(call("贴行", ["..........", "###", 2])));
{
  const 片段 = call("字形行", ["12", 0]);
  ok("字形行把一串字符的第 0 行接起来", 片段 === "..# ### ", JSON.stringify(片段));
  const 片段4 = call("字形行", ["12", 4]);
  ok("第 4 行同理", 片段4 === "..# ### ", JSON.stringify(片段4));
}
{
  const 布 = call("空画布", [6, 12]);
  const 画过 = call("画大字", [布, 1, 2, "42"]);
  ok("画布还是六行", 画过.length === 6, String(画过.length));
  ok("第 1 行出现了大字的第一行（4 的 #.# 与 2 的 ###，中间留一列）", 画过[1].includes("# # ###"), JSON.stringify(画过[1]));
  ok("第 5 行出现了大字的最后一行（4 的 ..# 与 2 的 ###，中间留一列）", 画过[5].includes("  # ###"), JSON.stringify(画过[5]));
  ok("没被画到的地方仍是空格", 画过[0].trim() === "" && 画过[2].startsWith("  "), JSON.stringify(画过[2]));
}

console.log("\n把它画进一帧");
{
  const src = 'fn main() -> Int effects(process) {\n  let 布 = 空画布(6, 12)\n  print(画一帧(画大字(布, 1, 2, "42")))\n  return 0\n}\n';
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });
  ok("那段小程序解析得动", d.items.filter((x) => x.s === "error").length === 0);
  let buffer = "";
  rt.write = (s) => { buffer += s; };
  rt.registerModule(ast);
  rt.callFunction(rt.functions.get("main"), [], null);
  ok("一帧以清屏开头", buffer.startsWith(ESC + "[2J"), JSON.stringify(buffer.slice(0, 10)));
  ok("帧里出现了大字的笔画", buffer.includes("#"), JSON.stringify(buffer.length));
  ok("没有替换字符", !buffer.includes("\uFFFD"));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
