// 体积核对：把「仓库内容」与「本地产物」分开算，并且给前者一个上限。
//
// 为什么这件事需要一套而不是一句 du：仓库里躺着几十兆语料（UCD、Unihan、NFC），
// 而 dist/ 与 node_modules/ 是能再生成的。混在一起算，一个数字既说明不了仓库有多重，
// 也说明不了磁盘被谁占了。
//
// 三组数字：
//   一、被 git 跟踪的（仓库内容）—— 这一组有上限，超了就是有问题
//   二、工作区里没被跟踪、但仍在仓库目录下的（临时产物、实验文件）
//   三、能再生成的（dist/、node_modules/）—— 只报数，不设限
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const MB = (n) => Math.round(n / 1048576 * 100) / 100;

// 一、被跟踪的那些：路径与大小都从 git 拿，不去走目录 —— 走目录会把 .git 与产物算进来。
const 列 = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "buffer", maxBuffer: 1 << 28 });
if (列.status !== 0) {
  console.log("  跳过  这里不是 git 仓库");
  process.exit(0);
}
const 路径们 = 列.stdout.toString("utf8").split("\0").filter(Boolean);
let 跟踪字节 = 0;
const 大头 = [];
for (const p of 路径们) {
  try {
    const st = fs.statSync(path.join(ROOT, p));
    跟踪字节 += st.size;
    if (st.size > 4 * 1048576) 大头.push([p, st.size]);
  } catch {
    // 跟踪着但不在盘上：那是别处的问题，不是体积的问题
  }
}
console.log("");
console.log("一、仓库内容（被 git 跟踪）");
console.log("  文件 " + 路径们.length + " 个 · " + MB(跟踪字节) + " MB");
大头.sort((a, b) => b[1] - a[1]);
for (const [p, n] of 大头.slice(0, 6)) console.log("    " + MB(n).toString().padStart(7) + " MB  " + p);
// 上限：语料占大头，而它们是这个项目的一部分。超过这个数说明有东西被误收了。
ok("仓库内容在两百兆以内", 跟踪字节 < 200 * 1048576, MB(跟踪字节) + " MB");
ok("没有单个文件超过五十兆", 大头.every(([, n]) => n < 50 * 1048576), JSON.stringify(大头.filter(([, n]) => n >= 50 * 1048576).map(([p]) => p)));

// 二、没被跟踪、但躺在仓库目录下的那些 —— 临时产物与实验文件该在这里现形。
const 未跟踪 = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
const 未跟踪们 = String(未跟踪.stdout || "").split("\n").filter((l) => l.startsWith("?? ")).map((l) => l.slice(3).trim());
let 未跟踪字节 = 0;
for (const p of 未跟踪们) {
  try { 未跟踪字节 += fs.statSync(path.join(ROOT, p)).size; } catch { /* 目录或已消失 */ }
}
console.log("");
console.log("二、没被跟踪、也不该进仓库的");
console.log("  文件 " + 未跟踪们.length + " 个 · " + MB(未跟踪字节) + " MB");
for (const p of 未跟踪们.slice(0, 8)) console.log("    " + p);
ok("没有被误留在仓库目录里的临时文件（超过五个就要看一眼）", 未跟踪们.length <= 8, String(未跟踪们.length));

// 三、能再生成的那些：只报数。
const 能重来 = [];
for (const 名 of ["dist", "node_modules", ".git"]) {
  const 路 = path.join(ROOT, 名);
  if (!fs.existsSync(路)) continue;
  let 计 = 0;
  const 走 = (dir) => {
    let 项 = [];
    try { 项 = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of 项) {
      const 全 = path.join(dir, e.name);
      if (e.isDirectory()) 走(全);
      else { try { 计 += fs.statSync(全).size; } catch { /* 读不到就不算 */ } }
    }
  };
  走(路);
  能重来.push([名, 计]);
}
console.log("");
console.log("三、能再生成的（不进仓库）");
for (const [名, n] of 能重来) console.log("  " + 名.padEnd(12) + MB(n) + " MB");
ok("dist 里只有一份归档（旧的该清掉）", (() => {
  const 路 = path.join(ROOT, "dist");
  if (!fs.existsSync(路)) return true;
  return fs.readdirSync(路).filter((f) => f.endsWith(".zip")).length <= 1;
})(), String(fs.existsSync(path.join(ROOT, "dist")) ? fs.readdirSync(path.join(ROOT, "dist")).filter((f) => f.endsWith(".zip")).length : 0));

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
