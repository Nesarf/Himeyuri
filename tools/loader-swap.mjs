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
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SWAP = path.join(ROOT, "swap");
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
  候选.push({ 名, 脚本, 副本 });
}

console.log("候选套件（import 了宿主 loader 的）：" + 候选.length);
const 能换 = [];
const 换不动 = [];
const t0 = Date.now();
for (const c of 候选) {
  const r = spawnSync(process.execPath, [c.副本], { cwd: ROOT, encoding: "utf8", timeout: 300000 });
  if (r.status === 0) 能换.push(c.名);
  else {
    const 行 = (String(r.stdout || "") + String(r.stderr || "")).split("\n")
      .filter((l) => l.includes("不通过") || l.includes("Error") || l.includes("error")).slice(0, 1)[0] || ("exit " + r.status);
    换不动.push({ 名: c.名, 第一处: 行.trim().slice(0, 150) });
  }
}
console.log("");
console.log("能换  " + 能换.length + " / " + 候选.length);
console.log("换不动 " + 换不动.length);
for (const f of 换不动) console.log("  " + f.名.padEnd(22) + " " + f.第一处);
console.log("");
console.log("用时 " + Math.round((Date.now() - t0) / 1000) + " 秒");
fs.rmSync(SWAP, { recursive: true, force: true });
