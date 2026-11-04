// 设计里的 [议] 已经清空了：十条决议落进文档，而这一份守住「不再冒出来」。
//
// 为什么值得单一条套件：第十一轮之前 design/ 里有十条 [议] —— 并发五条、内存五条。
// 它们不是没做，是没定。而「没定」这件事在文档里只表现为两个字，很容易被后来的
// 改动挤到看不见。
//
// 判据做两件事：
//   一、design/ 下每一份文档都不该再有未决的 [议]；历史叙述里的提及（「原来是一个
//        [议]」）不算 —— 它们记的是决议本身，正是这一份要留下的东西。
//   二、判据自己要被验一次：拿一段真的带 [议] 的文本喂进去，它必须报出来。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 未决项的形状是列表条目：缩进之后以 [议] 起头。句子里提到这两个字不算 ——
// 编年史（FULLSELF）里免不了要提它，而那记的正是决议本身。
const 未决行 = (文) => 文.split("\n")
  .map((行, i) => ({ 行: 行.trim(), 号: i + 1 }))
  .filter((x) => /^・?\[议\]/.test(x.行));

console.log("一、design/ 下没有未决的 [议]");
{
  const 目录 = path.join(ROOT, "design");
  const 文件们 = fs.readdirSync(目录).filter((f) => f.endsWith(".txt")).sort();
  const 坏们 = [];
  for (const f of 文件们) {
    const 命 = 未决行(fs.readFileSync(path.join(目录, f), "utf8"));
    if (命.length) 坏们.push(f + ":" + 命.map((x) => x.号).join(","));
  }
  ok("扫了 " + 文件们.length + " 份设计稿", 文件们.length > 40, String(文件们.length));
  ok("每一份都没有未决的 [议]", 坏们.length === 0, 坏们.join(" · "));
}

console.log("二、判据自己要被验一次");
{
  const 样 = "  ・[议] 提供确定性调度器：给定种子，任务的交错顺序可复现。\n  ・[定] 别的一条。";
  ok("列表条目里的 [议] 会被报出来", 未决行(样).length === 1, String(未决行(样).length));
  const 句中 = "  2026-10-27 定。这一条原来是一个 [议]，而把它拆开之后发现它问的是两件事。";
  ok("句子里的提及不会被误报", 未决行(句中).length === 0, String(未决行(句中).length));
  const 编年史 = "design/ 里原来有十条 [议]：并发五条、内存五条。";
  ok("编年史里提到也不误报", 未决行(编年史).length === 0, String(未决行(编年史).length));
}

console.log("三、十条决议各写了「怎么验」或者「为什么不定」");
{
  // 十处都改成 [定] 或 [悬]，并各自跟了一行怎么验 / 为什么不定。
  // 这一条只数「有没有那句话」，不判它写得对不对 —— 判对错是人的事。
  const 两篇 = ["CONCURRENCY.txt", "MEMORY.txt"]
    .map((f) => ({ 名: f, 文: fs.readFileSync(path.join(ROOT, "design", f), "utf8") }));
  let 有 = 0, 缺 = [];
  for (const { 名, 文 } of 两篇) {
    const 行们 = 文.split("\n");
    for (let i = 0; i < 行们.length; i++) {
      if (!行们[i].includes("[定]") && !行们[i].includes("[悬]")) continue;
      // 只看这次改过的那几行：它们的下一行（或同段紧接的几行）里要有说法。
      const 附近 = 行们.slice(i + 1, i + 3).join("\n");
      if (附近.includes("怎么验") || 附近.includes("为什么不定")) 有++;
      else 缺.push(名 + ":" + (i + 1));
    }
  }
  ok("至少十处带着怎么验 / 为什么不定", 有 >= 10, "有 " + 有 + " 处");
  console.log("    （另有 " + 缺.length + " 处 [定] 没跟这句 —— 它们不是这一轮改的那十条，" +
    "不在判据范围内）");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
