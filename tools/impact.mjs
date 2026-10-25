// 工程地图：给一个文件，答「哪些套件会因此动」；或者给 --map，答整张图。
//
// 为什么要有它：每修一处就把十套一起拉（或者跑十几分钟的量具），是拿时间买「不用想影响面」。
// 而那些关系是静态可查的 —— 谁加载了 self/run.hmyr、self/*.hmyr 之间谁 import 谁、
// 哪个套件 import 了 src/eval.mjs。这张图本来就是写在那里的，只是没人把它拼起来。
//
// 用法：
//   node tools/impact.mjs self/body.hmyr       给一个文件，答它会碰到哪些套件
//   node tools/impact.mjs src/eval.mjs         对 src 模块同样答
//   node tools/impact.mjs --map               整张图：谁 import 谁、每个套件加载了什么
//   node tools/impact.mjs <文件> --all         不省略，把「无关」也列全
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 是源码 } from "./file-kind.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 参数 = process.argv.slice(2);
const 要全部 = 参数.includes("--all");
const 要总图 = 参数.includes("--map");
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
    else if (项.是源码(name)) hmyr们.push(子);
  }
};
走目录("");
hmyr们.sort();

const self依赖 = new Map(); // 文件（仓库相对路径）→ 它 import 的文件
for (const 路 of hmyr们) {
  const 源 = fs.readFileSync(path.join(ROOT, 路), "utf8");
  const 依赖 = [];
  const 本目录 = path.posix.dirname(路);
  for (const m of 源.matchAll(/^import\s+"([^"]+)"/gm)) {
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
  for (const m of 源.matchAll(/loadUnit\(path\.join\(ROOT,\s*"([^"]+)"/g)) 载入.add(m[1].split("\\").join("/"));
  for (const m of 源.matchAll(/path\.join\(ROOT,\s*"([^"]+\.hmyr)"/g)) 载入.add(m[1].split("\\").join("/"));
  const src们 = new Set([...源.matchAll(/from "\.\.\/src\/([^"]+)"/g)].map((m) => "src/" + m[1]));
  套件.push({ 名, 脚本, 载入, src: src们 });
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
  console.log("工程地图 · " + hmyr们.length + " 份 .hmyr · " + 套件.length + " 个套件");
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
  const 载了 = [...目标链].some((f) => s.载入.has(f));
  const 用src间 = 是src && !用src本体 && [...src链].some((f) => s.src.has(f));
  if (载了本体 || 用src本体) 直接.push(s.名);
  else if (载了 || 用src间) 间接.push(s.名);
  else 无关.push(s.名);
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
