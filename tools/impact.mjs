// 工程地图：给一个文件，答「哪些套件会因此动」；或者给 --map，答整张图。
//
// 为什么要有它：每修一处就把十套一起拉（或者跑十几分钟的量具），是拿时间买「不用想影响面」。
// 而那些关系是静态可查的 —— 谁加载了 self/run.hmyr、self/*.hmyr 之间谁 import 谁、
// 哪个套件 import 了 src/eval.mjs。这张图本来就是写在那里的，只是没人把它拼起来。
//
// 用法：
// 2026-11-02：这一份的判据已经并入 mega-index-map 的工程地图（library_project 的
// op=affects），两边的规则取过并集 —— 「装载器调用」与「命令行参数里的源码路径」那两条
// 正是从这里搬过去的。留着这一份的理由只有一个：它是离线兜底，只要 node，不依赖宿主，
// 也不依赖插件被加载。
//
// 所以两份规则要一起改：改了这一边而那边没动，两张地图会给出不同的影响面，而差异不会
// 报错 —— 只会让某个人按错的那张去跑套件。MIM 那边还多两条这里没有的：它按扩展名选
// 语言规则，并且把 test 目录认成套件。
//
//   node tools/impact.mjs self/body.hmoca      给一个文件，答它会碰到哪些套件
//   node tools/impact.mjs src/eval.mjs         对 src 模块同样答
//   node tools/impact.mjs --map               整张图：谁 import 谁、每个套件加载了什么
//   node tools/impact.mjs <文件> --all         不省略，把「无关」也列全
//   node tools/impact.mjs <文件> --suites      只吐套件名，逗号分隔，直接接在 --only 后面
//
// --suites 那一条是「改一份跑哪些」的可执行形态：那句话原来写在纪律里，靠人记。
//   node tools/check-all.mjs --only "$(node tools/impact.mjs src/parser.mjs --suites)"
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 参数 = process.argv.slice(2);
const 要全部 = 参数.includes("--all");
const 要总图 = 参数.includes("--map");
// 只吐套件名，逗号分隔，直接接在 check-all 后面：
//   node tools/check-all.mjs --only "$(node tools/impact.mjs src/parser.mjs --suites)"
// 这是「改一份跑哪些」那句话的可执行形态 —— 那句话原来写在纪律里，靠人记。
const 要套件 = 参数.includes("--suites");
const 目标 = 参数.find((a) => !a.startsWith("--"));

// ---- 一、.hmyr 之间谁 import 谁（全仓，不只 self/）----
// 只看 self/ 会漏：json.hmyr 被 manifest.hmyr 用、lib/json.hmyr 被 lsp.hmyr 用 ——
// 而改 json.hmyr 会波及 manifest 那一串套件。所以扫描范围是整棵树。
const 跳过 = new Set(["node_modules", ".git", "dist", "swap", ".tmp-index", ".tmp-sign"]);
const hmyr们 = [];
const 走目录 = (相对) => {
  const 全 = path.join(ROOT, 相对);
  let 项们;
  try { 项们 = fs.readdirSync(全, { withFileTypes: true }); } catch { return; }
  for (const 项 of 项们) {
    if (跳过.has(项.name)) continue;
    const 子 = 相对 ? 相对 + "/" + 项.name : 项.name;
    if (项.isDirectory()) 走目录(子);
    else if (项.name.endsWith(".hmoca")) hmyr们.push(子);
  }
};
走目录("");
hmyr们.sort();

const self依赖 = new Map(); // 文件（仓库相对路径）→ 它 import 的文件
for (const 路 of hmyr们) {
  const 源 = fs.readFileSync(path.join(ROOT, 路), "utf8");
  const 依赖 = [];
  const 本目录 = path.posix.dirname(路);
  // 两种拼法都认：关键字换成汉字之后源码里写的是「引入」，而这张图要能读现在的源码。
  // 只认 import 的后果是安静的：整仓 .hmoca 的依赖边会一条都查不到，工具却照样退出 0，
  // 于是「改这个文件会碰到谁」得到的是「没有——它是入口」。
  for (const m of 源.matchAll(/^(?:import|引入)\s+"([^"]+)"/gm)) {
    const 原 = m[1];
    if (!原.startsWith("./") && !原.startsWith("../")) continue;
    const 解 = path.posix.normalize(path.posix.join(本目录 === "." ? "" : 本目录, 原));
    if (fs.existsSync(path.join(ROOT, 解))) 依赖.push(解);
  }
  self依赖.set(路, 依赖);
}
// 反过来：谁 import 了我（多级）
const 上游 = (路) => {
  const 见过 = new Set();
  const 走 = (x) => {
    for (const [子, 依] of self依赖) {
      if (依.includes(x) && !见过.has(子)) { 见过.add(子); 走(子); }
    }
  };
  走(路);
  return 见过;
};

// ---- 二、每个套件加载了什么 ----
const 清单 = fs.readFileSync(path.join(ROOT, "tools/suite-list.txt"), "utf8")
  .split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.split("\t"));
const 套件 = [];
for (const [名, 脚本] of 清单) {
  const 路 = path.join(ROOT, 脚本);
  if (!fs.existsSync(路)) continue;
  const 源 = fs.readFileSync(路, "utf8");
  const 载入 = new Set();
  // 三种写法都认：loadUnit 直接加载、path.join 拼出来的路径、以及出现在字符串参数里的
  // 路径 —— test/curve.test.mjs 就是 spawn 一个 --compile self/curve.hmoca。
  // 第三种刻意宽：它会连注释里提到的路径一起收进来，于是可能多报一套。多报的代价是白跑
  // 一套，漏报的代价是改完不知道要验什么，两者不对称。
  for (const m of 源.matchAll(/loadUnit\(path\.join\(ROOT,\s*"([^"]+)"/g)) 载入.add(m[1].split("\\").join("/"));
  for (const m of 源.matchAll(/path\.join\(ROOT,\s*"([^"]+\.(?:hmyr|hmoca))"/g)) 载入.add(m[1].split("\\").join("/"));
  for (const m of 源.matchAll(/["']([A-Za-z0-9_./\\-]+\.hmoca)["']/g)) 载入.add(m[1].split("\\").join("/"));
  // 第四种：被当成命令行参数 spawn 出去的 .mjs 工具。上面那三条只收 .hmoca，
  // 于是 test/curve.test.mjs 调 tools/curve-batch.mjs 这条边从前是隐形的 ——
  // 改那个探针，--affects 会答「没有套件」，而 curve 会红。
  // 单独一个集合而不是并进 载入：混进去会让 --map 把 .mjs 列在
  // 「每个套件加载的 .hmyr」那个标题底下，标题就成了假话。
  // 只收仓库内的相对路径，所以 from "../src/x.mjs" 这一种不会被误收 —— 它由下面那一条管。
  const 脚本们 = new Set();
  for (const m of 源.matchAll(/["']((?:tools|bin|src|test|vm)\/[A-Za-z0-9_./-]+\.mjs)["']/g)) 脚本们.add(m[1]);
  const src们 = new Set([...源.matchAll(/from "\.\.\/src\/([^"]+)"/g)].map((m) => "src/" + m[1]));
  // 被 spawn 的工具脚本自己也 import src，那些依赖也要算进这个套件。
  // 少了这一步，改 src/vm.mjs（curve-batch.mjs 正是用它跑字节码）不会选中 curve，
  // 而曲线套件就是会红的那个。这条缺口是 2026-11-02 加探针时当场露出来的。
  for (const 工 of 脚本们) {
    let 工源 = "";
    try { 工源 = fs.readFileSync(path.join(ROOT, 工), "utf8"); } catch { continue; }
    for (const m of 工源.matchAll(/from\s+"\.\.\/src\/([^"]+)"/g)) src们.add("src/" + m[1]);
  }
  套件.push({ 名, 脚本, 载入, 脚本们, src: src们 });
}

// ---- 二半、src 模块之间谁 import 谁 ----
// 为什么要有这一段：查 src/parser.mjs 时，只算「直接 import 它的套件」会漏掉一批 ——
// src/loader.mjs 自己也 import parser，而那几个套件只 import loader。改 parser 会波及它们，
// 它们却不在答案里。所以 src 这一侧也要走一遍闭包。
const src文件们 = fs.readdirSync(path.join(ROOT, "src")).filter((f) => f.endsWith(".mjs")).sort();
const src依赖 = new Map(); // src/xxx.mjs → 它 import 的 src 文件
for (const 名 of src文件们) {
  const 路 = "src/" + 名;
  const 源 = fs.readFileSync(path.join(ROOT, 路), "utf8");
  const 依赖 = [];
  for (const m of 源.matchAll(/from\s+"\.\/([^"]+\.mjs)"/g)) {
    const 解 = "src/" + m[1];
    if (fs.existsSync(path.join(ROOT, 解))) 依赖.push(解);
  }
  src依赖.set(路, 依赖);
}
const src上游 = (路) => {
  const 见过 = new Set();
  const 走 = (x) => {
    for (const [子, 依] of src依赖) {
      if (依.includes(x) && !见过.has(子)) { 见过.add(子); 走(子); }
    }
  };
  走(路);
  return 见过;
};

// ---- 三、总图 ----
if (要总图) {
  console.log("工程地图 · " + hmyr们.length + " 份 HMYR 源码 · " + 套件.length + " 个套件");
  console.log("");
  console.log("一、谁被 import（左边是被用的，右边是用它的）");
  const 被用 = new Map();
  for (const [子, 依] of self依赖) {
    for (const d of 依) {
      if (!被用.has(d)) 被用.set(d, []);
      被用.get(d).push(path.basename(子));
    }
  }
  for (const [被, 用们] of [...被用].sort((a, b) => b[1].length - a[1].length)) {
    console.log("  " + 被.padEnd(24) + " ← " + 用们.join(" "));
  }
  const 孤立 = hmyr们.filter((f) => !被用.has(f));
  if (孤立.length) console.log("  （没人 import 的入口：" + 孤立.join(" ") + "）");
  console.log("");
  console.log("二、每个套件加载的 .hmyr（只列前三个；单个文件的完整答案用单文件模式查）");
  const 按载 = 套件.filter((s) => s.载入.size).sort((a, b) => b.载入.size - a.载入.size);
  for (const s of 按载) {
    const 载 = [...s.载入];
    console.log("  " + s.名.padEnd(18) + " " + String(载.length).padStart(2) + " 份  " + 载.slice(0, 3).join(" ") + (载.length > 3 ? " …" : ""));
  }
  console.log("");
  console.log("三、反过来：给一个文件，用 node tools/impact.mjs <文件> 看它会碰到哪些套件");
  process.exit(0);
}

if (!目标) {
  console.error("用法：node tools/impact.mjs <相对仓库根的路径> [--all]  或  --map");
  process.exit(2);
}
const 目标键 = 目标.split("\\").join("/");

// ---- 四、答一个文件 ----
const 是src = 目标键.startsWith("src/");
// src 模块也要走闭包：改 parser 会波及 import loader 的套件，而它们没直接 import parser。
const src链 = 是src ? new Set([目标键, ...src上游(目标键)]) : new Set();
const 目标链 = 是src ? new Set() : new Set([目标键, ...上游(目标键)]);

const 直接 = [];
const 间接 = [];
const 无关 = [];
for (const s of 套件) {
  const 载了本体 = s.载入.has(目标键);
  const 用src本体 = 是src && s.src.has(目标键);
  // 套件把这个文件当命令行参数 spawn 出去，也算直接依赖：它跑的就是那一步。
  const 用工具本体 = s.脚本们.has(目标键);
  const 载了 = [...目标链].some((f) => s.载入.has(f));
  const 用src间 = 是src && !用src本体 && [...src链].some((f) => s.src.has(f));
  if (载了本体 || 用src本体 || 用工具本体) 直接.push(s.名);
  else if (载了 || 用src间) 间接.push(s.名);
  else 无关.push(s.名);
}

if (要套件) {
  // 会进「字节产物」的那几类要另说：它们的扩散不走 import 图，而走
  // self/*.hmoca → runtime/*.hmoks → bootstrap/pack.hmtn → vm/pack_seed.h → 每一个
  // 跑 C 那台或读那份字节的套件。地图读的是源码里的路径与 import，这条边它看不见
  // （实测：改 self/body.hmoca，名单里没有 selfvmcompile，而那一套读的正是它的字节）。
  // 所以这几类一律报全量 —— 不是保险起见，是那条边真的绕过了它读的所有东西。
  const 进产物 = [
    /^self\/[^/]*\.hmoca$/,
    /^runtime\//,
    /^bootstrap\//,
    /^vm\/pack_seed\.h$/,
    /^vm\/hmyr\.c$/,
    /^bin\/hmyr\.mjs$/,
  ];
  if (进产物.some((r) => r.test(目标键))) {
    console.log(套件.map((s) => s.名).join(","));
    process.exit(0);
  }
  console.log([...直接, ...间接].join(","));
  process.exit(0);
}

const 列 = (arr) => (要全部 ? arr : arr.slice(0, 12));
const 略 = (arr) => (!要全部 && arr.length > 12 ? " …另有 " + (arr.length - 12) : "");

console.log("目标：" + 目标键 + (是src ? "（src 模块）" : ""));
if (!是src) {
  const 上 = 上游(目标键);
  console.log("它被这些 self 文件 import：" + ([...上].join(" ") || "（没有——它是入口）"));
}
console.log("");
console.log("直接  " + 直接.length + "  " + 列(直接).join(" ") + 略(直接));
console.log("间接  " + 间接.length + "  " + 列(间接).join(" ") + 略(间接));
console.log("无关  " + 无关.length + "  " + (要全部 ? 无关.join(" ") : "（不跑）"));
