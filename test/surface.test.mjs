// 表面与合成：主窗口里多开子窗口，先在没有真窗口的时候验清楚。
//
// 合成规则与将来真窗口要走的完全一样：子表面按自己的坐标贴到主布上，
// 后贴的盖住先贴的，越界的行跳过。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESC = String.fromCharCode(27);
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "surface.hmoca"));
ok("表面那一层加载得动", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};
const 主 = (行, 列) => call("空画布", [行, 列]);

console.log("表面自己的形状");
{
  const s = call("新表面", ["A", 2, 10]);
  ok("名字、行数、列数都在", s.name === "A" && s.rows === 2 && s.cols === 10, JSON.stringify([s.name, s.rows, s.cols]));
  ok("默认位置在原点", s.x === 0 && s.y === 0);
  ok("布是两行十列", s.布.length === 2 && s.布[0].length === 10);
  const 放好 = call("放", [s, 3, 1]);
  ok("放之后坐标变了，布不变", 放好.x === 3 && 放好.y === 1 && 放好.布[0] === s.布[0]);
}

console.log("在表面里写字");
{
  const s = call("写", [call("新表面", ["A", 2, 10]), 0, 0, "hi"]);
  ok("写在第一行开头", s.布[0].startsWith("hi"), JSON.stringify(s.布[0]));
  const 越界行 = call("写", [call("新表面", ["A", 2, 10]), 5, 0, "x"]);
  ok("写不存在的行时原样交回（不崩）", 越界行.布.length === 2);
  const 长字 = call("写", [call("新表面", ["A", 2, 6]), 0, 4, "abcdef"]);
  ok("字比剩余宽度长时只放得下的部分进来", 长字.布[0].length === 6, JSON.stringify(长字.布[0]));
}

console.log("合成：两张子表面同时在场");
{
  let 布 = 主(5, 20);
  const a = call("写", [call("放", [call("新表面", ["A", 2, 8]), 0, 0]), 0, 0, "AAA"]);
  const b = call("写", [call("放", [call("新表面", ["B", 2, 8]), 1, 2]), 0, 0, "BBB"]);
  布 = call("合成", [布, [a, b], 0]);
  ok("A 在第一行", 布[0].startsWith("AAA"), JSON.stringify(布[0]));
  // 放(B, 1, 2) 是 x=1、y=2：第三行，第二列，所以只留一列空白。
  ok("B 在第三行、从第二列起", 布[2].startsWith(" BBB"), JSON.stringify(布[2]));
  ok("没被画到的地方仍是空格", 布[4].trim() === "", JSON.stringify(布[4]));
  ok("行数与宽度没变", 布.length === 5 && 布.every((l) => l.length === 20));
}
console.log("后贴的盖住先贴的");
{
  let 布 = 主(3, 10);
  const 底 = call("写", [call("放", [call("新表面", ["底", 1, 10]), 0, 0]), 0, 0, "缺缺缺缺缺"]);
  const 盖 = call("写", [call("放", [call("新表面", ["盖", 1, 3]), 0, 0]), 0, 0, "盖盖"]);
  布 = call("合成", [布, [底, 盖], 0]);
  ok("前面被后面盖住", 布[0].startsWith("盖盖"), JSON.stringify(布[0]));
}
console.log("越界：子表面比主布大也不崩");
{
  let 布 = 主(2, 5);
  const 大 = call("写", [call("放", [call("新表面", ["大", 9, 20]), 0, 0]), 0, 0, "xxxxx"]);
  布 = call("合成", [布, [大], 0]);
  ok("主布仍是两行五列", 布.length === 2 && 布[0].length === 5);
  ok("贴进来的那部分在", 布[0] === "xxxxx", JSON.stringify(布[0]));
}
console.log("一整帧：清屏、归位、逐行写出");
{
  const 帧 = call("画表面", [主(2, 4)]);
  ok("以清屏开头", 帧.startsWith(ESC + "[2J"), JSON.stringify(帧.slice(0, 10)));
  ok("清屏之后归位", 帧.startsWith(ESC + "[2J" + ESC + "[1;1H"));
  ok("两行之后各一个换行", (帧.match(/\n/g) || []).length === 2);
}

console.log("表面挂到任务上：关掉子窗口，画面就没了");
{
  // 树：主窗口(0) → A(1) → A 的面板(3)；主窗口 → B(2)
  let 树 = call("空树", []);
  树 = call("挂", [树, "主窗口", -1]);
  树 = call("挂", [树, "子窗口 A", 0]);
  树 = call("挂", [树, "子窗口 B", 0]);
  树 = call("挂", [树, "A 的面板", 1]);

  const a = call("写", [call("放", [call("归主", [call("新表面", ["A", 1, 6]), 1]), 0, 0]), 0, 0, "AAA"]);
  const b = call("写", [call("放", [call("归主", [call("新表面", ["B", 1, 6]), 2]), 0, 1]), 0, 0, "BBB"]);
  const 表 = [a, b];

  ok("归主之后 owner 对得上", a.owner === 1 && b.owner === 2, JSON.stringify([a.owner, b.owner]));
  ok("新表面默认不属于任何任务", call("新表面", ["X", 1, 3]).owner === -1);
  ok("两张表面都在场（它们的 owner 都还在）", call("在场", [表, 树]).length === 2, String(call("在场", [表, 树]).length));

  let 布 = call("空画布", [3, 10]);
  const 画前 = call("合成在场", [布, 表, 树]);
  ok("合成之后 A 与 B 都在", (画前[0] + 画前[1]).includes("AAA") && (画前[0] + 画前[1]).includes("BBB"), JSON.stringify(画前));

  const 剩 = call("取消", [树, 1]);
  ok("取消 A 之后，只剩 B 在场", call("在场", [表, 剩]).length === 1, String(call("在场", [表, 剩]).length));
  const 画后 = call("合成在场", [布, 表, 剩]);
  ok("画面上 A 不见了", !(画后[0] + 画后[1]).includes("AAA"), JSON.stringify(画后));
  ok("而 B 还在", (画后[0] + 画后[1]).includes("BBB"), JSON.stringify(画后));
}
{
  // 最要紧的一条：取消主窗口，画面上一张都不剩
  let 树 = call("空树", []);
  树 = call("挂", [树, "主窗口", -1]);
  树 = call("挂", [树, "子窗口 A", 0]);
  const a = call("归主", [call("写", [call("新表面", ["A", 1, 6]), 0, 0, "AAA"]), 1]);
  const 全空 = call("取消", [树, 0]);
  ok("取消主窗口之后，它的子窗口的表面也不在场", call("在场", [[a], 全空]).length === 0, String(call("在场", [[a], 全空]).length));
  ok("主表面（owner 为 -1）不受任务树影响", call("在场", [[call("新表面", ["主", 1, 4])], 全空]).length === 1);
}

console.log("呈现后端：现在只有字符终端一个");
{
  ok("后端名是 term", call("后端名", []) === "term", JSON.stringify(call("后端名", [])));
  const 帧 = call("呈现", ["term", 主(2, 4)]);
  ok("呈现给的是整帧（清屏开头）", 帧.startsWith(ESC + "[2J"), JSON.stringify(帧.slice(0, 10)));
  // 契约里写着 native（真窗口）待做。这里让它在断言里明说，而不是留一个看起来能用的分支。
  const 未知 = call("呈现", ["native", 主(2, 4)]);
  ok("真窗口后端还没做，如实说没有这个后端", 未知.indexOf("没有这个后端") >= 0, JSON.stringify(未知.slice(0, 40)));
}

console.log("native 后端：借一个子进程开真窗口（这里只验管道，不弹窗）");
{
  const r = call("呈现进程", ["term", 主(2, 4), ""]);
  ok("term 那条给出整帧", r.ok && String(r.text).startsWith(ESC + "[2J"), JSON.stringify(String(r.text).slice(0, 12)));
  const n = call("呈现进程", ["native", 主(2, 4), "hello"]);
  ok("native 那条跑得通", n.ok && String(n.text).indexOf("退出码 0") >= 0, JSON.stringify(String(n.text).slice(0, 90)));
  ok("报告里说清了尺寸与文字长度", String(n.text).indexOf("HMYR-SURFACE") >= 0 && String(n.text).indexOf("\"width\":640") >= 0, JSON.stringify(String(n.text).slice(0, 120)));
  const 坏 = call("呈现进程", ["nope", 主(2, 4), ""]);
  ok("没有的后端如实说", 坏.ok === false && String(坏.text).indexOf("没有这个后端") >= 0, JSON.stringify(坏));
  // 纯的那一个仍然不启动进程：它对 native 只能说「没有这个后端」，因为真窗口是动世界的事。
  const 纯 = call("呈现", ["native", 主(2, 4)]);
  ok("纯的呈现不启动进程（所以只说没有这个后端）", String(纯).indexOf("没有这个后端") >= 0, JSON.stringify(String(纯).slice(0, 40)));
}

console.log("图像：把像素布导出的 PNG 交给 native 后端");
{
  const fs2 = (await import("node:fs")).default;
  const 图 = "E:/DaShaoHuo/cache/tmp/surface-img.png";
  // 子进程里要加载的那几个 mjs 与 pixel.hmoca 都按仓库自身位置算，不写死盘符。
  const 仓根 = new URL("..", import.meta.url);
  const 仓根斜 = 仓根.pathname.slice(1);
  // 先借像素那条路造一张 16x10 的图
  const { spawnSync } = await import("node:child_process");
  const 造 = spawnSync(process.execPath, ["-e", [
    'const { loadUnit, runUnit } = await import("' + new URL("src/loader.mjs", 仓根).href + '");',
    'const { lex } = await import("' + new URL("src/lexer.mjs", 仓根).href + '");',
    'const { parse } = await import("' + new URL("src/parser.mjs", 仓根).href + '");',
    'const rt = runUnit(loadUnit("' + 仓根斜 + 'pixel.hmoca"));',
    'const d = { items: [], errors: [], warnings: [], add(){}, error(){}, warn(){} };',
    'const src = "fn main() -> Int effects(process, file) {\\n  let 布 = 填矩形(新布(16, 10), 2, 2, 8, 5, 11141120)\\n  let 果 = 导出(布, \\"E:/DaShaoHuo/cache/tmp/surface-img.txt\\", \\"E:/DaShaoHuo/cache/tmp/surface-img.png\\")\\n  print(果.text)\\n  return 0\\n}\\n";',
    'const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });',
    'rt.write = (s) => process.stdout.write(s);',
    'rt.registerModule(ast);',
    'rt.callFunction(rt.functions.get("main"), [], null);',
  ].join("\n")], { encoding: "utf8" });
  ok("测试图造得出", fs2.existsSync(图), String(造.stderr || "").slice(0, 80));
  const r = call("呈现图像", ["native", 图]);
  ok("native 后端加载得了图像", r.ok === true, JSON.stringify(String(r.text).slice(0, 100)));
  ok("报告里说清了图像尺寸", String(r.text).indexOf("\"image_w\":16") >= 0 && String(r.text).indexOf("\"image_h\":10") >= 0, JSON.stringify(String(r.text).slice(0, 140)));
  const 坏 = call("呈现图像", ["term", 图]);
  ok("字符后端不呈现图像，如实说", 坏.ok === false && String(坏.text).indexOf("还不呈现图像") >= 0, JSON.stringify(坏));
  fs2.rmSync(图, { force: true });
  fs2.rmSync("E:/DaShaoHuo/cache/tmp/surface-img.txt", { force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
