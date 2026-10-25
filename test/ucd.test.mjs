// Unicode 数据：五十二兆的原始表，加上两张从它生成的东西。
//
// 这一套钉三件事：
//   一、生成器跑得动，摘要里的规模与位置抽查都说得对（U+0041 在 Basic Latin、
//       U+3042 在 Hiragana、U+4E2D 在 CJK Unified Ideographs 与 Han 脚本）。
//   二、生成的 blocks.hmyr 是一份 HMYR 源码：它能被读进、被求值、并给出同样的答案。
//   三、它为什么用嵌套 if 而不是复合条件 —— 那一条由自举那一层的 parser 决定，
//       而这一份把它写成一条断言，免得下次有人「顺手优化」成 && 之后在自举那条路上崩。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 主, 块名, 脚本名, 块表 } from "../tools/ucd.mjs";
import { loadUnit } from "../src/loader.mjs";
import { 最小运行 } from "../src/minimal-eval.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

console.log("一、生成器跑得动，摘要说得对");
{
  const 摘要 = 主();
  ok("字符数据四万行以上", 摘要.字符数据行数 > 40000, String(摘要.字符数据行数));
  ok("块三百个以上", 摘要.块数 > 300, String(摘要.块数));
  ok("脚本一百个以上", 摘要.脚本数 > 100, String(摘要.脚本数));

  const 查 = (cp) => 摘要.抽查.find((x) => x.码点 === cp);
  ok("U+0041 是 LATIN CAPITAL LETTER A，类别 Lu", 查("U+0041")?.名字 === "LATIN CAPITAL LETTER A" && 查("U+0041")?.类别 === "Lu");
  ok("U+0041 在 Basic Latin，脚本 Latin", 查("U+0041")?.块 === "Basic Latin" && 查("U+0041")?.脚本 === "Latin");
  ok("U+3042 是 HIRAGANA LETTER A", 查("U+3042")?.名字 === "HIRAGANA LETTER A");
  ok("U+3042 在 Hiragana", 查("U+3042")?.块 === "Hiragana");
  ok("U+4E2D 在 CJK Unified Ideographs，脚本 Han", 查("U+4E2D")?.块 === "CJK Unified Ideographs" && 查("U+4E2D")?.脚本 === "Han");
  ok("U+1F600 在 Emoticons", 查("U+1F600")?.块 === "Emoticons");
  ok("U+10FFFF 落在补充私用区，不是 No_Block", 查("U+10FFFF")?.块 === "Supplementary Private Use Area-B");
  ok("块名函数对没覆盖的地方给 No_Block", 块名(0x10FFFF + 1) === "No_Block");
  ok("脚本函数对没覆盖的地方给 Unknown", 脚本名(0x10FFFF + 1) === "Unknown");
}

console.log("二、生成出来的表是一份 HMYR 源码，能被读进并求值");
{
  const 表 = fs.readFileSync(path.join(ROOT, "runtime/ucd/blocks.hmoca"), "utf8");
  // 判据只看代码行：块表每一行都拖着一段注释，而注释里写着「为什么不用复合条件」，
  // 那句话本身就带着那两个字面。第一版没有剥注释，于是断言抓到的正是它自己。
  const 代码 = 表.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  // 还要剥掉字符串字面量：块名里真有 "Greek and Coptic" 这种带 and 的名字，
  // 而那是数据，不是运算符。第一版只剥了注释，于是断言抓到了几个块名。
  const 去串 = 代码.replace(/"[^"]*"/g, '""');
  ok("表里有一个 块名 函数", 表.includes("fn 块名(码点: Int) -> String"));
  ok("代码里没有复合条件（自举那一层读不进那两个写法）", !去串.includes("&&") && !去串.includes(" and "));
  ok("表的行数与块数同量级", 表.split("\n").length > 1000, String(表.split("\n").length));

  const 程序 = path.join(ROOT, "conformance/ucd-blocks.hmoca");
  const 层 = loadUnit(程序);
  ok("conformance/ucd-blocks.hmyr 读得进", 层.ok, JSON.stringify(层.diagnostics.errors.slice(0, 2).map((e) => e.code)));
  if (层.ok) {
    let 码 = null;
    try {
      const rt = 最小运行(层, { write: () => {}, capabilities: { file: { read: () => { throw new Error("不该读文件"); }, exists: () => false } } });
      码 = rt.callFunction(rt.functions.get("main"), [], null);
    } catch (e) { 码 = "错:" + (e.code || e.message); }
    ok("三个块名都查对了（返回 0）", 码 === 0, String(码));
  }
}

console.log("三、原始数据真的在仓库里");
{
  const 目录 = path.join(ROOT, "data/ucd");
  const 文件 = fs.readdirSync(目录);
  ok("UnicodeData.txt 在", 文件.includes("UnicodeData.txt"));
  ok("Blocks.txt 在", 文件.includes("Blocks.txt"));
  ok("Unihan 那一组在", fs.existsSync(path.join(目录, "Unihan")) && fs.readdirSync(path.join(目录, "Unihan")).length >= 8);
  let 字节 = 0;
  const 走 = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const q = path.join(p, e.name);
      if (e.isDirectory()) 走(q); else 字节 += fs.statSync(q).size;
    }
  };
  走(目录);
  ok("原始数据五十兆以上", 字节 > 50 * 1024 * 1024, (字节 / 1024 / 1024).toFixed(2) + " MB");
  ok("块表读出来的块数超过三百", 块表().length > 300, String(块表().length));
}

console.log("四、全码点表：一百一十一个码点各一行");
{
  const 文件 = path.join(ROOT, "runtime/ucd/codepoints.txt");
  ok("表在", fs.existsSync(文件));
  const 大小 = fs.statSync(文件).size;
  ok("四十兆以上", 大小 > 40 * 1024 * 1024, (大小 / 1024 / 1024).toFixed(2) + " MB");

  const 文 = fs.readFileSync(文件, "utf8");
  // 按行号取一行，不整份 split。四十四兆切下去是一百一十多万个短字符串，
  // 光对象头就要几百兆 —— 而这里只用得到四行。这一套以前吃掉三百多兆，
  // 全量跑起来像内存被提满，根子就在这一行 split。
  const 取行 = (号) => {
    let 起 = 0;
    for (let i = 0; i < 号; i++) {
      const 下 = 文.indexOf("\n", 起);
      if (下 < 0) return "";
      起 = 下 + 1;
    }
    const 末 = 文.indexOf("\n", 起);
    return 末 < 0 ? 文.slice(起) : 文.slice(起, 末);
  };
  const 数行 = () => {
    let n = 0, 起 = 0;
    for (;;) {
      const 下 = 文.indexOf("\n", 起);
      if (下 < 0) break;
      n++;
      起 = 下 + 1;
    }
    return 起 < 文.length ? n + 1 : n;
  };
  const 行数 = 数行();
  ok("行数正好是一百一十一万四千一百一十二", 行数 === 1114112, String(行数));
  ok("第一行是 U+0000", 取行(0).startsWith("U+0000;"), 取行(0));
  ok("最后一行是 U+10FFFF", 取行(行数 - 1).startsWith("U+10FFFF;"), 取行(行数 - 1));

  const 行 = (cp) => 取行(cp);
  ok("U+0041 那一行说对了名字与类别", 行(0x41) === "U+0041;LATIN CAPITAL LETTER A;Lu;Basic Latin;Latin", 行(0x41));
  ok("U+3042 那一行说对了块", 行(0x3042).includes(";Hiragana;Hiragana"), 行(0x3042));
  // 区间展开的证据：CJK 那一大片在 UnicodeData 里只有两行，展开之后中间这个码点才有名字。
  ok("U+4E2D 有名字（区间展开了）", 行(0x4E2D).includes("<CJK Ideograph>"), 行(0x4E2D));
  ok("U+4E2D 的类别是 Lo、块是 CJK Unified Ideographs、脚本是 Han",
    行(0x4E2D) === "U+4E2D;<CJK Ideograph>;Lo;CJK Unified Ideographs;Han", 行(0x4E2D));
  ok("U+10FFFF 在补充私用区", 行(0x10FFFF).includes("Supplementary Private Use Area-B"), 行(0x10FFFF));
  ok("每一行都是五个字段", 行(0x41).split(";").length === 5 && 行(0x1F600).split(";").length === 5);
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
