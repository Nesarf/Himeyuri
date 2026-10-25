// src/ 里每个模块的角色：在运行时闭包里、只在验收里用、还是没人引。
//
// 为什么需要这张表：抬自举度最直接的动作是「删掉被 HMYR 版替代的那一份 JS」，
// 而删除之前要知道两件事 —— 它是否在跑程序的路上，以及删了会红多少套。
// 这一份答第一件（第二件要真删一次才知道）。
//
// 判据：
//   ・入口是 tools/runtime-path.mjs 报的那五个（启动器、只当命令用的那一份、三份执行器）
//   ・只跟 .mjs 的相对 import，不跟 .hmyr（那是另一侧，闭包里本来就不该有）
//   ・「在运行时闭包」的意思是：从某个入口顺着 import 走得到它
//
// 用法：node tools/src-roles.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 入口 = ["bin/hmyr.mjs", "bin/run-eval.mjs", "src/eval.mjs", "src/minimal-eval.mjs", "src/vm.mjs"];

const 读依赖 = (相对) => {
  const 绝对 = path.join(ROOT, 相对);
  if (!fs.existsSync(绝对)) return [];
  const 源 = fs.readFileSync(绝对, "utf8");
  const 出 = [];
  const 加 = (指) => {
    if (!指.startsWith(".")) return;
    const 落 = path.relative(ROOT, path.resolve(path.dirname(绝对), 指)).replace(/\\/g, "/");
    if (!落.startsWith("..")) 出.push(落);
  };
  for (const m of 源.matchAll(/from\s+["']([^"']+)["']/g)) 加(m[1]);
  // 早一版只认 import 语句，于是 thr-worker.mjs 与 thr-worker-vm.mjs 被报成「没人引用」——
  // 而它们是 worker 的入口，用 new URL(...) 交给 node:worker_threads 的。
  // 判据漏了一种引用方式，报表就会说「可以删」。
  for (const m of 源.matchAll(/new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) 加(m[1]);
  return 出;
};

const 闭包 = new Set();
const 走 = (文件) => {
  if (闭包.has(文件)) return;
  闭包.add(文件);
  for (const d of 读依赖(文件)) 走(d);
};
for (const e of 入口) 走(e);

const 全部src = fs.readdirSync(path.join(ROOT, "src")).filter((f) => f.endsWith(".mjs")).map((f) => "src/" + f);
const 引用者 = new Map();
for (const d of ["bin", "src", "tools", "test"]) {
  const 目录 = path.join(ROOT, d);
  if (!fs.existsSync(目录)) continue;
  for (const f of fs.readdirSync(目录)) {
    if (!f.endsWith(".mjs")) continue;
    const 我 = d + "/" + f;
    for (const dep of 读依赖(我)) {
      if (!引用者.has(dep)) 引用者.set(dep, new Set());
      引用者.get(dep).add(我);
    }
  }
}

const 行数 = (相对) => {
  try { return fs.readFileSync(path.join(ROOT, 相对), "utf8").split("\n").length; } catch { return 0; }
};

const 运行时 = [], 只验收 = [], 没人 = [];
for (const f of 全部src) {
  const 们 = [...(引用者.get(f) || [])];
  if (闭包.has(f)) 运行时.push(f);
  else if (们.length) 只验收.push(f);
  else 没人.push(f);
}

const 报 = (标题, 表) => {
  const 总 = 表.reduce((s, f) => s + 行数(f), 0);
  console.log(标题 + "：" + 表.length + " 个，合计 " + 总 + " 行");
  for (const f of 表.sort()) console.log("  " + f.padEnd(26) + String(行数(f)).padStart(5) + " 行");
  return 总;
};

console.log("src/ 的角色（入口：" + 入口.join(" · ") + "）");
console.log("");
const 甲 = 报("在运行时闭包里（删了会断跑程序这条路）", 运行时);
console.log("");
const 乙 = 报("只在验收与量具里用（删了只会红套件）", 只验收);
console.log("");
const 丙 = 报("没人引用", 没人);
console.log("");
console.log("可抬的空间：" + 乙 + " 行 + " + 丙 + " 行 = " + (乙 + 丙) + " 行（占 src 的 " +
  Math.round(((乙 + 丙) / (甲 + 乙 + 丙 || 1)) * 100) + "%）");
