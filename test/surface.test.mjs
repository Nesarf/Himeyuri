// 表面与合成：主窗口里多开子窗口，先在没有真窗口的时候验清楚。
//
// 合成规则与将来真窗口要走的完全一样：子表面按自己的坐标贴到主布上，
// 后贴的盖住先贴的，越界的行跳过。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { 临时目录, 临时mkdtempSync, 临时文件 } from "./scratch.mjs";

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
  const 图 = 临时文件("surface-img.png");
  // 子进程里要加载的那几个 mjs 与 pixel.hmoca 都按仓库自身位置算，不写死盘符。
  // 仓库根：Windows 上 pathname 是 /D:/himeyuri/，去掉开头那个斜杠才是有盘符的形式；
  // POSIX 上它本来就是 /mnt/d/himeyuri/，去掉斜杠就成了相对路径 —— 于是 loadUnit
  // 找不到 pixel.hmoca，"测试图造得出"那一条跟着红（2026-11-03 跨系统时踩到）。
  const 仓根 = new URL("..", import.meta.url);
  const 仓根斜 = process.platform === "win32" ? 仓根.pathname.slice(1) : 仓根.pathname;
  // 先借像素那条路造一张 16x10 的图
  const { spawnSync } = await import("node:child_process");
  const 造 = spawnSync(process.execPath, ["-e", [
    'const { loadUnit, runUnit } = await import("' + new URL("src/loader.mjs", 仓根).href + '");',
    'const { lex } = await import("' + new URL("src/lexer.mjs", 仓根).href + '");',
    'const { parse } = await import("' + new URL("src/parser.mjs", 仓根).href + '");',
    'const rt = runUnit(loadUnit("' + 仓根斜 + 'pixel.hmoca"));',
    'const d = { items: [], errors: [], warnings: [], add(){}, error(){}, warn(){} };',
    'const src = "fn main() -> Int effects(process, file) {\\n  let 布 = 填矩形(新布(16, 10), 2, 2, 8, 5, 11141120)\\n  let 果 = 导出(布, \\"' + 临时文件("surface-img.txt") + '\\", \\"' + 临时文件("surface-img.png") + '\\")\\n  print(果.text)\\n  return 0\\n}\\n";',
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
  fs2.rmSync(临时文件("surface-img.txt"), { force: true });
}

console.log("会话：窗活着的那一段时间里，事件进得去、帧换得过来");
{
  // 毫秒 0 → 不弹窗，只验回执的形状。这一节全部走这条路：套件不该在别人桌面上
  // 弹窗抢焦点，而「会话的形状对不对」与「它会不会真弹」本来就是两件事。
  const 空 = call("会话", ["native", 主(2, 4), "hello", 0, 0, ""]);
  ok("会话跑得通", 空.ok === true, JSON.stringify(String(空.text).slice(0, 120)));
  ok("回执说没弹窗", String(空.text).indexOf("\"shown\":false") >= 0, JSON.stringify(String(空.text).slice(0, 120)));
  ok("没有事件时事件表是空的", String(空.text).indexOf("\"events\":[]") >= 0, JSON.stringify(String(空.text).slice(0, 160)));

  // 三帧、间隔 100 毫秒：NoShow 下报的是「本来要换几次」，也就是帧数减一。
  const 多帧 = call("会话", ["native", 主(2, 4), "a|b|c", 0, 100, ""]);
  ok("三帧报换了两次", String(多帧.text).indexOf("\"frames\":2") >= 0, JSON.stringify(String(多帧.text).slice(0, 160)));

  // 注入的事件要原样回传：这条守的是「窗口到语言的那条通道」，而不是
  // 「有人真的按了键」—— 后者在这台机器上没法自动验。
  const 有事件 = call("会话", ["native", 主(2, 4), "hello", 0, 0, "key:A;mouse:10,20"]);
  ok("键事件原样回来", String(有事件.text).indexOf("\"kind\":\"key\",\"value\":\"A\"") >= 0,
     JSON.stringify(String(有事件.text).slice(0, 200)));
  ok("鼠标事件的坐标也在",
     String(有事件.text).indexOf("\"x\":10") >= 0 && String(有事件.text).indexOf("\"y\":20") >= 0,
     JSON.stringify(String(有事件.text).slice(0, 200)));

  const 坏 = call("会话", ["term", 主(2, 4), "hello", 0, 0, ""]);
  ok("字符后端不承认开会话，如实说", 坏.ok === false && String(坏.text).indexOf("这个后端还不开会话") >= 0, JSON.stringify(坏));

  // 后三种事件（design/OPEN.txt 第十二条记的「仍然没有的」）：指针移动、滚轮、长按重复。
  // 三种都是注入的，与 key/mouse 走同一条路 —— 所以它们检验的是「回执把注入的东西
  // 原样带回来」，而不是「真的有人在滚轮」。
  const 多 = call("会话", ["native", 主(2, 4), "hello", 0, 0, "move:33,44;wheel:3;key:B:4"]);
  ok("指针移动原样回来", String(多.text).indexOf("\"kind\":\"move\"") >= 0
     && String(多.text).indexOf("\"x\":33") >= 0 && String(多.text).indexOf("\"y\":44") >= 0,
     JSON.stringify(String(多.text).slice(0, 240)));
  ok("滚轮的方向也在", String(多.text).indexOf("\"kind\":\"wheel\"") >= 0
     && String(多.text).indexOf("\"delta\":3") >= 0, JSON.stringify(String(多.text).slice(0, 240)));
  ok("长按的重复次数也在", String(多.text).indexOf("\"repeat\":4") >= 0,
     JSON.stringify(String(多.text).slice(0, 240)));
  ok("老的 key 仍然只有 value（不因新字段变样）", String(多.text).indexOf("\"value\":\"B\"") >= 0,
     JSON.stringify(String(多.text).slice(0, 240)));
}

console.log("");
console.log("真窗口：开出来，另一个进程查得见，关掉之后查不见");
if (process.platform !== "linux") {
  // 这一节问的是 X11 的窗口表。Windows 那一侧的真窗口是 WPF（deps/surface/win.ps1），
  // 它不交窗口 id，也没有 X11 可问 —— 而「窗口在不在」在那条路上没有别的自动判据，
  // 所以在别的平台上如实跳过，而不是拿一句「反正开了」冒充。
  console.log("  跳过  这一节问的是 X11 的窗口表（libX11），Windows 上那一侧是 WPF");
} else {
  // 三件事，一条链：后端开窗并把 id 打进回执；另一个进程（xprobe.py）查得见 viewable；
  // 后端退出之后同一个 id 查出来是 gone。
  // 2026-11-03 立的这一节：在那之前，真开窗没有任何自动判据，只能靠眼睛。
  // spawnSync 在别的节里是局部 import 的，这一节自己取一份。
  const { spawnSync } = await import("node:child_process");
  const 行批 = [
    "set -u",
    "T=$(mktemp)",
    'python3 deps/surface/win.py -ShowMs 1500 > "$T" 2>&1 &',
    "P=$!",
    "sleep 0.9",
    "ID=$(grep -o '\"window\":[0-9]*' \"$T\" | head -1 | cut -d: -f2)",
    'echo "id:$ID"',
    'echo "alive:$(python3 deps/surface/xprobe.py "$ID")"',
    'wait "$P"',
    'echo "after:$(python3 deps/surface/xprobe.py "$ID")"',
    'rm -f "$T"',
  ].join("\n");
  const 跑体 = spawnSync("bash", ["-c", 行批], { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  const 出 = String(跑体.stdout || "");
  const 取 = (键) => {
    const m = 出.match(new RegExp("^" + 键 + ":(.*)$", "m"));
    return m ? m[1].trim() : "";
  };
  const 窗 = 取("id");
  ok("真的拿到了一个窗口 id", /^[0-9]+$/.test(窗), 出.slice(0, 200));
  ok("窗口活着的时候 X 说 viewable", 取("alive") === "viewable", 出.slice(0, 200));
  ok("后端退出之后同一个 id 是 gone", 取("after") === "gone", 出.slice(0, 200));
}

console.log("");
console.log("屏幕与缩放：问 X11，不靠猜");
if (process.platform !== "linux") {
  // 与真窗口那一节同一个理由：这一节问的是 X11。Windows 那一侧的取法完全不同
  // （GetSystemMetrics 与 DPI awareness），而今天没有第二个后端，所以如实跳过。
  console.log("  跳过  这一节问的是 X11 的屏幕表，Windows 上那一侧是另一套");
} else {
  // 两件事：主屏的像素与毫米（缩放由它们的比值决定），以及 Xinerama 认得几个显示器。
  // 2026-11-03 立的 —— design/OPEN.txt 第十二条那条「还没有的」收的就是它。
  // spawnSync 在别的节里也是局部 import 的，这一节自己取一份。
  const { spawnSync } = await import("node:child_process");
  const 屏 = spawnSync("python3", ["deps/surface/xprobe.py", "--screen"], { cwd: ROOT, encoding: "utf8", timeout: 60000 });
  const 屏行 = String(屏.stdout || "").trim();
  const 数 = (屏行.match(/screen:(\d+) (\d+)x(\d+) (\d+)x(\d+)mm dpi:([\d.]+)/) || []);
  ok("主屏那四个数都拿到了", 数.length === 7, 屏行.slice(0, 120));
  if (数.length === 7) {
    ok("像素是正的", Number(数[2]) > 0 && Number(数[3]) > 0, 数[2] + "x" + 数[3]);
    ok("毫米也是正的（缩放要从它算）", Number(数[4]) > 0 && Number(数[5]) > 0, 数[4] + "x" + 数[5]);
    const 点 = Number(数[6]);
    ok("算出的 DPI 在 72 到 300 之间（超出就说明毫米是假值）", 点 >= 72 && 点 <= 300, String(点));
  }

  const 屏们 = spawnSync("python3", ["deps/surface/xprobe.py", "--screens"], { cwd: ROOT, encoding: "utf8", timeout: 60000 });
  const 行们 = String(屏们.stdout || "").trim().split("\n").filter((l) => l.startsWith("monitor:"));
  ok("Xinerama 至少答一个显示器", 行们.length >= 1, String(屏们.status) + " " + String(屏们.stderr || "").slice(0, 120));
  ok("每个显示器都报得出位置与尺寸", 行们.every((l) => /monitor:\d+ -?\d+,-?\d+ \d+x\d+/.test(l)), 行们.join(" | ").slice(0, 160));
}

console.log("deps/surface 下的 .ps1 只许 ASCII —— 这是 powershell.exe 5.1 的代码页，不是洁癖");
{
  // powershell.exe 5.1（不是 pwsh 7）读脚本时，没有 BOM 就按当前代码页解码。
  // 中文注释被解成 GBK 字节对，而 GBK 的第二字节可以落在 ASCII 区 ——
  // 于是一个汉字能变成半个括号，报错却指在 param() 那一行，与真正出错的地方无关。
  // win.ps1 与 parallel.ps1 都在 2026-11-02 踩过，所以立这条判据代替「记得」。
  // .py 不受这一条约束：Python 3 按 UTF-8 读源码，注释里的中文是安全的。
  const 目录 = path.join(ROOT, "deps", "surface");
  const 脚本们 = fs.readdirSync(目录).filter((f) => f.endsWith(".ps1")).sort();
  ok("找到了 .ps1 脚本", 脚本们.length > 0, 脚本们.join(","));
  for (const f of 脚本们) {
    const 字节 = fs.readFileSync(path.join(目录, f));
    let 越界 = 0;
    for (const b of 字节) if (b > 127) 越界++;
    ok(f + " 是纯 ASCII", 越界 === 0, f + " 有 " + 越界 + " 个非 ASCII 字节");
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
