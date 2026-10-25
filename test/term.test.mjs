// term 的验收：帧是数据，不是字节。
//
// 六个内置只**返回字符串**（转义序列），副作用留给了 print——所以「画到真终端」与「画进字符串
// 缓冲」是同一条路，而动画因此能被断言。这一条是它比参考实现更干净的地方。
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

const unit = loadUnit(path.join(ROOT, "term.hmoca"));
ok("终端模块加载", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

console.log("\n转义序列由内置给出，而且是可核对的字符串");
ok("清屏 = ESC[2J", call("清屏", []) === ESC + "[2J", JSON.stringify(call("清屏", [])));
ok("归位 = ESC[1;1H（与 ESC[H 等价）", call("归位", []) === ESC + "[1;1H", JSON.stringify(call("归位", [])));
ok("定位 = ESC[行;列H", call("定位", [3, 7]) === ESC + "[3;7H", JSON.stringify(call("定位", [3, 7])));
ok("上色（前景 196）= 256 色序列", call("上色", [196, -1]) === ESC + "[38;5;196m", JSON.stringify(call("上色", [196, -1])));
ok("上色（前景与背景都在）", call("上色", [196, 21]) === ESC + "[38;5;196;48;5;21m", JSON.stringify(call("上色", [196, 21])));
ok("收色 = ESC[0m", call("收色", []) === ESC + "[0m", JSON.stringify(call("收色", [])));
ok("藏光标与显光标", call("藏光标", []) === ESC + "[?25l" && call("显光标", []) === ESC + "[?25h");

console.log("\n画布与一帧");
{
  const 布 = call("空画布", [2, 4]);
  ok("空画布是两行、每行四个空格", Array.isArray(布) && 布.length === 2 && 布[0] === "    " && 布[1] === "    ", JSON.stringify(布));
}
{
  const 帧 = call("画一帧", [call("空画布", [2, 3])]);
  ok("一帧以清屏开头", 帧.startsWith(ESC + "[2J"), JSON.stringify(帧.slice(0, 12)));
  ok("清屏之后立刻归位", 帧.startsWith(ESC + "[2J" + ESC + "[1;1H"), JSON.stringify(帧.slice(0, 16)));
  ok("每行之后都换行", (帧.match(/\n/g) || []).length === 2, JSON.stringify(帧));
  ok("没有替换字符（转义序列是构造出来的，不是猜的）", !帧.includes("\uFFFD"));
}
{
  const 帧 = call("画一帧", [["红", "绿"]]);
  ok("画布的内容原样出现在帧里", 帧.endsWith("红\n绿\n"), JSON.stringify(帧));
}
{
  // 内置住在求值器的内置表里，只有语言自己的调用语法到得了它们——所以这里走包装函数。
  // （这条今天已经咬过一次：测试里不许直接调内置。）
  const 行 = call("尺寸行", []);
  const 列 = call("尺寸列", []);
  ok("尺寸行与尺寸列都是正数", 行 > 0 && 列 > 0, 行 + " x " + 列);
}

console.log("\n可注入：同一帧既能进终端，也能进字符串");
{
  // print 本身也是内置，所以这里跑一段**完整的 Himeyuri 程序**：它自己 print 那一帧，
  // 而 rt.write 换成缓冲，于是帧的内容可以被断言。规矩：测试里不直接调内置。
  const src = 'fn main() -> Int {\n  print(画一帧(("第一行", "第二行")))\n  return 0\n}\n';
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });
  const errs = d.items.filter((x) => x.s === "error");
  ok("那段小程序本身解析得动", errs.length === 0, errs.map((x) => x.c).join(","));
  const 求值器 = runUnit(loadUnit(path.join(ROOT, "term.hmoca")));
  let buffer = "";
  求值器.write = (s) => { buffer += s; };
  求值器.registerModule(ast);          // 把模块函数与这段 main 放进同一个求值器
  求值器.callFunction(求值器.functions.get("main"), [], null);
  ok("缓冲以清屏开头", buffer.startsWith(ESC + "[2J"), JSON.stringify(buffer.slice(0, 16)));
  ok("两行内容都在缓冲里", buffer.includes("第一行") && buffer.includes("第二行"), JSON.stringify(buffer));
  ok("帧的字节里没有替换字符", !buffer.includes("\uFFFD"));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
