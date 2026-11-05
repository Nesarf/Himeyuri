// self/ 里不该有从没被调用过的函数 —— 除非它有个写下来的理由。
//
// 起因（2026-11-05）：zip.hmoca 里那个 放位 一直调 倍，而 zip 里根本没有 倍 这个函数。
// 它从没被调用过，所以从没报错 —— 「没有这个名字」这件事只在真的往下走时才会浮出来。
// 于是一个问题：self/ 下还有多少个这样的函数？
//
// 扫了 753 个函数定义，十四个从没被调用。这一份守的就是那份清单：扫出来的集合必须与
// 白名单完全一致。多一个（有人新写了个没人用的函数）红，少一个（有人删了或开始用了）
// 也红 —— 后者是提醒把白名单那一行删掉，而不是留着一条过期的理由。
//
// 白名单每一条都写清「为什么留着」。写法验的那几位之前先说一句：白名单不是垃圾桶。
//
// 反向验过一次（2026-11-05）：往 self/ 临时塞一份只有 函数 没人调的死函数 的文件，
// 这一份红了并点名那个文件；删掉之后又全绿。所以它抓得住「新写了个没人用的函数」。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 每一条：名字 → 为什么留着。删掉一个就删一行；不写理由的那条本身就是要处理的欠账。
const 白名单 = {
  "有入口契约": "compile 里判断「这份契约有没有内容」（入口侧查 须 与 不变）。读过了：编契约那一步（编一批契约）直接编 契.须，没有经过它 —— 它是给「先判有没有、再决定查不查」那一步准备的，而那一步还没写。留着等它接上，不是漏用",
  "跑程序带函数与参": "eval 的一层封装：补一个空常量批，转给 跑程序带常量与参。读过了 —— 那个被转的函数自己在用（三处），而这一层没有调用者。它是给「调用方手上没有常量批」那种情形留的口，先留着",
  "去掉项": "eval 的一层封装：从空元组开始，转给 去掉项从。读过了 —— 去掉项从 自己在用（五处），这一层没有调用者。与 跑程序带函数与参 同一类的「方便口」",
  "只解析公开": "run 里带 公开 的只解析。读过了 —— 注释写着它的用途是「让探针从别的模块问一件事：把一段源码认下来会不会撑出几百层」，而今天没有探针这么问。对外接口，留着",
  "剩多少": "vm 里算一卷还剩多少字节。它故意不被 取一 与 取二 调用：那两处的注释写着理由（九万字节就是九万次，多一层调用是几百步，省下的那一层要乘九万）—— 这一条是「测得的性能决定的保留」，不是漏用",
};

const 目录 = path.join(ROOT, "self");
const 份们 = fs.readdirSync(目录).filter((f) => f.endsWith(".hmoca") && !f.includes("tmp")).sort();

// 定义：`函数 X(` 或 `公开 函数 X(`
const 定义们 = [];
for (const f of 份们) {
  const 行们 = fs.readFileSync(path.join(目录, f), "utf8").split("\n");
  for (let i = 0; i < 行们.length; i++) {
    const m = /^(?:公开\s+)?函数\s+([^\s(]+)\(/.exec(行们[i]);
    if (m) 定义们.push({ 名: m[1], 文件: f, 行: i + 1 });
  }
}

// 外部调用面：tools / test / conformance / examples 里出现「名(」或「"名"」都算用到。
const 外部 = [];
for (const d of ["tools", "test", "conformance", "examples"]) {
  const 根 = path.join(ROOT, d);
  if (!fs.existsSync(根)) continue;
  for (const e of fs.readdirSync(根, { recursive: true })) {
    const p = path.join(根, String(e));
    if (!/\.(mjs|js|hmoca)$/.test(p) || !fs.statSync(p).isFile()) continue;
    // 跳过这一份自己：它的白名单里写着那十四个名字，而「扫外部调用面」会把它们读成
    // 「有人用过」—— 判据自己给自己喂答案。第一版就是这么错的：扫出来 0 个死函数。
    if (path.resolve(p) === path.resolve(fileURLToPath(import.meta.url))) continue;
    外部.push(fs.readFileSync(p, "utf8"));
  }
}
const 外文 = 外部.join("\n");

console.log("一、扫出从没被调用的函数");
// 先把 self/ 的每一行读进内存：753 个定义逐个去读全部文件是 O(n^2) 次磁盘读，
// 第一版这样跑一次七十八秒。读一遍再扫，同一件事一秒。
const 行们全 = [];
for (const f of 份们) {
  for (const l of fs.readFileSync(path.join(目录, f), "utf8").split("\n")) 行们全.push(l);
}
const 死们 = [];
for (const d of 定义们) {
  let 用 = 0;
  const 定义正则 = new RegExp("^(?:公开\\s+)?函数\\s+" + d.名.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\(");
  for (const l of 行们全) {
    if (定义正则.test(l)) continue;
    if (l.includes(d.名 + "(")) 用++;
  }
  if (外文.includes(d.名 + "(") || 外文.includes('"' + d.名 + '"')) 用++;
  if (用 === 0) 死们.push(d);
}
console.log("    （定义 " + 定义们.length + " 个，没被调用的 " + 死们.length + " 个）");

const 实有 = 死们.map((d) => d.名).sort();
const 应有 = Object.keys(白名单).sort();

console.log("二、清单与白名单一致");
{
  const 多 = 实有.filter((n) => !应有.includes(n));
  const 少 = 应有.filter((n) => !实有.includes(n));
  ok("没有白名单之外的新死函数", 多.length === 0,
     多.map((n) => n + "（" + (死们.find((d) => d.名 === n) || {}).文件 + "）").join(" · "));
  ok("白名单里没有已经过期的那条", 少.length === 0, 少.join(" · "));
  ok("白名单每一条都写了理由", Object.values(白名单).every((r) => r && r.length >= 8), "");
}

console.log("三、判据自己要被验一次");
{
  // 造一份假源码：一个被调的函数、一个没人调的函数。
  const 假 = [
    "函数 有人用(x: Int) -> Int {",
    "  返回 x",
    "}",
    "函数 没人用(x: Int) -> Int {",
    "  返回 x * 2",
    "}",
    "函数 main() -> Int {",
    "  返回 有人用(1)",
    "}",
  ].join("\n");
  const 名们 = [...假.matchAll(/^(?:公开\s+)?函数\s+([^\s(]+)\(/gm)].map((m) => m[1]);
  const 判 = 名们.filter((n) => {
    const 行们 = 假.split("\n");
    let 用 = 0;
    for (const l of 行们) {
      if (new RegExp("^(?:公开\\s+)?函数\\s+" + n + "\\(").test(l)) continue;
      if (l.includes(n + "(")) 用++;
    }
    return 用 === 0;
  }).sort();
  ok("假源码里只认出一个没人用的", JSON.stringify(判) === JSON.stringify(["main", "没人用"]), JSON.stringify(判));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
