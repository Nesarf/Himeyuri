// 像素布：另一种布（画颜色，不是画字）。
//
// 与 term 那套字符布分开：那一层画字，这一层画颜色。
// 这一层也是纯数据，所以「往某处写一块颜色」能逐点断言；
// 而导出 PNG 要动世界，走一段带效果的程序。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const rt = runUnit(loadUnit(path.join(ROOT, "pixel.hmoca")));
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};
// 带效果的那条路：跑一段程序，让它的 main 去调。
const 跑程序 = (body, effects) => {
  const src = "fn main() -> Int effects(" + (effects || "process, file") + ") {\n  " + body + "\n  return 0\n}\n";
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });
  const errs = d.items.filter((x) => x.s === "error");
  if (errs.length) return { error: "解析报错 " + errs.map((x) => x.c).join(",") };
  let out = "";
  rt.write = (s) => { out += s; };
  try { rt.registerModule(ast); rt.callFunction(rt.functions.get("main"), [], null); return { out }; }
  catch (e) { return { error: (e.code || "") + " " + e.message }; }
};

console.log("布的形状");
{
  const 布 = call("新布", [4, 3]);
  ok("宽高对得上", 布.w === 4 && 布.h === 3, JSON.stringify([布.w, 布.h]));
  ok("三行、每行四列", 布.行们.length === 3 && 布.行们[0].length === 4);
  ok("一开始全是零（黑）", 布.行们.every((r) => r.every((v) => v === 0)));
}

console.log("写点与取点");
{
  const 布 = call("写点", [call("新布", [4, 3]), 2, 1, 16711680]);
  ok("点上写进去了", call("取点", [布, 2, 1]) === 16711680, String(call("取点", [布, 2, 1])));
  ok("别处没动", call("取点", [布, 1, 1]) === 0);
  ok("越界写不进去，也不报错", call("取点", [call("写点", [布, 9, 9, 255]), 9, 9]) === -1);
  ok("越界取点交回 -1（那是「没有」的意思）", call("取点", [布, -1, 0]) === -1 && call("取点", [布, 0, 99]) === -1);
}

console.log("填横与填矩形");
{
  let 布 = call("填横", [call("新布", [6, 3]), 1, 1, 3, 255]);
  ok("横线有三格", 布.行们[1].filter((v) => v === 255).length === 3, JSON.stringify(布.行们[1]));
  ok("横线从第 1 列起", 布.行们[1][0] === 0 && 布.行们[1][1] === 255);
  ok("横线不越界（长线停在边界）", call("填横", [call("新布", [4, 2]), 2, 0, 99, 255]).行们[0].length === 4);
  布 = call("填矩形", [call("新布", [8, 6]), 1, 1, 4, 3, 16711680]);
  ok("矩形里是红的", call("取点", [布, 2, 2]) === 16711680);
  ok("矩形外是黑的", call("取点", [布, 0, 0]) === 0 && call("取点", [布, 5, 1]) === 0);
  ok("矩形的高也对", call("取点", [布, 1, 3]) === 16711680 && call("取点", [布, 1, 4]) === 0);
}

console.log("导出文本：交给子进程的中间格式");
{
  const 布 = call("填矩形", [call("新布", [3, 2]), 0, 0, 2, 1, 255]);
  const 文本 = call("成文本", [布]);
  const 行们 = 文本.split("\n").filter((l) => l.length);
  ok("第一行说宽度", 行们[0] === "w 3", JSON.stringify(行们[0]));
  ok("第二行说高度", 行们[1] === "h 2", JSON.stringify(行们[1]));
  ok("之后每行是逗号分开的颜色码", 行们[2].split(",").length === 3, JSON.stringify(行们[2]));
  ok("颜色码对得上", 行们[2].split(",")[0] === "255" && 行们[2].split(",")[2] === "0", JSON.stringify(行们[2]));
}

console.log("导出 PNG：一段带效果的程序真的写出了文件");
{
  const 中间 = "E:/DaShaoHuo/cache/tmp/px-test.txt";
  const 目标 = "E:/DaShaoHuo/cache/tmp/px-test.png";
  fs.rmSync(中间, { force: true });
  fs.rmSync(目标, { force: true });
  const r = 跑程序('let 布 = 填矩形(新布(6, 4), 1, 1, 3, 2, 255)\n  let 果 = 导出(布, "' + 中间 + '", "' + 目标 + '")\n  print(果.text)');
  ok("程序跑通", !r.error, String(r.error).slice(0, 80));
  ok("中间文本写出了", fs.existsSync(中间));
  ok("PNG 也生成了", fs.existsSync(目标), String(r.out).slice(0, 60));
  if (fs.existsSync(目标)) {
    const 头 = fs.readFileSync(目标).subarray(0, 8);
    ok("而且是真的 PNG（头八个字节对）", Array.from(头).join(",") === "137,80,78,71,13,10,26,10", Array.from(头).join(","));
  }
  fs.rmSync(中间, { force: true });
  fs.rmSync(目标, { force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
