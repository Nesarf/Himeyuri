// 生成 C 那台机器要的归一化数据：分解、组合类、组合对。
//
// 为什么要有这一件：nfc 在 C 那台上一直是恒等函数，理由是「真表是十七兆语料」。
// 那句话只说对了一半 —— 十七兆是**测试**语料（每个码点归一之后是什么），
// 而生成一张表只需要三样小东西：规范分解、组合类、以及组合对。
// 这三样都在仓库自己的 data/ucd/ 里，于是这台机器不必再借宿主的 normalize。
//
//   分解    UnicodeData 第五段（只收规范的；<compat> 那种不在 NFC 的职责里），递归到底
//   组合类  UnicodeData 第三段
//   组合对  直接分解正好两个、第一个的组合类为零、且不在 CompositionExclusions 里
//   韩文    不进表：那是一段算法（三个字母表拼一个音节），写在 C 里
//
// 用法：node tools/ucd-nfc.mjs
// 产出：vm/ucd-nfc.h
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 数据 = path.join(ROOT, "data/ucd");
const 码文 = (x) => "U+" + x.toString(16).toUpperCase().padStart(4, "0");

// ---- 一、UnicodeData：直接分解与组合类 ----
const 直分解 = new Map();
const 组合类 = new Map();
for (const 行 of fs.readFileSync(path.join(数据, "UnicodeData.txt"), "utf8").split("\n")) {
  if (!行) continue;
  const 段 = 行.split(";");
  if (段.length < 15) continue;
  const cp = parseInt(段[0], 16);
  if (Number.isNaN(cp)) continue;
  const ccc = parseInt(段[3], 10);
  if (ccc) 组合类.set(cp, ccc);
  const 分 = 段[5].trim();
  if (!分 || 分.startsWith("<")) continue;      // 兼容分解不属于 NFC
  直分解.set(cp, 分.split(/\s+/).map((h) => parseInt(h, 16)));
}

// ---- 二、全分解：递归到底。韩文音节是算法，UnicodeData 里本来也没有分解 ----
const 全分解 = new Map();
const 算全 = (cp, 深) => {
  if (深 > 8) throw new Error("分解链太深：" + 码文(cp));
  const 直 = 直分解.get(cp);
  if (!直) return [cp];
  const 出 = [];
  for (const c of 直) 出.push(...算全(c, 深 + 1));
  return 出;
};
let 最长 = 0;
for (const cp of [...直分解.keys()].sort((a, b) => a - b)) {
  const 全 = 算全(cp, 0);
  if (全.length > 最长) 最长 = 全.length;
  全分解.set(cp, 全);
}

// ---- 三、组合排除 ----
const 排除 = new Set();
for (const 行 of fs.readFileSync(path.join(数据, "CompositionExclusions.txt"), "utf8").split("\n")) {
  const 净 = 行.split("#")[0].trim();
  if (!净) continue;
  const cp = parseInt(净.split(/\s+/)[0], 16);
  if (!Number.isNaN(cp)) 排除.add(cp);
}

// ---- 四、组合对 ----
const 组合 = [];
for (const [cp, 直] of 直分解) {
  if (直.length !== 2) continue;                 // 单个的那是「单例分解」，不再组合回来
  if (排除.has(cp)) continue;
  if ((组合类.get(直[0]) || 0) !== 0) continue;  // 非起头分解不组合
  组合.push([直[0], 直[1], cp]);
}
组合.sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]));

// ---- 五、写出来 ----
const 写分解 = () => {
  const 行们 = [];
  for (const [cp, 全] of 全分解) {
    const 填 = [0, 0, 0, 0];
    for (let i = 0; i < 全.length; i++) 填[i] = 全[i];
    行们.push("  {0x" + cp.toString(16).toUpperCase() + "u, " + 全.length + "u, {"
      + 填.map((v) => "0x" + v.toString(16).toUpperCase() + "u").join(", ") + "}},");
  }
  return 行们.join("\n");
};

const 写组合类 = () => {
  const 行们 = [];
  for (const [cp, ccc] of [...组合类.entries()].sort((a, b) => a[0] - b[0])) {
    行们.push("  {0x" + cp.toString(16).toUpperCase() + "u, " + ccc + "u},");
  }
  return 行们.join("\n");
};

const 写组合 = () => {
  const 行们 = [];
  for (const [a, b, cp] of 组合) {
    行们.push("  {0x" + a.toString(16).toUpperCase() + "u, 0x" + b.toString(16).toUpperCase()
      + "u, 0x" + cp.toString(16).toUpperCase() + "u},");
  }
  return 行们.join("\n");
};

const 文本 = `/* Unicode 的归一化数据，C 那台机器用（NFC 要的那三样）。
 *
 * 由 tools/ucd-nfc.mjs 从 data/ucd/ 的语料生成，别手改。
 * 表里没有韩文音节：那是一段算法，写在 hmyr.c 里。
 * 验收在 test/c-vm.test.mjs 第十一节：每个码点归一之后应当是什么，
 * 以及把分解与组合串起来的那几种形状。
 */
#ifndef HMYR_UCD_NFC_H
#define HMYR_UCD_NFC_H
#include <stdint.h>
#include <stddef.h>

/* 一条规范分解：码点、全分解之后有几个码点、最多四个。
 * 四个够用 —— 全码点里最长的那一道正好是四个，生成器遇到更长的会自己停下。 */
typedef struct {
  uint32_t cp;
  uint16_t n;
  uint32_t u[4];
} HmyrDecompEntry;

/* 一个组合类：只有非零的那些进来，零是默认值。 */
typedef struct {
  uint32_t cp;
  uint8_t ccc;
} HmyrCccEntry;

/* 一个组合对：(前一个, 后一个) → 合成之后的那个码点。按两个输入排好序。 */
typedef struct {
  uint32_t a;
  uint32_t b;
  uint32_t cp;
} HmyrCompEntry;

static const HmyrDecompEntry ucd_decomp[] = {
${写分解()}
};

static const size_t ucd_decomp_count = ${全分解.size};

static const HmyrCccEntry ucd_ccc[] = {
${写组合类()}
};

static const size_t ucd_ccc_count = ${组合类.size};

static const HmyrCompEntry ucd_comp[] = {
${写组合()}
};

static const size_t ucd_comp_count = ${组合.length};

#endif
`;

const 出 = path.join(ROOT, "vm", "ucd-nfc.h");
fs.writeFileSync(出, 文本, "utf8");

console.log("分解 " + 全分解.size + " 条（最长 " + 最长 + " 个码点）");
console.log("组合类 " + 组合类.size + " 条");
console.log("组合对 " + 组合.length + " 个（排除表 " + 排除.size + " 个）");
console.log("→ " + path.relative(ROOT, 出) + "  " + Math.round(文本.length / 1024) + " KB");
