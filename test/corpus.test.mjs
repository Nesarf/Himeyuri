// 语料：三份可以逐行比的文件，每一行都是一个能失败的问题。
//
//   unicode-letters.txt   每个码点归哪一类（L 字母、M 附加符、- 都不是）
//   unicode-nfc.txt       每个码点的 NFC 结果
//   unihan.txt            每个有记录的汉字，属性按名字排在后面
//
// 第一份问的是「宿主给我们的 Unicode 表，与 UCD 的类别映射一致吗」；
// 第二份问的是「换一个宿主之后，归一化还一样吗」；
// 第三份是汉字那一块的真数据：读音、变体、笔画、字典索引。
//
// 一百一十一万行不是凑数：抽样只能证明抽样那几处对，而这三份的用途正是「全表」。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 本机能力 } from "../src/capabilities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 读 = (名) => {
  const p = path.join(ROOT, "conformance", 名);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
};
const 大小 = (名) => {
  const p = path.join(ROOT, "conformance", 名);
  return fs.existsSync(p) ? fs.statSync(p).size : 0;
};
const 行们 = (文) => { const a = 文.split("\n"); if (a[a.length - 1] === "") a.pop(); return a; };

console.log("一、三份语料都在，量也对");
{
  ok("unicode-letters.txt 十兆以上", 大小("unicode-letters.txt") > 10 * 1024 * 1024, (大小("unicode-letters.txt") / 1024 / 1024).toFixed(2) + " MB");
  ok("unicode-nfc.txt 十五兆以上", 大小("unicode-nfc.txt") > 15 * 1024 * 1024, (大小("unicode-nfc.txt") / 1024 / 1024).toFixed(2) + " MB");
  ok("unihan.txt 二十五兆以上", 大小("unihan.txt") > 25 * 1024 * 1024, (大小("unihan.txt") / 1024 / 1024).toFixed(2) + " MB");
  const 总 = 大小("unicode-letters.txt") + 大小("unicode-nfc.txt") + 大小("unihan.txt");
  ok("三份合计五十兆以上", 总 > 50 * 1024 * 1024, (总 / 1024 / 1024).toFixed(2) + " MB");
}

console.log("二、字母语料：全表，而且分类说得对");
{
  const 行 = 行们(读("unicode-letters.txt"));
  ok("行数是全码点数", 行.length === 1114112, String(行.length));
  ok("第一行是 U+0000 且不是字母", 行[0] === "U+0000;-", 行[0]);
  const 查 = (cp) => 行[cp];
  ok("U+0041 是字母", 查(0x41) === "U+0041;L", 查(0x41));
  ok("U+0301（组合尖音）是附加符", 查(0x301) === "U+0301;M", 查(0x301));
  ok("U+0030 既不是字母也不是附加符", 查(0x30) === "U+0030;-", 查(0x30));
  ok("U+3042 是字母", 查(0x3042) === "U+3042;L", 查(0x3042));
  ok("U+4E2D 是字母", 查(0x4E2D) === "U+4E2D;L", 查(0x4E2D));
  // 表情是 So（符号），不是字母 —— 这一条能看出「类别首字母」这个规矩有没有被写歪。
  ok("U+1F600 不是字母", 查(0x1F600) === "U+1F600;-", 查(0x1F600));
  // 与语言自己的 is_letter 对一下：语料说它是字母，语言也该说是。
  // 这一条是有意义的那一半 —— 语料单独存在只是数据，两边对上才叫对照。
  const 是字母 = 本机能力().unicode.isLetter("\u3042");
  ok("语言的内置与语料在 U+3042 上一致", 是字母 === (查(0x3042).split(";")[1] === "L"));
}

console.log("三、归一化语料：全表，单码点与原码点相同");
{
  const 行 = 行们(读("unicode-nfc.txt"));
  ok("行数是全码点数", 行.length === 1114112, String(行.length));
  const 查 = (cp) => 行[cp];
  ok("U+0041 归一之后还是 U+0041", 查(0x41) === "U+0041;U+0041", 查(0x41));
  ok("U+00E9（é）本来就是合成形", 查(0xE9) === "U+00E9;U+00E9", 查(0xE9));
  // 组合尖音单独出现时没有可合成的前一个字，所以它原样留着。
  ok("U+0301 单独归一还是它自己", 查(0x301) === "U+0301;U+0301", 查(0x301));
  // 分解形的 é（e 加组合尖音）在 NFC 下合成一个码点 —— 这一条是这份语料的意义所在。
  const 分解 = "e\u0301".normalize("NFC");
  ok("分解形的 é 归一之后是一个码点", 分解.length === 1 && 分解.codePointAt(0) === 0xE9);
  ok("语料里 U+1F600 原样", 查(0x1F600) === "U+1F600;U+1F600", 查(0x1F600));
}

console.log("四、汉字语料：近十万行，属性按名字排");
{
  const 行 = 行们(读("unihan.txt"));
  ok("九万行以上", 行.length > 90000, String(行.length));
  const 查 = (cp) => 行.find((l) => l.startsWith("U+" + cp.toString(16).toUpperCase().padStart(4, "0") + ";")) || "";
  const 中 = 查(0x4E2D);
  ok("U+4E2D 有记录", 中.length > 0);
  ok("它的属性以 k 开头的名字排着", /;k[A-Za-z]+=/.test(中), 中.slice(0, 60));
  const 日 = 查(0x65E5);
  ok("U+65E5 有记录", 日.length > 0);
  ok("两个不同的字，属性串不同", 中 !== 日 && 中.length > 0 && 日.length > 0);
  // 行尾不该有空格或制表符残留：那是解析没剥干净的样子。
  ok("没有一行以空白结尾", !行.some((l) => l.length > 0 && /[\s\t]$/.test(l)));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
