#!/usr/bin/env node
// 取一个包：从一条显式来源搬进一个包根，并验它。
//
//   node tools/hmget.mjs --from <来源> --into <包根> <包名>
//   node tools/hmget.mjs --remove --into <包根> [--dry-run] [--force] <包名>
//
// 来源三种写法，都落到同一个接口（见下面 造来源）：
//
//   本地目录   D:/我的包库
//   file://    file:///D:/我的包库
//   http(s):// http://127.0.0.1:8080/包库
//
// 三种都只读两个文件：<来源>/<包名>/hmyr.hmkit 与 <来源>/<包名>/index.hmoca。
// http 那一侧没有目录列表，也不需要 —— 缺哪个文件就是 404，而那正好是 E0308。
//
// 这一版仍然**不做**鉴权、不做重试、不做镜像：那些是这一层之上的事，
// 而「判据必须可复现」这一条不因为多了 http 就放松 —— 判据用本机起的服务器，
// 不联网。见 design/HMGET.txt 第二节。
//
// 这个工具是全仓唯一会去外面拿东西的地方。语言侧一行都不碰网络：
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
// 拿走一个」—— 而后者要先问「还有谁需要它」。见 design/HMGET.txt 第八节。
if (要删) {
  const 根 = path.resolve(包根);
  const 目标 = path.join(根, 名);
  if (!fs.existsSync(目标) || !fs.statSync(目标).isDirectory()) {
    错("HMYR-載-017", "包根里没有这个包：'" + 名 + "'（找的是 " + 目标 + "）");
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
    错("HMYR-載-019", "还有包依赖它：" + 靠它活.join("、") +
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

// ---- 来源 ------------------------------------------------------------
//
// 一个来源只回答一个问题：「<包>/<文件> 的字节是什么」，交回 Buffer 或 null。
// 三种写法各一份实现，而它们之下的一切（哈希校验、清单检查、搬运、依赖检查）
// 完全一样 —— 那一层不该知道字节是从磁盘来的还是从端口来的。
const 造来源 = (说明) => {
  if (/^https?:/i.test(说明)) {
    const 底 = 说明.replace(/\/+$/, "");
    return {
      类: "http",
      说: 底,
      读: async (包, 文) => {
        const 址 = 底 + "/" + encodeURIComponent(包) + "/" + 文;
        // 401/403 与 404 在这一层不区分：对「这个包在不在来源里」这个问题，
        // 两种答案都是「拿不到」。鉴权是上面一层的事。
        try {
          const r = await fetch(址);
          if (!r.ok) return null;
          return Buffer.from(await r.arrayBuffer());
        } catch (e) {
          return null;
        }
      },
    };
  }
  const 目录 = 说明.startsWith("file://") ? (() => {
    try { return fileURLToPath(说明); }
    catch { 错("HMYR-載-013", "来源不是合法的 file URL：" + 说明); }
  })() : path.resolve(说明);
  return {
    类: "文件",
    说: 目录,
    读: async (包, 文) => {
      const p = path.join(目录, 包, 文);
      return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p) : null;
    },
  };
};

const 算 = (buf) => "sha256:" + createHash("sha256").update(buf).digest("hex");

const 主 = async () => {
  const 源 = 造来源(来源);

  // 一、来源里有没有这个包，它的清单说得通不通。
  // 「包在不在」在这一层就是「两个文件都拿得到吗」—— 目录与端口用同一个判据。
  const 源清单字节 = await 源.读(名, "hmyr.hmkit");
  const 源入口字节 = await 源.读(名, "index.hmoca");
  if (!源清单字节 && !源入口字节) {
    错("HMYR-載-013", "来源里没有这个包：'" + 名 + "'（来源是 " + 源.说 + "）");
  }
  if (!源清单字节) 错("HMYR-載-013", "这个包没有 hmyr.hmkit：" + 源.说 + "/" + 名);
  if (!源入口字节) 错("HMYR-載-013", "这个包没有 index.hmoca：" + 源.说 + "/" + 名);

  let 清单;
  try { 清单 = JSON.parse(源清单字节.toString("utf8")); }
  catch { 错("HMYR-載-007", "清单不是 JSON：" + 源.说 + "/" + 名 + "/hmyr.hmkit"); }
  if (!清单 || typeof 清单 !== "object" || Array.isArray(清单)) 错("HMYR-載-007", "清单不是一个对象");
  if (清单.名字 !== 名) 错("HMYR-載-007", "清单说它是 '" + String(清单.名字) + "'，而目录叫 '" + 名 + "'");

  // 二、入口文件的哈希要对得上清单说的那个。
  const 真 = 算(源入口字节);
  if (清单.哈希 !== 真) {
    错("HMYR-載-014", "入口文件的哈希与清单不符：清单说 " + String(清单.哈希).slice(0, 20) +
      "…，文件是 " + 真.slice(0, 20) + "…（来源被人动过？）");
  }

  // 三、目标：存在且内容不同就拒绝，除非 --force。
  const 根 = path.resolve(包根);
  const 目标 = path.join(根, 名);
  if (fs.existsSync(目标)) {
    const 旧入口 = path.join(目标, "index.hmoca");
    const 旧清单 = path.join(目标, "hmyr.hmkit");
    const 同 = fs.existsSync(旧入口) && fs.existsSync(旧清单) &&
      fs.readFileSync(旧入口).equals(源入口字节) &&
      fs.readFileSync(旧清单).equals(源清单字节);
    if (同) {
      console.log("已经在了，而且内容相同：" + 目标);
      return;
    }
    if (!强制) {
      错("HMYR-載-015", "目标已经存在且内容不同：" + 目标 + "（要覆盖就加 --force）");
    }
    fs.rmSync(目标, { recursive: true, force: true });
  }

  // 四、搬过去。包根不在就造它，并放一个空的 hmyr.hmkit —— 那是「这里是包根」的记号，
  // 不是清单（清单在每个包自己的目录里）。
  fs.mkdirSync(根, { recursive: true });
  const 根记号 = path.join(根, "hmyr.hmkit");
  if (!fs.existsSync(根记号)) fs.writeFileSync(根记号, "[]", "utf8");
  fs.mkdirSync(目标, { recursive: true });
  fs.writeFileSync(path.join(目标, "index.hmoca"), 源入口字节);
  fs.writeFileSync(path.join(目标, "hmyr.hmkit"), 源清单字节);

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
    错("HMYR-載-009", "这个包装好了，但它要的依赖还缺：" + 缺.join("、") +
      "（这一步不递归取，逐个再跑一次 hmget）");
  }

  // 六、验收：让 hmkit-check 说它过，而不是这个工具自己说。
  console.log("装上：" + 目标);
  console.log("来源：" + 源.类 + " · " + 源.说);
  console.log("清单哈希：" + 真.slice(0, 20) + "… 对得上");
  if (Object.keys(依赖).length > 0) console.log("依赖：" + Object.keys(依赖).join("、") + " 都在");
  console.log("验收：node tools/hmkit-check.mjs --all " + 根);
};

主().catch((e) => { console.error("HMYR-載-022 意外：" + (e && e.message ? e.message : String(e))); process.exit(1); });
