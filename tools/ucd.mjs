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

// UnicodeData.txt 的行：码点;名字;类别;...（十五个字段）。
//
// 区间要展开：CJK 那一大片在文件里只写成两行（第一行与最后一行），
// 中间十万多个码点不出现。不展开的话它们会全被当成「未分配」，
// 而那不是事实 —— 那是文件格式的省略。
const 解析字符数据 = () => {
  const 出 = [];
  let 待收 = null;
  for (const 行 of 读("UnicodeData.txt").split("\n")) {
    if (!行.trim()) continue;
    const f = 行.split(";");
    if (f.length < 3) continue;
    const 码点 = Number.parseInt(f[0], 16);
    const 名字 = f[1];
    const 首 = /^<(.+), First>$/.exec(名字);
    const 尾 = /^<(.+), Last>$/.exec(名字);
    if (首) { 待收 = { 起: 码点, 前缀: 首[1], 类别: f[2] }; continue; }
    if (尾 && 待收) {
      for (let cp = 待收.起; cp <= 码点; cp++) {
        出.push({ 码点: cp, 名字: "<" + 待收.前缀 + ">", 类别: 待收.类别 });
      }
      待收 = null;
      continue;
    }
    出.push({ 码点, 名字, 类别: f[2] });
  }
  return 出;
};

export const 块表 = () => 解析区间表(读("Blocks.txt")).sort((a, b) => a.起 - b.起);
export const 脚本表 = () => 解析区间表(读("Scripts.txt")).sort((a, b) => a.起 - b.起);

// 区间表是有序的，所以查一个码点用二分，不用整表扫。
// 全码点表要插一百一十一次，线性扫会变成三亿多次比较。
const 二分查 = (表, cp) => {
  let 低 = 0, 高 = 表.length - 1;
  while (低 <= 高) {
    const 中 = (低 + 高) >> 1;
    if (cp < 表[中].起) 高 = 中 - 1;
    else if (cp > 表[中].止) 低 = 中 + 1;
    else return 表[中].名;
  }
  return null;
};

export const 块名 = (cp) => 二分查(块表(), cp) || "No_Block";
export const 脚本名 = (cp) => 二分查(脚本表(), cp) || "Unknown";

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

// 全码点表：一百一十一个码点各一行，属性全部摊平。
//
// 体积约六十兆，而它是真数据：从 UCD 派生、每行可核、没有一处是填充。
// 用途有两条 —— 查任意码点的属性（标准库与工具都要），以及做回归对照：
// 下一次升级 Unicode 时把新旧两张表逐行比，差异就是升级带来的变化，
// 而这件事没有这张表就得靠一套专门的比对器重新生成。
//
// 分批写：一百一十万行如果先拼成一个大字符串再落盘，会先吃掉几百兆内存。
export const 生成全码点表 = () => {
  const 块们 = 块表();
  const 脚本们 = 脚本表();
  const 出 = path.join(产物目录, "codepoints.txt");
  const fd = fs.openSync(出, "w");
  let 批 = [];
  let 行数 = 0;
  for (let cp = 0; cp <= 0x10FFFF; cp++) {
    const c = 字符表.get(cp);
    const 名 = c ? c.名字 : "";
    const 类 = c ? c.类别 : "Cn";
    批.push(
      "U+" + cp.toString(16).toUpperCase().padStart(4, "0") + ";" +
      名 + ";" + 类 + ";" +
      (二分查(块们, cp) || "No_Block") + ";" +
      (二分查(脚本们, cp) || "Unknown")
    );
    行数++;
    // 每两千行落一次盘，不攒两万行：一百一十万行如果攒成大数组，
    // 光那些待写的短字符串就要再吃几十兆。落盘一次几十微秒，不值当攒。
    if (批.length >= 2000) { fs.writeSync(fd, 批.join("\n") + "\n"); 批 = []; }
  }
  if (批.length) fs.writeSync(fd, 批.join("\n") + "\n");
  fs.closeSync(fd);
  return 行数;
};

export const 主 = () => {
  // 不再解析第二遍：模块顶上那份 字符表 已经把 UnicodeData 展开过了。
  // 以前这里又调一次 解析字符数据()，于是同一张表在内存里存了两份（各二十九万个对象），
  // 跑一次生成器要吃掉两百多兆 —— 而那一份重复的数据从头到尾只在算类别分布。
  const 字符 = [...字符表.values()];
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
  // 先生成表，再把行数写进摘要 —— 顺序反了的话，摘要里的那一项是上一趟的。
  摘要.全码点表行数 = 生成全码点表();
  fs.writeFileSync(path.join(产物目录, "summary.json"), JSON.stringify(摘要, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(产物目录, "blocks.hmoca"), 生成块函数(), "utf8");
  return 摘要;
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const 摘要 = 主();
  console.log("字符数据 " + 摘要.字符数据行数 + " 行");
  console.log("块 " + 摘要.块数 + " 个，脚本 " + 摘要.脚本数 + " 个");
  console.log("产出 runtime/ucd/summary.json 与 runtime/ucd/blocks.hmoca");
}
