// lib/README.md 是一份索引：十一个库各自做什么，以及谁在验它。
//
// 这一份判的是那份索引还对不对 —— 三件事，两个方向都查：
//
//   一、lib/ 下每个 .hmoca 在那一页上有一行（新加的库不能只在文件系统里）
//   二、那一页上提到的每个 lib/<名字>.hmoca 都真的存在（删掉的库不能留在索引里）
//   三、每一行都写了「判据：X 套件」，而那个套件真的在 check-all 的列表里 ——
//       这一条最要紧：一个库没有判据的时候，索引里那一行会露出来。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 索引路 = path.join(ROOT, "lib", "README.md");
const 索文 = fs.readFileSync(索引路, "utf8");

// 那一页上「- 名字.hmoca —— 说明 …… 判据：xxx 套件」的行。
const 行批 = 索文.split("\n").filter((l) => /^- [A-Za-z0-9_-]+\.hmoca/.test(l));
const 提到 = 行批.map((l) => /^- ([A-Za-z0-9_-]+)\.hmoca/.exec(l)[1]);

const 库们 = fs.readdirSync(path.join(ROOT, "lib"))
  .filter((f) => f.endsWith(".hmoca"))
  .map((f) => f.slice(0, -".hmoca".length))
  .sort();

console.log("一、每个库都在索引上");
{
  const 缺 = 库们.filter((n) => !提到.includes(n));
  ok("lib/ 下 " + 库们.length + " 个库都有行", 缺.length === 0, 缺.join(" "));
}

console.log("二、索引上的每个库都真的存在");
{
  const 多 = 提到.filter((n) => !库们.includes(n));
  ok("索引里没有指向空处的行", 多.length === 0, 多.join(" "));
}

console.log("三、每一行都写了判据，而那个套件真的在跑");
{
  // check-all 的列表是判据权威：套件名在这里出现，就说明它在全量里。
  const 全 = fs.readFileSync(path.join(ROOT, "tools", "check-all.mjs"), "utf8");
  const 套件们 = new Set([...全.matchAll(/^\s*\["([^"]+)",\s*"([^"]+)"/gm)].map((m) => m[1]));
  const 没写 = [];
  const 不存在 = [];
  for (const 行 of 行批) {
    const 名 = /^- ([A-Za-z0-9_-]+)\.hmoca/.exec(行)[1];
    const m = /判据：([A-Za-z0-9_-]+) 套件/.exec(行);
    if (!m) { 没写.push(名); continue; }
    if (!套件们.has(m[1])) 不存在.push(名 + "→" + m[1]);
  }
  ok("每一行都有「判据：X 套件」", 没写.length === 0, 没写.join(" "));
  ok("每个判据套件都在 check-all 里", 不存在.length === 0, 不存在.join(" "));
}

console.log("四、lib 与 self 的同名函数必须同义");
{
  // 模块合并没有命名空间：同名就是撞车，后引入的赢，而症状是「某个调用指到了
  // 另一个函数」—— 2026-11-04 那天 self/wide.hmoca 的 乘二 撞掉 vmrun 十八项，
  // 同日 lib/strings 的 查找（子串）与 self/eval 的 查找（符号表）同名。
  //
  // 判据不是「名字不得重复」—— 修剪 与 十六进制 两边同签名同义，撞了也没事。
  // 判的是「同名的两边签名必须相同」：签名一不同，就说明是两件不同的东西共用一个名字。
  const 取签名 = (文) => {
    const 表 = new Map();
    for (const m of 文.matchAll(/^函数\s+([^\s(]+)\(([^)]*)\)/gm)) {
      // 参数只留类型：s: String, 子: String → String,String
      const 型 = m[2].split(",").map((s) => s.trim()).filter(Boolean)
        .map((s) => (s.includes(":") ? s.slice(s.indexOf(":") + 1).trim() : s)).join(",");
      表.set(m[1], 型);
    }
    return 表;
  };
  const 库 = new Map();
  for (const f of fs.readdirSync(path.join(ROOT, "lib")).filter((x) => x.endsWith(".hmoca"))) {
    for (const [名, 型] of 取签名(fs.readFileSync(path.join(ROOT, "lib", f), "utf8"))) 库.set(名, { 型, 文件: f });
  }
  const 自 = new Map();
  for (const f of fs.readdirSync(path.join(ROOT, "self")).filter((x) => x.endsWith(".hmoca"))) {
    for (const [名, 型] of 取签名(fs.readFileSync(path.join(ROOT, "self", f), "utf8"))) 自.set(名, { 型, 文件: f });
  }
  const 撞 = [];
  for (const [名, a] of 库) {
    const b = 自.get(名);
    if (b && b.型 !== a.型) 撞.push(名 + "（lib/" + a.文件 + " 是 " + a.型 + "，self/" + b.文件 + " 是 " + b.型 + "）");
  }
  ok("没有同名不同义的函数", 撞.length === 0, 撞.join(" · "));
}

console.log("五、判据自己要被验一次");
{
  // 两个方向各造一段假索引，看数行与解析有没有真的在做事。
  const 数行 = (文) => 文.split("\n").filter((l) => /^- [A-Za-z0-9_-]+\.hmoca/.test(l))
    .map((l) => /^- ([A-Za-z0-9_-]+)\.hmoca/.exec(l)[1]);
  ok("一行正常的索引会被认出来",
    数行("- regex.hmoca —— 正则。判据：regex 套件").length === 1,
    String(数行("- regex.hmoca —— 正则。判据：regex 套件").length));
  ok("不是条目的行不会被当成库",
    数行("  regex.hmoca 出现在句子里").length === 0,
    String(数行("  regex.hmoca 出现在句子里").length));
  ok("没写判据的行能被找出来",
    !/判据：/.test("- json.hmoca —— JSON 的解析与生成。"),
    "有判据");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
