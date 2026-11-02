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
// http 那一侧没有目录列表，也不需要 —— 缺哪个文件就是 404，而那正好是 HMYR-載-013。
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

const 用法 = "用法：node tools/hmget.mjs --from <来源> --into <包根> [--with-deps] [--force] <包名>\n" +
  "      node tools/hmget.mjs --remove --into <包根> [--force] [--dry-run] <包名>";

const 参数 = process.argv.slice(2);
let 来源 = null, 包根 = null, 名 = null, 强制 = false, 要删 = false, 只说话 = false, 要依赖 = false;
for (let i = 0; i < 参数.length; i++) {
  const a = 参数[i];
  if (a === "--from") 来源 = 参数[++i];
  else if (a === "--into") 包根 = 参数[++i];
  else if (a === "--force") 强制 = true;
  else if (a === "--remove") 要删 = true;
  else if (a === "--dry-run") 只说话 = true;
  else if (a === "--with-deps") 要依赖 = true;
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

const 依赖表 = (清单) =>
  清单 && 清单.依赖 && typeof 清单.依赖 === "object" && !Array.isArray(清单.依赖) ? 清单.依赖 : {};

// ---- 取一个包 --------------------------------------------------------
//
// 「装一个」在 2026-11-02 抽成了单独一步：解析依赖链时要顺着链把每一个都装上，
// 而那段逻辑原来只写在 主 里一处，第二处用不上。抽出来之后，根包与它的依赖
// 走的是同一条路 —— 哈希、冲突、搬运那三件事只此一份。
const 取一个 = async (包名, 源, 根, 强制) => {
  const 源清单字节 = await 源.读(包名, "hmyr.hmkit");
  const 源入口字节 = await 源.读(包名, "index.hmoca");
  if (!源清单字节 && !源入口字节) {
    错("HMYR-載-013", "来源里没有这个包：'" + 包名 + "'（来源是 " + 源.说 + "）");
  }
  if (!源清单字节) 错("HMYR-載-013", "这个包没有 hmyr.hmkit：" + 源.说 + "/" + 包名);
  if (!源入口字节) 错("HMYR-載-013", "这个包没有 index.hmoca：" + 源.说 + "/" + 包名);

  let 清单;
  try { 清单 = JSON.parse(源清单字节.toString("utf8")); }
  catch { 错("HMYR-載-007", "清单不是 JSON：" + 源.说 + "/" + 包名 + "/hmyr.hmkit"); }
  if (!清单 || typeof 清单 !== "object" || Array.isArray(清单)) 错("HMYR-載-007", "清单不是一个对象");
  if (清单.名字 !== 包名) 错("HMYR-載-007", "清单说它是 '" + String(清单.名字) + "'，而目录叫 '" + 包名 + "'");

  const 真 = 算(源入口字节);
  if (清单.哈希 !== 真) {
    错("HMYR-載-014", "入口文件的哈希与清单不符：清单说 " + String(清单.哈希).slice(0, 20) +
      "…，文件是 " + 真.slice(0, 20) + "…（来源被人动过？）");
  }

  const 目标 = path.join(根, 包名);
  if (fs.existsSync(目标)) {
    const 旧入口 = path.join(目标, "index.hmoca");
    const 旧清单 = path.join(目标, "hmyr.hmkit");
    const 同 = fs.existsSync(旧入口) && fs.existsSync(旧清单) &&
      fs.readFileSync(旧入口).equals(源入口字节) &&
      fs.readFileSync(旧清单).equals(源清单字节);
    if (同) {
      console.log("已经在了，而且内容相同：" + 目标);
      return { 清单, 跳过: true, 真 };
    }
    if (!强制) {
      错("HMYR-載-015", "目标已经存在且内容不同：" + 目标 + "（要覆盖就加 --force）");
    }
    fs.rmSync(目标, { recursive: true, force: true });
  }

  // 包根不在就造它，并放一个空的 hmyr.hmkit —— 那是「这里是包根」的记号，
  // 不是清单（清单在每个包自己的目录里）。
  fs.mkdirSync(根, { recursive: true });
  const 根记号 = path.join(根, "hmyr.hmkit");
  if (!fs.existsSync(根记号)) fs.writeFileSync(根记号, "[]", "utf8");
  fs.mkdirSync(目标, { recursive: true });
  fs.writeFileSync(path.join(目标, "index.hmoca"), 源入口字节);
  fs.writeFileSync(path.join(目标, "hmyr.hmkit"), 源清单字节);
  return { 清单, 跳过: false, 真 };
};

// ---- 解析依赖链 ------------------------------------------------------
//
// 从根包出发，把整条链走一遍。三样东西一起交回：
//
//   序  后序 —— 依赖排在依赖者之前，于是它就是「该按什么顺序装」的答案，
//       而不是反过来再倒一遍。图论那半边在这里，装那半边在 取一个。
//   缺  缺什么、又是谁要的。只说「缺 X」不够：读者要的是「X 在哪一条链上」，
//       否则在一棵深树里他得自己走一遍才知道该先补谁。
//   环  一条环就够拒绝，而环上每一环的名字都要写出来 —— 只说「有环」等于让人
//       自己再找一遍，而找环正是这件事的全部难点。
//
// 已装的包优先于来源：这台机器上真正会被装载的是包根里的那一份，所以判断
// 「够不够」要对着它，而不是对着来源里更新的那个版本。
const 解析链 = async (根名, 源, 根) => {
  const 序 = [], 缺 = [], 环 = [];
  const 完成 = new Set(), 在途 = new Set(), 栈 = [];

  const 走 = async (包名, 要至少, 谁要) => {
    if (在途.has(包名)) {
      环.push(栈.slice(栈.indexOf(包名)).concat(包名).join(" 要 "));
      return;
    }
    if (完成.has(包名)) return;

    let 清单 = null, 已装 = false, 那话 = "装的是 ";
    const 已路 = path.join(根, 包名, "hmyr.hmkit");
    if (fs.existsSync(已路)) {
      try { 清单 = JSON.parse(fs.readFileSync(已路, "utf8")); 已装 = 清单 !== null; }
      catch { 清单 = null; }
    }
    if (!清单) {
      const 字节 = await 源.读(包名, "hmyr.hmkit");
      const 入口 = await 源.读(包名, "index.hmoca");
      if (!字节 || !入口) {
        缺.push("「" + 包名 + "」（" + 谁要 + " 要它，而来源里没有）");
        return;
      }
      try { 清单 = JSON.parse(字节.toString("utf8")); }
      catch {
        缺.push("「" + 包名 + "」（" + 谁要 + " 要它，来源里的清单不是 JSON）");
        return;
      }
      那话 = "来源里是 ";
    }
    if (Number.isInteger(要至少) && Number.isInteger(清单.版本) && 清单.版本 < 要至少) {
      缺.push("「" + 包名 + "」（" + 谁要 + " 要至少 " + 要至少 + "，" + 那话 + 清单.版本 + "）");
      return;
    }

    在途.add(包名); 栈.push(包名);
    for (const [子, 版] of Object.entries(依赖表(清单))) await 走(子, 版, 包名);
    在途.delete(包名); 栈.pop();
    完成.add(包名);
    序.push({ 名: 包名, 清单, 已装 });
  };

  await 走(根名, undefined, "（根包）");
  return { 序, 缺, 环 };
};

const 主 = async () => {
  const 源 = 造来源(来源);
  const 根 = path.resolve(包根);

  // 一、装根包。哈希、清单、冲突与搬运都在 取一个 里，它自己的依赖走同一条路。
  const 根结 = await 取一个(名, 源, 根, 强制);

  // 二、依赖：从根包出发把整条链走一遍。
  // 这一遍不看「根包里那一栏」，看的是整条链 —— 甲要乙、乙要丙时，丙缺了
  // 也要在装甲这一步说出来，而不是等乙自己装的那一刻。
  const { 序, 缺, 环 } = await 解析链(名, 源, 根);

  // 环先判：它比「缺什么」更靠前，因为环上的缺口永远补不齐。
  if (环.length > 0) {
    错("HMYR-載-024", "依赖成环，一次都取不了：" + 环.join("；"));
  }
  // 缺有两种，而它们该分开说：一种是「包里没有、但来源里有」，--with-deps 补得上；
  // 另一种是「来源里也没有」或者「版本不够」，取也取不来。默认模式下两种都算缺，
  // 只是说法不同 —— 读者要能一眼看出哪一种加个开关就解决，哪一种得自己动手。
  if (!要依赖) {
    const 说 = [];
    for (const 项 of 序) if (!项.已装) 说.push("「" + 项.名 + "」（还没装）");
    for (const 句 of 缺) 说.push(句);
    if (说.length > 0) {
      错("HMYR-載-009", "这个包装好了，但它要的依赖还缺：" + 说.join("、") +
        "（加 --with-deps 让这一步顺着来源把整条链取来）");
    }
  }
  if (要依赖 && 缺.length > 0) {
    错("HMYR-載-009", "这条链上有取不来的包（来源里没有，或者版本不够）：" + 缺.join("、"));
  }

  // 三、--with-deps：按后序把缺的装上。后序就是「依赖在前」，于是走完这一趟，
  // 每个被装上的包在它自己装的那一刻，依赖都已经在了 —— 这一条不必再验，
  // 因为顺序本来就是从这张图上读出来的。
  const 要补 = 序.filter((x) => !x.已装);
  const 补过 = [];
  for (const 项 of 要补) {
    const 结 = await 取一个(项.名, 源, 根, 强制);
    if (!结.跳过) 补过.push(项.名);
  }

  // 四、报告与验收。验收交给 hmkit-check，不由这个工具自己说。
  console.log("装上：" + path.join(根, 名));
  console.log("来源：" + 源.类 + " · " + 源.说);
  console.log("清单哈希：" + 根结.真.slice(0, 20) + "… 对得上");
  const 赖 = Object.keys(依赖表(根结.清单));
  if (补过.length > 0) console.log("顺着链取来（依赖在前）：" + 补过.join("、"));
  if (赖.length > 0) console.log("依赖：" + 赖.join("、") + (要补.length > 0 ? "，整条链都齐了" : " 都在"));
  console.log("验收：node tools/hmkit-check.mjs --all " + 根);
};

主().catch((e) => { console.error("HMYR-載-022 意外：" + (e && e.message ? e.message : String(e))); process.exit(1); });
