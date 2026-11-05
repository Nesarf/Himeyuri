// self/ 里不该有逐字相同的函数体。
//
// 起因是一次真实的重复：self/ucd-case.hmoca 与 self/ucd-nfc.hmoca 各抄了一份完全
// 一样的 修剪（连循环变量的名字都一样）。那两份产物是拿这同一个函数去读 UCD 语料的，
// 所以「改一处忘另一处」的代价不是两个程序不一致，而是两个产物由两段不同的代码生成，
// 而它们又要求逐字节相同。2026-11-05 把它们收进 self/ucd-trim.hmoca。
//
// 这一份就是那件事的判据：扫 self/ 下每一份，把函数体归一化（去注释、去空行、去缩进）
// 之后比对。两处一模一样、且各有八行以上，就红。
//
// 为什么设「八行」这道门槛：短函数撞车是常态，不是问题 —— 一个 返回 真 的小工具
// 在每个文件里都可能出现，而把它抽出去反而更难读。八行以上的重复才是「一段真正的
// 逻辑被抄了两遍」。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 把一份源码拆成「函数名 + 函数体」。函数体从 函数 那一行开始，到行首单独的 } 为止。
const 拆函数 = (文) => {
  const 行们 = 文.split("\n");
  const 出 = [];
  let 起 = -1, 名 = "";
  for (let i = 0; i < 行们.length; i++) {
    const m = /^函数\s+([^\s(]+)\(/.exec(行们[i]);
    if (m && 起 < 0) { 起 = i; 名 = m[1]; continue; }
    if (起 >= 0 && 行们[i].replace(/\s+$/, "") === "}") {
      出.push({ 名, 体: 行们.slice(起, i + 1) });
      起 = -1;
    }
  }
  return 出;
};

// 归一化：去掉注释行、空行与每行两端的空白。
const 归一 = (行们) => 行们
  .map((l) => l.trim())
  .filter((l) => l !== "" && !l.startsWith("//"))
  .join("\n");

const 目录 = path.join(ROOT, "self");
const 份们 = fs.readdirSync(目录).filter((f) => f.endsWith(".hmoca")).sort();

console.log("一、self/ 下没有成段的重复实现");
{
  const 见 = new Map();   // 归一后的体 → [{名, 文件, 行数}]
  for (const f of 份们) {
    const 文 = fs.readFileSync(path.join(目录, f), "utf8");
    for (const 函 of 拆函数(文)) {
      const 体 = 归一(函.体);
      const 行数 = 体.split("\n").length;
      if (行数 < 8) continue;
      if (!见.has(体)) 见.set(体, []);
      见.get(体).push({ 名: 函.名, 文件: f, 行数 });
    }
  }
  const 重 = [];
  for (const [, 组] of 见) {
    if (组.length < 2) continue;
    // 只有同名才算「同一段逻辑被抄了两遍」—— 不同名的相同体可能只是恰好同形，
    // 而那种情况抽出来的收获不如风险大。
    const 名们 = new Set(组.map((x) => x.名));
    if (名们.size === 1) 重.push(组[0].名 + "（" + 组.map((x) => x.文件 + ":" + x.行数 + "行").join(" · ") + "）");
  }
  ok("扫了 " + 份们.length + " 份 self 源文件", 份们.length > 30, String(份们.length));
  // 2026-11-05 盘出来 13 组历史欠账（做完 十六进制值 之后剩下的）。它们的共同点是
  // 都在「同一套逻辑的两份拷贝」上：pack/run 那四组是加载器（拆行、拼路径、是包名字、
  // 找包根从），deflate/zip/tree/inflate 那七组是解压内核，ucd-case/ucd-nfc 的
  // 十六进制写法 是三份互不相同的实现 —— 它同时属于「同名不同体」。
  //
  // 抽它们要动解压与加载的关键路径，而这两条路各有自己的字节级判据（deflate 与
  // selfcontained）—— 值得单独一轮，不该顺手混在别的改动里。所以这一份现在守的是
  // 「别再长」：数量超过 13 就红。每做掉一组，把这个数改小。
  ok("重复组数不超过已记下的欠账（13）", 重.length <= 13, 重.length + " 组 · " + 重.join(" · "));
}

console.log("二、判据自己要被验一次");
{
  const 样 = [
    "函数 甲(a: Int) -> Int {",
    "  变 x = a",
    "  x = x + 1",
    "  x = x + 2",
    "  x = x + 3",
    "  x = x + 4",
    "  x = x + 5",
    "  x = x + 6",
    "  返回 x",
    "}",
  ].join("\n");
  const 拆 = 拆函数(样);
  ok("一段函数能被拆出来", 拆.length === 1 && 拆[0].名 === "甲", String(拆.length));
  ok("归一之后行数够门槛", 归一(拆[0].体).split("\n").length >= 8, String(归一(拆[0].体).split("\n").length));
  const 空 = 归一(["函数 乙() {", "  // 只有注释", "  返回 0", "}"]);
  ok("注释行会被去掉", !空.includes("//"), 空);
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
