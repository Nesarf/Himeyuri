// 生成 C 那台机器要用的两张表：大写映射、小写映射，加两个属性区间。
//
// 为什么要有这一件：C 那台把 to_upper / to_lower 只做到了 ASCII，
// 而 JS 那台问的是宿主 —— 两边对同一串文字的答案从一开始就不同。
// 表必须跟着搬过去，否则「同一种语言、两台机器」这句话只对英文成立。
//
// 数据从仓库自己的 UCD 语料来（data/ucd/），不问宿主要：
//   简单映射   UnicodeData.txt 第十二、十三段
//   完整映射   SpecialCasing.txt 里无条件的那几条（德语那个字母会摊成两个）
//   两个属性   DerivedCoreProperties.txt 的 Cased 与 Case_Ignorable
// 带条件的 SpecialCasing 条目（tr / az / lt 与词尾那一条）不进来：
// 前三个是地区规则，这门语言没有地区；词尾那一条在 C 里按位置算，见 hmyr.c。
//
// 用法：node tools/ucd-case.mjs
// 产出：vm/ucd-case.h
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 数据 = path.join(ROOT, "data/ucd");

const 码文 = (x) => "U+" + x.toString(16).toUpperCase().padStart(4, "0");

// ---- 一、简单映射（UnicodeData 的第十二、十三段） ----
const 简单上 = new Map();
const 简单下 = new Map();
for (const 行 of fs.readFileSync(path.join(数据, "UnicodeData.txt"), "utf8").split("\n")) {
  if (!行) continue;
  const 段 = 行.split(";");
  if (段.length < 15) continue;
  // 区间标记那几行（<CJK Ideograph, First> 这种）没有大小写，跳过。
  if (段[1].startsWith("<") && 段[1].includes(",")) continue;
  const cp = parseInt(段[0], 16);
  if (Number.isNaN(cp)) continue;
  const 上 = 段[12].trim();
  const 下 = 段[13].trim();
  if (上) 简单上.set(cp, 上.split(/\s+/).map((h) => parseInt(h, 16)));
  if (下) 简单下.set(cp, 下.split(/\s+/).map((h) => parseInt(h, 16)));
}

// ---- 二、完整映射（SpecialCasing 里无条件的那几条） ----
const 完整上 = new Map();
const 完整下 = new Map();
for (const 行 of fs.readFileSync(path.join(数据, "SpecialCasing.txt"), "utf8").split("\n")) {
  const 净 = 行.split("#")[0].trim();
  if (!净) continue;
  const 段 = 净.split(";").map((s) => s.trim());
  if (段.length < 5) continue;
  if (段[4] !== "") continue;              // 带条件的那几条：地区规则，这里不管
  const cp = parseInt(段[0], 16);
  if (Number.isNaN(cp)) continue;
  const 拆 = (文) => (文 ? 文.split(/\s+/).map((h) => parseInt(h, 16)) : []);
  const 下 = 拆(段[1]);
  const 上 = 拆(段[3]);
  if (上.length) 完整上.set(cp, 上);
  if (下.length) 完整下.set(cp, 下);
}

// ---- 三、合起来：完整优先，否则简单；与自身相同的丢掉 ----
const 收 = (完整, 简单) => {
  const 列 = [];
  const 全部 = new Set([...简单.keys(), ...完整.keys()]);
  for (const cp of [...全部].sort((a, b) => a - b)) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const 映 = 完整.get(cp) || 简单.get(cp);
    if (!映 || 映.length === 0) continue;
    if (映.length === 1 && 映[0] === cp) continue;
    // 存 UTF-16 单元，因为语言里的字符串就是这个形状。
    const 单元 = [];
    for (const c of 映) {
      if (c <= 0xffff) 单元.push(c);
      else {
        单元.push(0xd800 + ((c - 0x10000) >> 10));
        单元.push(0xdc00 + ((c - 0x10000) & 0x3ff));
      }
    }
    if (单元.length > 3) throw new Error("映射超过三个单元：" + 码文(cp));
    列.push([cp, 单元]);
  }
  return 列;
};

const 大写 = 收(完整上, 简单上);
const 小写 = 收(完整下, 简单下);

// ---- 四、两个属性区间 ----
const 收区间 = (名字) => {
  const 列 = [];
  for (const 行 of fs.readFileSync(path.join(数据, "DerivedCoreProperties.txt"), "utf8").split("\n")) {
    const 净 = 行.split("#")[0].trim();
    if (!净) continue;
    const 段 = 净.split(";").map((s) => s.trim());
    if (段.length < 2 || 段[1] !== 名字) continue;
    const 范围 = 段[0].split("..");
    const 起 = parseInt(范围[0], 16);
    const 止 = 范围.length > 1 ? parseInt(范围[1], 16) : 起;
    if (Number.isNaN(起) || Number.isNaN(止)) continue;
    列.push([起, 止]);
  }
  列.sort((a, b) => a[0] - b[0]);
  return 列;
};

const 区有 = 收区间("Cased");
const 区可 = 收区间("Case_Ignorable");

// ---- 五、写出来 ----
const 写映射 = (名, 列, 说明) => {
  const 行们 = [];
  for (const [cp, 单元] of 列) {
    const 填 = [0, 0, 0];
    for (let i = 0; i < 单元.length; i++) 填[i] = 单元[i];
    const 头 = "{0x" + cp.toString(16).toUpperCase() + "u, " + 单元.length + "u, {";
    行们.push("  " + 头 + 填.map((v) => "0x" + v.toString(16).toUpperCase() + "u").join(", ") + "}},");
  }
  return `/* ${说明}
 *
 * 按码点升序，二分查找。${列.length} 条。
 */
static const HmyrCaseEntry ${名}[] = {
${行们.join("\n")}
};

static const size_t ${名}_count = ${列.length};
`;
};

const 写区间 = (名, 列, 说明) => {
  const 平 = [];
  for (const [起, 止] of 列) 平.push(起, 止);
  const 行们 = [];
  for (let i = 0; i < 平.length; i += 8) {
    行们.push("  " + 平.slice(i, i + 8).map((v) => "0x" + v.toString(16).toUpperCase() + "u").join(", ") + ",");
  }
  return `/* ${说明}
 *
 * 每两个数一段：起、止，两端都含。${列.length} 段。
 */
static const uint32_t ${名}[] = {
${行们.join("\n")}
};

static const size_t ${名}_count = ${列.length};
`;
};

const 文本 = `/* Unicode 的大小写表，C 那台机器用。
 *
 * 由 tools/ucd-case.mjs 从 data/ucd/ 的语料生成，别手改 ——
 * 改了它，生成器下一次就会把它改回去。
 * 验收在 test/c-vm.test.mjs 第十节：两台机器对同一串文字交出同一串单元。
 */
#ifndef HMYR_UCD_CASE_H
#define HMYR_UCD_CASE_H
#include <stdint.h>
#include <stddef.h>

/* 一条映射：码点、映射出来的单元数、最多三个 UTF-16 单元。
 * 三个够用 —— 全码点里最长的那一道正好是三个（德语里那一个字母的上半），
 * 生成器遇到更长的会自己停下，不写出半张表。 */
typedef struct {
  uint32_t cp;
  uint16_t n;
  uint16_t u[3];
} HmyrCaseEntry;

${写映射("ucd_upper_map", 大写, "大写映射：码点 → 大写的 UTF-16 单元")}
${写映射("ucd_lower_map", 小写, "小写映射：码点 → 小写的 UTF-16 单元")}
${写区间("ucd_cased_ranges", 区有, "有大小写的码点区间（DerivedCoreProperties 的 Cased）")}
${写区间("ucd_case_ignorable_ranges", 区可, "大小写可以忽略的码点区间（DerivedCoreProperties 的 Case_Ignorable）")}

#endif
`;

const 出 = path.join(ROOT, "vm", "ucd-case.h");
fs.writeFileSync(出, 文本, "utf8");

const 多 = (列) => 列.filter(([, 单元]) => 单元.length > 1).length;
console.log("大写映射 " + 大写.length + " 条（其中多单元 " + 多(大写) + " 条）");
console.log("小写映射 " + 小写.length + " 条（其中多单元 " + 多(小写) + " 条）");
console.log("有大小写 " + 区有.length + " 段；大小写可忽略 " + 区可.length + " 段");
console.log("→ " + path.relative(ROOT, 出) + "  " + Math.round(文本.length / 1024) + " KB");
