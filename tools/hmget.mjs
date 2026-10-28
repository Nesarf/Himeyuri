#!/usr/bin/env node
// 取一个包：从一条显式来源搬进一个包根，并验它。
//
//   node tools/hmget.mjs --from <来源> --into <包根> <包名>
//
// 来源可以是本地目录，也可以是 file:/// 开头的 URL —— 这一版只做这两种，
// 因为判据必须是可复现的、不需要联网的。怎么从网上取是另一层的事
// （鉴权、重试、镜像），它会在这一层之上而不是在里面。见 design/HMGET.txt 第二节。
//
// 这个工具是**唯一**会去「外面拿东西」的地方。语言侧一行都不碰网络：
// 运行时不许偷下载那一条在 SPEC 2.4 里，而它靠的就是这条分工。
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const 用法 = "用法：node tools/hmget.mjs --from <来源> --into <包根> [--force] <包名>\n" +
  "      node tools/hmget.mjs --remove --into <包根> [--force] [--dry-run] <包名>";

const 参数 = process.argv.slice(2);
let 来源 = null, 包根 = null, 名 = null, 强制 = false, 要删 = false, 只说话 = false;
for (let i = 0; i < 参数.length; i++) {
  const a = 参数[i];
  if (a === "--from") 来源 = 参数[++i];
  else if (a === "--into") 包根 = 参数[++i];
  else if (a === "--force") 强制 = true;
  else if (a === "--remove") 要删 = true;
  else if (a === "--dry-run") 只说话 = true;
  else if (a.startsWith("--")) { console.error("不认识的参数：" + a); console.error(用法); process.exit(2); }
  else 名 = a;
}
if (!包根 || !名) { console.error(用法); process.exit(2); }
if (!要删 && !来源) { console.error(用法); process.exit(2); }

const 错 = (码, 话) => { console.error(码 + " " + 话); process.exit(1); };

// ---- 卸载 ------------------------------------------------------------
//
// 与「装」共用一套解析，但它是另一件事：装是「往一个地方放」，删是「从一堆东西里
// 拿走一个」—— 而后者要先问「还有谁需要它」。见 design/HMGET.txt 第五节。
if (要删) {
  const 根 = path.resolve(包根);
  const 目标 = path.join(根, 名);
  if (!fs.existsSync(目标) || !fs.statSync(目标).isDirectory()) {
    错("HMYR-E0311", "包根里没有这个包：'" + 名 + "'（找的是 " + 目标 + "）");
  }

  // 谁依赖它：扫包根下每一个包的清单。这一步不递归 —— 直接依赖就够拒绝，
  // 因为「间接依赖」在删掉直接依赖之后会自己浮上来报。
  const 靠它活 = [];
  for (const 项 of fs.readdirSync(根, { withFileTypes: true })) {
    if (!项.isDirectory() || 项.name === 名) continue;
    const 单 = path.join(根, 项.name, "hmyr.hmkit");
    if (!fs.existsSync(单)) continue;
    let 清 = null;
    try { 清 = JSON.parse(fs.readFileSync(单, "utf8")); } catch { continue; }
    const 依赖 = 清 && 清.依赖 && typeof 清.依赖 === "object" && !Array.isArray(清.依赖) ? 清.依赖 : {};
    if (名 in 依赖) 靠它活.push(项.name);
  }
  if (靠它活.length > 0 && !强制) {
    错("HMYR-E0312", "还有包依赖它：" + 靠它活.join("、") +
      "（卸载它们，或者加 --force 明知道会留下缺口也要删）");
  }

  // 包根那个空记号不动：它是「这里是一个包根」的记号，删掉它这个目录就不是包根了。
  const 记号 = path.join(根, "hmyr.hmkit");
  if (只说话) {
    console.log("会删掉：" + 目标);
    if (fs.existsSync(记号)) console.log("会留下：" + 记号 + "（包根的记号，不随包一起删）");
    if (靠它活.length > 0) console.log("而它被这些包依赖：" + 靠它活.join("、") + "（--force 才会照删）");
    console.log("这是 --dry-run，什么都没动。");
    process.exit(0);
  }
  fs.rmSync(目标, { recursive: true, force: true });
  console.log("已卸掉：" + 目标);
  if (fs.existsSync(记号)) console.log("包根还在：" + 记号);
  if (靠它活.length > 0) console.log("注意：这些包的依赖现在缺了 —— " + 靠它活.join("、"));
  process.exit(0);
}

// 来源 → 一个本地目录。file:// 与非 file 的两种写法都落到同一处：
// 这一层只做「把来源变成一个可以读的目录」，不做网络。
const 来源目录 = (() => {
  if (来源.startsWith("file://")) {
    try { return fileURLToPath(来源); }
    catch (e) { console.error("来源不是合法的 file URL：" + 来源); process.exit(2); }
  }
  if (/^https?:/i.test(来源)) {
    console.error("这一版不从网络取。见 design/HMGET.txt 第二节 ——");
    console.error("判据必须可复现，所以 http 会在这一层之上，而不是在里面。");
    process.exit(2);
  }
  return path.resolve(来源);
})();

const 算 = (路) => "sha256:" + createHash("sha256").update(fs.readFileSync(路)).digest("hex");

// 一、来源里有没有这个包，它的清单说得通不通。
const 源包 = path.join(来源目录, 名);
if (!fs.existsSync(源包) || !fs.statSync(源包).isDirectory()) {
  错("HMYR-E0308", "来源里没有这个包：'" + 名 + "'（找的是 " + 源包 + "）");
}
const 源清单路 = path.join(源包, "hmyr.hmkit");
const 源入口 = path.join(源包, "index.hmoca");
if (!fs.existsSync(源清单路)) 错("HMYR-E0308", "这个包没有 hmyr.hmkit：" + 源包);
if (!fs.existsSync(源入口)) 错("HMYR-E0308", "这个包没有 index.hmoca：" + 源包);

let 清单;
try { 清单 = JSON.parse(fs.readFileSync(源清单路, "utf8")); }
catch { 错("HMYR-E0304", "清单不是 JSON：" + 源清单路); }
if (!清单 || typeof 清单 !== "object" || Array.isArray(清单)) 错("HMYR-E0304", "清单不是一个对象");
if (清单.名字 !== 名) 错("HMYR-E0304", "清单说它是 '" + String(清单.名字) + "'，而目录叫 '" + 名 + "'");

// 二、入口文件的哈希要对得上清单说的那个。
const 真 = 算(源入口);
if (清单.哈希 !== 真) {
  错("HMYR-E0309", "入口文件的哈希与清单不符：清单说 " + String(清单.哈希).slice(0, 20) +
     "…，文件是 " + 真.slice(0, 20) + "…（来源被人动过？）");
}

// 三、目标：存在且内容不同就拒绝，除非 --force。
const 目标 = path.join(path.resolve(包根), 名);
if (fs.existsSync(目标)) {
  const 同 = fs.existsSync(path.join(目标, "index.hmoca")) &&
    fs.existsSync(path.join(目标, "hmyr.hmkit")) &&
    fs.readFileSync(path.join(目标, "index.hmoca")).equals(fs.readFileSync(源入口)) &&
    fs.readFileSync(path.join(目标, "hmyr.hmkit")).equals(fs.readFileSync(源清单路));
  if (同) {
    console.log("已经在了，而且内容相同：" + 目标);
    process.exit(0);
  }
  if (!强制) {
    错("HMYR-E0310", "目标已经存在且内容不同：" + 目标 + "（要覆盖就加 --force）");
  }
  fs.rmSync(目标, { recursive: true, force: true });
}

// 四、搬过去。包根不在就造它，并放一个空的 hmyr.hmkit —— 那是「这里是包根」的记号，
// 不是清单（清单在每个包自己的目录里）。
const 根 = path.resolve(包根);
fs.mkdirSync(根, { recursive: true });
const 根记号 = path.join(根, "hmyr.hmkit");
if (!fs.existsSync(根记号)) fs.writeFileSync(根记号, "[]", "utf8");
fs.mkdirSync(目标, { recursive: true });
fs.copyFileSync(源入口, path.join(目标, "index.hmoca"));
fs.copyFileSync(源清单路, path.join(目标, "hmyr.hmkit"));

// 五、依赖：缺哪个就报哪个，不递归取。
// 「一次装一棵树」要一个求解器，而这一页先要一条可验的路（design/HMGET.txt 第一节）。
const 依赖 = 清单.依赖 && typeof 清单.依赖 === "object" && !Array.isArray(清单.依赖) ? 清单.依赖 : {};
const 缺 = [];
for (const 依赖名 of Object.keys(依赖)) {
  const p = path.join(根, 依赖名, "hmyr.hmkit");
  if (!fs.existsSync(p)) { 缺.push(依赖名); continue; }
  let 它 = null;
  try { 它 = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
  if (它 && Number.isInteger(它.版本) && Number.isInteger(依赖[依赖名]) && 它.版本 < 依赖[依赖名]) {
    缺.push(依赖名 + "（要至少 " + 依赖[依赖名] + "，装的是 " + 它.版本 + "）");
  }
}
if (缺.length > 0) {
  错("HMYR-E0305", "这个包装好了，但它要的依赖还缺：" + 缺.join("、") +
    "（这一步不递归取，逐个再跑一次 hmget）");
}

// 六、验收：让 hmkit-check 说它过，而不是这个工具自己说。
console.log("装上：" + 目标);
console.log("清单哈希：" + 真.slice(0, 20) + "… 对得上");
if (Object.keys(依赖).length > 0) console.log("依赖：" + Object.keys(依赖).join("、") + " 都在");
console.log("验收：node tools/hmkit-check.mjs --all " + 根);
