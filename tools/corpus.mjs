// 语料：把「语言该给出什么」写成可以逐行比的文件。
//
// 两份，都在 conformance/ 下：
//
//   unicode-letters.txt   每个码点一类：L（字母）、M（附加符）、-（两者都不是）
//   unicode-nfc.txt       每个码点的 NFC 结果（码点序列）
//
// 第一份来自 UCD 的通用类别（L 开头的算字母，M 开头的算附加符），
// 而语言里的 is_letter 与 is_mark 正是这两个意思 —— 于是这份语料问的是一个
// 可以失败的问题：宿主给我们的 Unicode 表，与 UCD 的类别映射一致吗。
//
// 第二份来自宿主现在的归一化实现。它的价值在换宿主的那一天：这张表要重新对一次，
// 而差异就是两个宿主之间的差别。没有这张表，「换宿主之后行为一样」只是一句话。
//
// 一百一十一万行的量既是全表，也是这两件事唯一诚实的量法：抽样只能证明抽样那几处对。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 字符表 } from "./ucd.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const 语料目录 = path.join(ROOT, "conformance");

// 一个码点归哪一类。类别是两字母的通用类别，L 开头是字母、M 开头是附加符。
const 归类 = (cp) => {
  const c = 字符表.get(cp);
  const 类 = c ? c.类别 : "Cn";
  if (类.startsWith("L")) return "L";
  if (类.startsWith("M")) return "M";
  return "-";
};

// 逐行生成并分批写：一百一十一万行如果先攒成数组再落盘，会先吃掉几百兆内存。
const 写 = (名, 每行) => {
  const 出 = path.join(语料目录, 名);
  const fd = fs.openSync(出, "w");
  let 批 = [];
  let 行数 = 0;
  for (let cp = 0; cp <= 0x10FFFF; cp++) {
    批.push(每行(cp));
    行数++;
    if (批.length >= 20000) { fs.writeSync(fd, 批.join("\n") + "\n"); 批 = []; }
  }
  if (批.length) fs.writeSync(fd, 批.join("\n") + "\n");
  fs.closeSync(fd);
  return 行数;
};

const 键 = (cp) => "U+" + cp.toString(16).toUpperCase().padStart(4, "0");

// Unihan 那一组：八个文件、四十兆，记的是每个汉字码点的读音、变体、笔画与字典索引。
// 它们按行写成「码点、属性、值」，制表符分隔 —— 解析起来就是三刀。
const 解析Unihan = () => {
  const 表 = new Map();
  const 目录 = path.join(ROOT, "data/ucd/Unihan");
  for (const 名 of fs.readdirSync(目录)) {
    if (!名.endsWith(".txt")) continue;
    for (const 行 of fs.readFileSync(path.join(目录, 名), "utf8").split("\n")) {
      if (!行 || 行.codePointAt(0) === 35) continue;      // 井号开头是注释
      const f = 行.split("\t");
      if (f.length < 3) continue;
      const cp = Number.parseInt(f[0].slice(2), 16);
      if (Number.isNaN(cp)) continue;
      if (!表.has(cp)) 表.set(cp, []);
      表.get(cp).push(f[1] + "=" + f[2]);
    }
  }
  return 表;
};

// 一张汉字表：每个有 Unihan 记录的码点一行，属性按名字排在后面。
const 写Unihan = (表) => {
  const 出 = path.join(语料目录, "unihan.txt");
  const fd = fs.openSync(出, "w");
  const 码点们 = [...表.keys()].sort((a, b) => a - b);
  let 批 = [];
  for (const cp of 码点们) {
    批.push(键(cp) + ";" + 表.get(cp).join(";"));
    if (批.length >= 20000) { fs.writeSync(fd, 批.join("\n") + "\n"); 批 = []; }
  }
  if (批.length) fs.writeSync(fd, 批.join("\n") + "\n");
  fs.closeSync(fd);
  return 码点们.length;
};

export const 主 = () => {
  fs.mkdirSync(语料目录, { recursive: true });
  const 行1 = 写("unicode-letters.txt", (cp) => 键(cp) + ";" + 归类(cp));
  const 行2 = 写("unicode-nfc.txt", (cp) => {
    // fromCodePoint 对孤立代理也给得出来；normalize 对它是原样交回。
    const 后 = String.fromCodePoint(cp).normalize("NFC");
    return 键(cp) + ";" + Array.from(后, (ch) => 键(ch.codePointAt(0))).join(" ");
  });
  const 行3 = 写Unihan(解析Unihan());
  return { 字母行数: 行1, 归一化行数: 行2, 汉字行数: 行3 };
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const r = 主();
  console.log("unicode-letters.txt " + r.字母行数 + " 行");
  console.log("unicode-nfc.txt " + r.归一化行数 + " 行");
}
