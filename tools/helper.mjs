// 助手：把错误编号变成人能用的话，而把症状翻回编号。
//
// 为什么它建在编号表上而不是另写一套：design/DISTRO.txt 里数过 Nyarch 的七样，
// 助手是其中一样。而这里已经有一座更好的地基——conformance/codes.mjs 里
// 每个编号都有阶段、含义与「谁在验它」。助手该建在那上面，而不是另起一套说法；
// 两套说法会漂移，而漂移之后两边都不对。
//
//   node tools/helper.mjs HMYR-行-010     这个编号是什么、该怎么办
//   node tools/helper.mjs 深度           哪些编号的含义里有「深度」
//   node tools/helper.mjs               列出全部编号
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 中文人话单独一份（conformance/plain.mjs）：codes.mjs 给检查器读，这一份给人读。
const { PLAIN } = await import(pathToFileURL(path.join(ROOT, "conformance/plain.mjs")).href);
const 源 = fs.readFileSync(path.join(ROOT, "conformance/codes.mjs"), "utf8");

// 承认的现实：那是一份 JS 模块，而不是数据文件。
// 与其为了读它而引一个 import（要它的导出形状），不如按行扫——
// 而这也让这个工具在 codes.mjs 语法还没成形时仍能跑。
const 条目们 = [];
for (const 行 of 源.split("\n")) {
  // 编号那一栏不能限定成 [A-Z0-9-]：2026-11-02 换码之后它是 HMYR-詞-001 这样的形状，
  // 层名是汉字。写成「引号里的一串」才对两种都认。
  const m = /\{ code: "([^"]+)", stage: "([a-z]+)"([^}]*)/.exec(行);
  if (!m) continue;
  const rest = m[3];
  const 含义 = /meaning: "([^"]*)"/.exec(rest);
  const 验 = /checkedBy: "([^"]*)"/.exec(rest);
  条目们.push({
    code: m[1],
    stage: m[2],
    内部: /internal: true/.test(rest),
    预留: /planned: true/.test(rest),
    meaning: 含义 ? 含义[1] : "",
    checkedBy: 验 ? 验[1] : "",
  });
}

// 按编号排序：编号是稳定的，于是输出也是稳定的（能 diff、能贴给人看）。
条目们.sort((a, b) => a.code.localeCompare(b.code));

const 参 = process.argv.slice(2);
const 名 = 参[0] || "";

if (名 === "") {
  console.log("  这一份共 " + 条目们.length + " 个编号。按层分：");
  for (const 组 of [["HMYR-詞", "词法"], ["HMYR-形", "语法"], ["HMYR-載", "装载"], ["HMYR-機", "机器"], ["HMYR-行", "运行时"], ["HMYR-內", "内置"], ["HMYR-碼", "字节码"]]) {
    const 属于 = 条目们.filter((e) => e.code.startsWith(组[0] + "-"));
    console.log("    " + 组[1] + "（" + 属于.length + " 个）：" + 属于.map((e) => e.code.replace("HMYR-", "")).join(" "));
  }
  console.log("\n  给一个编号看细节，或给一个词去搜：node tools/helper.mjs <编号|词>");
  process.exit(0);
}

if (/^HMYR-[^\s]+$/.test(名)) {
  const 目 = 条目们.find((e) => e.code === 名);
  if (!目) {
    console.log("  没有这个编号：" + 名);
    console.log("  相近的有：" + 条目们.filter((e) => e.code.includes(名.replace("HMYR-", ""))).map((e) => e.code).slice(0, 6).join(" ") || "无");
    process.exit(1);
  }
  const 阶段 = { lex: "词法", parse: "语法", link: "链接", run: "求值", host: "宿主", tool: "工具", check: "检查" }[目.stage] || 目.stage;
  console.log("  " + 目.code + "    " + 阶段);
  if (PLAIN[目.code]) console.log("  说人话  " + PLAIN[目.code]);
  console.log("  原文  " + 目.meaning);
  if (目.checkedBy) console.log("  谁在验  " + 目.checkedBy);
  if (目.内部) console.log("  这一类   实现内部的故障：一个程序不该故意触发它。撞上它通常意味着前面的输入已经坏了。");
  if (目.预留) console.log("  这一类   预留：规则还没实现，于是它现在还不会出现。");
  console.log("  怎么办  先看代码里冒出来的那个编号对应的「含义」那一句；");
  console.log("          再拿它去搜 design/ 里提过它的地方：grep -rn " + 目.code + " design/");
  process.exit(0);
}

// 按词搜：含义里有它就列出来
// 两个方向都搜：中文人话与英文原文。人打来的词可能是任一边。
const 命中 = 条目们.filter((e) =>
  e.meaning.toLowerCase().includes(名.toLowerCase()) ||
  (PLAIN[e.code] && PLAIN[e.code].includes(名)));
console.log("  「" + 名 + "」命中 " + 命中.length + " 个编号：");
for (const e of 命中) {
  console.log("    " + e.code.padEnd(12) + (PLAIN[e.code] ? PLAIN[e.code] : e.meaning));
}
if (命中.length === 0) {
  // 没命中不空手回去：把全部编号列出来，人总能从里面认出一个。
  // 而这也说明编号表缺一句中文人话——那是下一步要补的数据，不是这个工具的毛病。
  console.log("  没有命中。全部编号在这儿，也许要的词在英文那一侧：");
  for (const e of 条目们) console.log("    " + e.code.padEnd(12) + e.meaning);
}
process.exit(命中.length > 0 ? 0 : 1);
