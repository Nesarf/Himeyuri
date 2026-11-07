// 依赖环检查：宿主模块图里还有没有环。
//
// 为什么要有它（2026-11-07）：工程地图给出依赖边，但不报环 —— 而环是那种
// 「今天能跑、明天撞暂时性死区」的东西。那天实测发现全仓恰好有一个环：
// 被一百三十五个文件依赖的 src/loader.mjs 与 src/loader-self.mjs 互相 import。
// 成因是三个解析函数（resolveImport、找包根、读包清单）放在 loader.mjs 里，
// 而自举替身又需要它们；把它们搬去 src/resolve.mjs 之后环断了。
// 这一条现在是一条能随时重跑的判据，而不是那一次跑完就散了的结果。
//
// 口径：只扫 .mjs。.hmoca 的 import 由 HMYR 自己的加载器解析（还带包根与清单），
// 而这一问问的是宿主模块图 —— 那正是能让 ESM 撞上暂时性死区的那一类。
// 于是这里的边数比工程地图小，两个数不是同一件事。
//
// 用法：
//   node tools/cycles.mjs                 仓库根
//   node tools/cycles.mjs --root <目录>   换一棵树（套件用它造环，验检测器自己有牙）
//   node tools/cycles.mjs --json
// 有环时退出码 1。
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const 仓库根 = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const 参 = process.argv.slice(2);
const 取值 = (名) => {
  const i = 参.indexOf(名);
  return i >= 0 && i + 1 < 参.length ? 参[i + 1] : null;
};
const 根 = resolve(取值("--root") || 仓库根);
const 出JSON = 参.includes("--json");

// 这些目录里的东西不是这一问的对象：依赖装进来的、构建出来的、跑测试时写下的。
const 跳过 = new Set(["node_modules", ".git", "dist", ".cache", "build", "tmp"]);

function 扫(dir, 收) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (跳过.has(e.name)) continue;
      扫(join(dir, e.name), 收);
    } else if (e.name.endsWith(".mjs")) {
      收.push(join(dir, e.name));
    }
  }
}

const 文件 = [];
扫(根, 文件);

// 四种写法都要认：静态 import（带 from）、动态 import()、副作用式裸导入（import "x"）、
// 以及字符串路径的加载器（loadUnit）。第四支是造环的套件逼出来的 —— 少了它，
// 一个 `import "./甲.mjs"` 就把环藏起来了。
const 路径形 = /(?:from\s*|import\s*\(\s*|import\s*|loadUnit\s*\(\s*)["']([^"']+)["']/g;

function 落点(从, 说明) {
  if (!说明.startsWith(".")) return null;
  const 基 = resolve(dirname(从), 说明);
  for (const 候选 of [基, 基 + ".mjs", join(基, "index.mjs")]) {
    if (!existsSync(候选)) continue;
    try {
      if (statSync(候选).isFile()) return 候选;
    } catch {}
  }
  return null;
}

const 图 = new Map();
for (const f of 文件) {
  const 文 = readFileSync(f, "utf8");
  const 出 = new Set();
  let m;
  路径形.lastIndex = 0;
  while ((m = 路径形.exec(文)) !== null) {
    const 目标 = 落点(f, m[1]);
    if (目标 && 目标 !== f) 出.add(目标);
  }
  图.set(f, 出);
}

// Tarjan：一个分量里超过一个节点就是环。自环在上一步已经排除（目标等于自己）。
let 序 = 0;
const 序号 = new Map();
const 低 = new Map();
const 在栈 = new Set();
const 栈 = [];
const 环 = [];

function 深搜(v) {
  序号.set(v, 序);
  低.set(v, 序);
  序++;
  栈.push(v);
  在栈.add(v);
  for (const w of 图.get(v) ?? []) {
    if (!图.has(w)) continue;
    if (!序号.has(w)) {
      深搜(w);
      低.set(v, Math.min(低.get(v), 低.get(w)));
    } else if (在栈.has(w)) {
      低.set(v, Math.min(低.get(v), 序号.get(w)));
    }
  }
  if (低.get(v) === 序号.get(v)) {
    const 组 = [];
    let w;
    do {
      w = 栈.pop();
      在栈.delete(w);
      组.push(w);
    } while (w !== v);
    if (组.length > 1) 环.push(组);
  }
}

for (const f of 图.keys()) if (!序号.has(f)) 深搜(f);

const 相对 = (p) => {
  const r = p.startsWith(根) ? p.slice(根.length).replace(/^[\\/]/, "") : p;
  return r.split(/[\\/]/).join("/");
};

const 边数 = [...图.values()].reduce((a, s) => a + s.size, 0);

if (出JSON) {
  console.log(JSON.stringify({
    root: 根,
    files: 文件.length,
    edges: 边数,
    cycles: 环.map((组) => 组.map(相对).sort()),
  }, null, 2));
} else {
  console.log("依赖环检查");
  console.log("  root    " + 根);
  console.log("  files   " + 文件.length);
  console.log("  edges   " + 边数);
  console.log("  cycles  " + 环.length);
  for (const [i, 组] of 环.entries()) {
    console.log("");
    console.log("  环 " + (i + 1) + "（" + 组.length + " 个文件）");
    for (const f of 组.map(相对).sort()) console.log("    " + f);
  }
}

process.exit(环.length ? 1 : 0);
