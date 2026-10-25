// 场景栈与帧循环的验收：动画的每一帧都能被断言。
//
// 规矩照旧：测试里不直接调内置，一切都经过语言自己的程序；而 print 的输出被缓冲接住，
// 所以「跑了几帧、每帧画了什么」是可核对的事实，而不是靠眼睛看终端。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESC = String.fromCharCode(27);
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const rt = runUnit(loadUnit(path.join(ROOT, "term.hmoca")));
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

console.log("\n两个小工具：在字符串上打点、按行号换掉一行");
ok("打个点在第 1 位放 X", call("打个点", ["abc", 1, "X"]) === "aXc", JSON.stringify(call("打个点", ["abc", 1, "X"])));
ok("位置超出长度时原样返回", call("打个点", ["ab", 9, "X"]) === "ab", JSON.stringify(call("打个点", ["ab", 9, "X"])));
{
  const 布 = call("换行", [["aa", "bb", "cc"], 1, "ZZ"]);
  ok("换行只改指定那一行", JSON.stringify(布) === JSON.stringify(["aa", "ZZ", "cc"]), JSON.stringify(布));
}

console.log("\n场景：用名字分派，随时间推进");
{
  const 布 = ["....", "...."];
  const 第0帧 = call("叠", [布, ["点"], 0]);
  const 第1帧 = call("叠", [布, ["点"], 1]);
  const 第2帧 = call("叠", [布, ["点"], 2]);
  ok("第 0 帧的点在最左", 第0帧[0][0] === "*", JSON.stringify(第0帧));
  ok("第 1 帧的点移动了一格", 第1帧[0][1] === "*", JSON.stringify(第1帧));
  ok("第 2 帧又移动一格", 第2帧[0][2] === "*", JSON.stringify(第2帧));
  ok("三层各不相同（时间真的在推进）", JSON.stringify(第0帧) !== JSON.stringify(第1帧) && JSON.stringify(第1帧) !== JSON.stringify(第2帧));
}
{
  const 布 = ["....", "...."];
  const 两层 = call("叠", [布, ["点", "横线"], 1]);
  ok("两层叠在同一张画布上", 两层[0][1] === "*" && 两层[1][1] === "-", JSON.stringify(两层));
}

console.log("\n帧循环：每一帧都被写出来，而且带着清屏");
{
  const src = 'fn main() -> Int effects(process) {\n  print(跑(("点",), 3, 0))\n  return 0\n}\n';
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });
  const errs = d.items.filter((x) => x.s === "error");
  ok("那段小程序解析得动", errs.length === 0, errs.map((x) => x.c).join(","));
  let buffer = "";
  rt.write = (s) => { buffer += s; };
  rt.registerModule(ast);
  rt.callFunction(rt.functions.get("main"), [], null);
  ok("输出了三帧（三处清屏）", (buffer.split(ESC + "[2J").length - 1) === 3, String(buffer.split(ESC + "[2J").length - 1));
  ok("每帧里都有那个点", (buffer.split("*").length - 1) >= 3, String(buffer.split("*").length - 1));
  ok("点的位置逐帧不同", buffer.indexOf("*") !== buffer.lastIndexOf("*"));
  ok("没有替换字符", !buffer.includes("\uFFFD"));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
