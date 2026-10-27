#!/usr/bin/env node
// pub 迁移的盘点：一个入口下面，有多少跨模块的私有引用（HMYR-W0303）。
//
//   node tools/pub-census.mjs <入口文件> [...]
//
// 它只装载、不跑 —— 装载层的可见性检查就在那一步报，而这正是要数的那件事。
// 输出按「声明所在的文件」分组，因为迁移是按文件做的：一份文件的导出面定下来，
// 那一份就迁移完了。
import path from "node:path";
import { loadUnit } from "../src/loader.mjs";

const 入口们 = process.argv.slice(2);
if (入口们.length === 0) {
  console.error("用法：node tools/pub-census.mjs <入口文件> [...]");
  process.exit(2);
}

const 分文件 = new Map();
let 总 = 0;
for (const 入口 of 入口们) {
  const 单 = loadUnit(path.resolve(入口));
  for (const w of 单.diagnostics.warnings) {
    if (w.code !== "HMYR-W0303") continue;
    总++;
    // 那句话里带着「声明在 X，用在这里 Y」；拿它当键，重复的引用只数一次。
    const 键 = w.message;
    if (!分文件.has(键)) 分文件.set(键, 0);
    分文件.set(键, 分文件.get(键) + 1);
  }
}

const 按名 = new Map();
for (const [句, 次] of 分文件) {
  // 一句话里带着「哪个名字、声明在哪儿、用在哪里」；迁移是按名字标的，
  // 所以聚合的键是名字，而不是句子。
  const m = /'([^']+)' is declared in ([^,]+) without pub, and it is called in ([^;]+)/.exec(句);
  if (!m) continue;
  const 名 = m[1], 家 = path.basename(m[2].trim()), 用 = path.basename(m[3].trim());
  if (!按名.has(家)) 按名.set(家, new Map());
  const 表 = 按名.get(家);
  if (!表.has(名)) 表.set(名, new Set());
  表.get(名).add(用);
}

let 名字数 = 0;
for (const 表 of 按名.values()) 名字数 += 表.size;

// --tsv：一行一条 `文件<TAB>名字`，给脚本消费。
// 人读的是下面那段分组输出，而迁移脚本要的是可解析的形状。
if (process.argv.includes("--tsv")) {
  for (const [家, 表] of 按名) for (const 名 of 表.keys()) console.log(家 + "\t" + 名);
  process.exit(0);
}

console.log("要标 pub 的名字：" + 名字数 + " 个，涉及 " + 按名.size + " 份文件");
for (const [家, 表] of [...按名.entries()].sort((a, b) => b[1].size - a[1].size)) {
  console.log("  " + 家 + "  " + 表.size + " 个");
  for (const [名, 用处] of 表) console.log("      pub " + 名 + "   ← 被 " + [...用处].join("、") + " 用");
}
