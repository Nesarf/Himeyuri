// 量一件事：把宿主 loader 换成 HMYR 自己的加载器之后，多少套还绿。
//
// 做法是最笨也最干净的一种 —— 不改 src，也不加开关：把每个套件复制一份到 swap/，
// 只把 `../src/loader.mjs` 那一行换成桥，然后照原样跑。绿的就是「换得动」，
// 红的每一处都是真差异（或者一处「这套本来就依赖宿主 ast 的具体形状」）。
//
// 跑这一件的时候，不要在同一个仓库里做会碰 swap/ 的事。
//
// 这是被咬出来的：有一趟量具跑着，我同时在改桥、改 chain.hmyr、重建 run.hmyrb，
// 还反复 Remove-Item swap/ —— 它量出来的 49/95 比上一趟的 60/95 还低，而红名单里
// 出现了几个刚修绿的套件。那个数量的不是代码，是一个被我自己搅乱的现场。
//
// 工作台在仓库里，跑到一半就能被人搬走 —— 所以要么让它独占这段时间，要么给它另找一个家。
//
// 为什么放 swap/ 而不是临时目录：套件里的 ROOT 是「脚本所在目录的上一级」，
// swap/ 与 test/、tools/ 同级，于是所有相对路径（../src/xxx、../self/xxx）都不必改。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SWAP = path.join(ROOT, "swap");

// 整机水位（与 tools/starting-count.mjs 同一套口径）：可用内存低于这个数就先等一等，
// 等不到就停手并把这件事说出来。
//
// 为什么这一件也需要它（2026-11-02）：一轮全量跑到 inflate 那套时 exit null —— 那套
// 单独跑 21 项全过、53 秒，而串行跑到它的时候进程被杀掉了。这一件原来没有任何水位，
// 也没有把「被杀掉」与「这套真的红」分开报，于是两份读数差了一套（105 与 106），
// 而差的那一套其实是环境。
const 水位MB = Number((process.argv.find((a) => a.startsWith("--mem=")) || "").slice(6)) || 1500;
const 水位最多等秒 = Number((process.argv.find((a) => a.startsWith("--memWait=")) || "").slice(10)) || 120;

function 等水位() {
  const 限 = Date.now() + 水位最多等秒 * 1000;
  while (os.freemem() / (1024 * 1024) < 水位MB) {
    if (Date.now() > 限) return false;
    console.log("  （可用内存低于 " + 水位MB + " MB，先等一等）");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
  }
  return true;
}

const 清单 = fs.readFileSync(path.join(ROOT, "tools/suite-list.txt"), "utf8")
  .split("\n").map((l) => l.trim()).filter(Boolean)
  .map((l) => l.split("\t")).filter((p) => p.length >= 2);

fs.rmSync(SWAP, { recursive: true, force: true });
fs.mkdirSync(SWAP, { recursive: true });

const 候选 = [];
for (const [名, 脚本] of 清单) {
  const 源路 = path.join(ROOT, 脚本);
  if (!fs.existsSync(源路)) continue;
  const 源 = fs.readFileSync(源路, "utf8");
  if (!源.includes('from "../src/loader.mjs"')) continue;
  const 新 = 源.replaceAll('from "../src/loader.mjs"', 'from "../tools/self-bridge.mjs"');
  const 副本 = path.join(SWAP, path.basename(脚本));
  fs.writeFileSync(副本, 新, "utf8");
  // 套件可能还 import 同目录的辅助文件（./file-kind.mjs、./self-bridge.mjs）——
  // 副本在 swap/ 里，那些相对路径就断了：ERR_MODULE_NOT_FOUND（2026-11-02 实测，
  // selfload 与 selfbridge 两套就是这样红的）。一起搬过去。
  for (const 引 of 新.matchAll(/from "\.\/([^"]+)"/g)) {
    const 辅 = path.join(path.dirname(源路), 引[1]);
    if (fs.existsSync(辅)) fs.copyFileSync(辅, path.join(SWAP, 引[1]));
  }
  候选.push({ 名, 脚本, 副本 });
}

// --only=名,名 ：只跑这几套。量全量要十分钟，而查一处改动只要几套（2026-11-02）。
const 只参数 = process.argv.find((a) => a.startsWith("--only="));
const 只要 = 只参数 ? new Set(只参数.slice(7).split(",").map((s) => s.trim()).filter(Boolean)) : null;
const 要跑 = 只要 ? 候选.filter((c) => 只要.has(c.名)) : 候选;

console.log("候选套件（import 了宿主 loader 的）：" + 要跑.length);
const 能换 = [];
const 换不动 = [];
const 被杀 = [];
const t0 = Date.now();
for (const c of 要跑) {
  if (!等水位()) {
    console.log("  可用内存一直低于 " + 水位MB + " MB，停在这里 —— 后面的套件这一次没量。");
    break;
  }
  const r = spawnSync(process.execPath, [c.副本], { cwd: ROOT, encoding: "utf8", timeout: 300000 });
  if (r.status === 0) 能换.push(c.名);
  else if (r.status === null) {
    // status 是 null 说明进程被信号杀掉（超时、内存、或者别的外力），而不是套件自己
    // 报红 —— 这两件事必须分开报，否则读数会把环境算成代码（2026-11-02：inflate
    // 在串行里被杀掉，而它单独跑 21 项全过）。
    被杀.push({ 名: c.名, 信号: r.signal || "未知" });
  } else {
    const 行 = (String(r.stdout || "") + String(r.stderr || "")).split("\n")
      .filter((l) => l.includes("不通过") || l.includes("Error") || l.includes("error")).slice(0, 1)[0] || ("exit " + r.status);
    换不动.push({ 名: c.名, 第一处: 行.trim().slice(0, 150) });
  }
}
console.log("");
console.log("能换  " + 能换.length + " / " + 候选.length);
console.log("换不动 " + 换不动.length);
for (const f of 换不动) console.log("  " + f.名.padEnd(22) + " " + f.第一处);
if (被杀.length) {
  console.log("被杀  " + 被杀.length + "（不是代码红，是环境：超时或内存）");
  for (const f of 被杀) console.log("  " + f.名.padEnd(22) + " 信号 " + f.信号);
}
console.log("");
console.log("用时 " + Math.round((Date.now() - t0) / 1000) + " 秒");
// --keep：跑完不删 swap/ —— 查「副本是不是旧的」时要用（2026-11-02）。
if (!process.argv.includes("--keep")) fs.rmSync(SWAP, { recursive: true, force: true });
else console.log("swap/ 留着（--keep）");
