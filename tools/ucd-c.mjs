// 从 runtime/ucd/codepoints.txt 生成两张 C 用的区间表：字母与记号。
//
// 为什么要有这一件：C 那台机器要判「这个码元是不是字母」，而它不能像 JS 那样
// 问正则的 p{L}。表必须跟着搬过去，否则「不依赖宿主」只搬了一半。
//
// 用法：node tools/ucd-c.mjs
// 产出：vm/ucd-letter.h、vm/ucd-mark.h
//
// 表的形状：每两个 uint32_t 一段，起与止都含。按码点升序，二分查找。
// 段数不多（字母约八百段），所以直接写成 C 数组，不必再做一层压缩。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 源 = path.join(ROOT, "runtime/ucd/codepoints.txt");

const 文 = fs.readFileSync(源, "utf8");
const 行们 = 文.split("\n");

const 字们 = [];   // 字母区间
const 记们 = [];   // 记号区间

let 当前码 = -2;
const 收集 = (列, cp) => {
  if (列.length === 0) { 列.push([cp, cp]); return; }
  const 末 = 列[列.length - 1];
  if (cp === 末[1] + 1) { 末[1] = cp; return; }
  列.push([cp, cp]);
};

for (const 行 of 行们) {
  if (!行) continue;
  // 形状：U+XXXX;name;category;block;script
  const 段 = 行.split(";");
  if (段.length < 3) continue;
  const 码文 = 段[0];
  if (!码文.startsWith("U+")) continue;
  const cp = parseInt(码文.slice(2), 16);
  if (Number.isNaN(cp)) continue;
  const 类 = 段[2];
  if (类.startsWith("L")) 收集(字们, cp);
  else if (类.startsWith("M")) 收集(记们, cp);
}

const 写表 = (名, 列, 说明) => {
  const 平 = [];
  for (const [起, 止] of 列) { 平.push(起, 止); }
  const 行们 = [];
  for (let i = 0; i < 平.length; i += 8) {
    行们.push("  " + 平.slice(i, i + 8).map((v) => "0x" + v.toString(16) + "u").join(", ") + ",");
  }
  const 文本 =
`/* ${说明}
 *
 * 由 tools/ucd-c.mjs 从 runtime/ucd/codepoints.txt 生成，别手改。
 * 每两个数一段：起、止，两端都含。按码点升序。
 * ${列.length} 段。
 */
#ifndef HMYR_${名}_H
#define HMYR_${名}_H
#include <stdint.h>
#include <stddef.h>

static const uint32_t ${名.toLowerCase()}_ranges[] = {
${行们.join("\n")}
};

static const size_t ${名.toLowerCase()}_count = ${列.length};
#endif
`;
  const 出 = path.join(ROOT, "vm", 名.toLowerCase().replace(/_/g, "-") + ".h");
  fs.writeFileSync(出, 文本, "utf8");
  console.log(名 + "：" + 列.length + " 段 → " + path.relative(ROOT, 出));
};

写表("UCD_LETTER", 字们, "Unicode 里所有 L* 类（字母）的码点区间");
写表("UCD_MARK", 记们, "Unicode 里所有 M* 类（记号，组合用）的码点区间");
