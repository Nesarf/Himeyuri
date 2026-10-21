// Unicode 数据：把 UCD 读进来，变成能查的东西。
//
// 这一份是一个工具，也是一份库：data/ucd/ 下那五十二兆的原始数据是语言实现要用的
// 真材料 —— 字符的名字、类别、所属的块、所属的脚本、大小写映射、归一化数据、
// 以及 Unihan 那一套（读音、变体、笔画、字典索引）。
//
// 为什么要它们：一个语言说「字符串按码元算」，那是它的语义；而「这个码元属于哪一类」
// 是数据，是随 Unicode 版本走的一张大表。借宿主的正则就是借这张表；而自己带着这张表，
// 就是把它变成库的一部分。
//
// 输出两份：
//
//   runtime/ucd/summary.json   规模与抽查，给套件与工具读
//   runtime/ucd/blocks.hmyr    一个 HMYR 函数：码点 → 块名（三千行以内的 if 链）
//
// 第二份的意义是让数据从语言那一侧也能查 —— 它不是给 JS 看的，是给 .hmyr 看的。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const UCD目录 = path.join(ROOT, "data/ucd");
export const 产物目录 = path.join(ROOT, "runtime/ucd");

const 读 = (名) => fs.readFileSync(path.join(UCD目录, 名), "utf8");

// 行格式：「0041..005A; Basic Latin」或「0041; Basic Latin」。
const 解析区间表 = (文) => {
  const 出 = [];
  for (const 行 of 文.split("\n")) {
    const 净 = 行.replace(/#.*$/, "").trim();
    if (!净) continue;
    const [区, 名] = 净.split(";").map((s) => s.trim());
    if (!区 || !名) continue;
    const m = /^([0-9A-Fa-f]+)(?:\.\.([0-9A-Fa-f]+))?$/.exec(区);
    if (!m) continue;
    const 起 = Number.parseInt(m[1], 16);
    const 止 = m[2] ? Number.parseInt(m[2], 16) : 起;
    出.push({ 起, 止, 名 });
  }
  return 出;
};

// UnicodeData.txt 的行：码点;名字;类别;...（十五个字段）
const 解析字符数据 = () => {
  const 出 = [];
  for (const 行 of 读("UnicodeData.txt").split("\n")) {
    if (!行.trim()) continue;
    const f = 行.split(";");
    if (f.length < 3) continue;
    出.push({
      码点: Number.parseInt(f[0], 16),
      名字: f[1],
      类别: f[2],
    });
  }
  return 出;
};

export const 块表 = () => 解析区间表(读("Blocks.txt"));
export const 脚本表 = () => 解析区间表(读("Scripts.txt"));

export const 块名 = (cp) => {
  for (const b of 块表()) if (cp >= b.起 && cp <= b.止) return b.名;
  return "No_Block";
};

export const 脚本名 = (cp) => {
  for (const s of 脚本表()) if (cp >= s.起 && cp <= s.止) return s.名;
  return "Unknown";
};

// 字符数据按码点索引，方便查类别与名字。
export const 字符表 = new Map(解析字符数据().map((c) => [c.码点, c]));

// 生成 HMYR 侧的块名函数。三千行以内 —— 块数就是那么多。
//
// 边界写成十进制，不写十六进制：自举那一层的数字字面量走 to_int，而它只认十进制。
// 十六进制在这里读起来更好看，可它会让这张表在自举那条路上读不进来 ——
// 一张只有宿主读得动的表，等于没有这张表。十六进制放在行尾的注释里，两边都留着。
const 生成块函数 = () => {
  const 块们 = 块表();
  const 行们 = [];
  const 十六 = (n) => "0x" + n.toString(16).toUpperCase();
  行们.push("// 这张表是从 data/ucd/Blocks.txt 生成的：码点 → 块名。");
  行们.push("// 生成器是 tools/ucd.mjs，验收在 test/ucd.test.mjs。手改这里会被下一次生成覆盖。");
  行们.push("// 边界写十进制：自举那一层的 to_int 只认十进制，十六进制会让它在那边读不进来。");
  行们.push("fn 块名(码点: Int) -> String {");
  for (const b of 块们) {
    const 注 = b.起 === b.止 ? "  // " + 十六(b.起) : "  // " + 十六(b.起) + ".." + 十六(b.止);
    if (b.止 === b.起) {
      行们.push("  if 码点 == " + b.起 + " {" + 注);
      行们.push("    return \"" + b.名 + "\"");
      行们.push("  }");
    } else {
      // 两层嵌套，不写复合条件：自举那一层的 parser 读不进 `&&`，也读不进 `and`——
      // 两个比较写在一起，它会在 if 那一行报语法错。嵌套是它读得动的写法。
      行们.push("  if 码点 >= " + b.起 + " {" + 注);
      行们.push("    if 码点 <= " + b.止 + " {");
      行们.push("      return \"" + b.名 + "\"");
      行们.push("    }");
      行们.push("  }");
    }
  }
  行们.push("  return \"No_Block\"");
  行们.push("}");
  行们.push("");
  return 行们.join("\n");
};

export const 主 = () => {
  const 字符 = 解析字符数据();
  const 块们 = 块表();
  const 脚本们 = 脚本表();
  const 类别 = new Map();
  for (const c of 字符) 类别.set(c.类别, (类别.get(c.类别) || 0) + 1);
  const 脚本名们 = new Set(脚本们.map((s) => s.名));

  fs.mkdirSync(产物目录, { recursive: true });
  const 摘要 = {
    版本: "Unicode 16.0.0",
    字符数据行数: 字符.length,
    块数: 块们.length,
    脚本数: 脚本名们.size,
    类别分布: Object.fromEntries([...类别].sort((a, b) => b[1] - a[1])),
    抽查: [
      { 码点: "U+0041", 名字: 字符表.get(0x41)?.名字, 类别: 字符表.get(0x41)?.类别, 块: 块名(0x41), 脚本: 脚本名(0x41) },
      { 码点: "U+3042", 名字: 字符表.get(0x3042)?.名字, 类别: 字符表.get(0x3042)?.类别, 块: 块名(0x3042), 脚本: 脚本名(0x3042) },
      { 码点: "U+4E2D", 名字: 字符表.get(0x4E2D)?.名字, 类别: 字符表.get(0x4E2D)?.类别, 块: 块名(0x4E2D), 脚本: 脚本名(0x4E2D) },
      { 码点: "U+1F600", 块: 块名(0x1F600), 脚本: 脚本名(0x1F600) },
      { 码点: "U+10FFFF", 块: 块名(0x10FFFF), 脚本: 脚本名(0x10FFFF) },
    ],
  };
  fs.writeFileSync(path.join(产物目录, "summary.json"), JSON.stringify(摘要, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(产物目录, "blocks.hmyr"), 生成块函数(), "utf8");
  return 摘要;
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const 摘要 = 主();
  console.log("字符数据 " + 摘要.字符数据行数 + " 行");
  console.log("块 " + 摘要.块数 + " 个，脚本 " + 摘要.脚本数 + " 个");
  console.log("产出 runtime/ucd/summary.json 与 runtime/ucd/blocks.hmyr");
}
