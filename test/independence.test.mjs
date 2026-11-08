// 「完全独立化」的总验收：证据要汇成一条命令，不然「齐了」只是一句自述。
//
// 这一套不重复那些证据（种子有 seed、世界面有 builtin-gap、工具账本有
// tooling-ledger、运行时路径有 runtime-path）。它只验一件事：
// 那条命令跑出来的表，五条都在，而且结论那一行说的是「齐了」。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const r = spawnSync("node", [path.join(ROOT, "tools/independence.mjs")], { encoding: "utf8", cwd: ROOT });
const 出 = String(r.stdout || "");
const 行 = (名) => {
  const m = new RegExp("^\\s*" + 名 + "\\s+(.*)$", "m").exec(出);
  return m ? m[1].trim() : "";
};

console.log("一、那条命令跑得动");
ok("退出码是零", r.status === 0, String(r.status) + " " + String(r.stderr).slice(0, 160));
ok("输出不为空", 出.trim().length > 0, "");

console.log("二、五条都在，而且各自有内容");
ok("种子那一行有字节数", /^\d+ 字节，HMYRB$/.test(行("种子")), 行("种子"));
ok("世界面那行说差零", 行("世界面").includes("差 0 格"), 行("世界面"));
ok("工具账本那行点了项数与两种状态", /^\d+ 项：搬了 \d+，不搬 \d+/.test(行("工具账本")), 行("工具账本"));
ok("运行时路径那行说零工具", 行("运行时路径").includes("零工具"), 行("运行时路径"));

console.log("三、结论说的是「齐了」，而不是「差不多了」");
{
  const 结论 = 行("结论");
  // 2026-11-04：结论从「近读法齐了」改成「六条性质今天都成立」。
  // 改的理由不是措辞 —— 「齐了」说的是「差 0 格」，而格子是自己画的两个数；
  // 六条性质各自指着一个能被推翻的判据，写在 design/INDEPENDENCE.txt。
  ok("结论说六条性质都成立", 结论.includes("六条性质今天都成立"), 结论);
  ok("结论点了六条的名字", 结论.includes("种子自足") && 结论.includes("三台同答案"), 结论);
  ok("结论指向那份定义", 结论.includes("design/INDEPENDENCE.txt"), 结论);
  ok("没有「没结清」的字样", !结论.includes("没结清"), 结论);
}

console.log("四、那几格的话是能查的（SELFRUN 里真有）");
{
  const 文 = fs.readFileSync(path.join(ROOT, "design/SELFRUN.txt"), "utf8");
  ok("SELFRUN 写了六处对齐的数", 文.includes("自举 64") && 文.includes("宿主 64"), "");
  ok("SELFRUN 写了两种读法的判据", 文.includes("近的那一种") || 文.includes("近读法"), "");
}

console.log("五、第四段那张分类表：与实测一致，而且盖住全部");
{
  // 为什么要有这一节：design/INDEPENDENCE.txt 第七节把 src/ 与 vm/ 分成五类，
  // 每类都写了份数与行数。那是四段路线第四段的进度表 —— 而表里的数字如果没人看，
  // 它就只是文字。这一节按同一套规则重算一遍，与文档里写的比。
  // 口径见 design/CHECKING.txt 开头那节：数字可以变，变的时候改文档，判据不动。
  const 列文件 = (目录) => {
    const 出 = [];
    const 走 = (d) => {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const f = d + "/" + e.name;
        if (e.isDirectory()) 走(f); else 出.push(f);
      }
    };
    走(目录);
    return 出;
  };
  const 行数 = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").split("\n").length;
  const 算 = (列) => ({ 份: 列.length, 行: 列.reduce((n, f) => n + 行数(f), 0) });

  const src全部 = 列文件("src");
  const vm全部 = 列文件("vm");
  // 规则与文档里写的一致，靠前缀与文件名判定，不靠硬编码清单 ——
  // 将来加一份新的生成头文件，它自己会落进「生成的数据」那一类。
  const 生成 = vm全部.filter((f) => /pack_seed\.h$/.test(f) || /\/ucd-[^/]*\.h$/.test(f));
  const c机器 = vm全部.filter((f) => !生成.includes(f));
  const stage0 = ["src/loader.mjs", "src/subset-lex.mjs", "src/subset-parse.mjs", "src/diagnostics.mjs", "src/minimal-eval.mjs"];
  const 对照 = ["src/lexer.mjs", "src/parser.mjs", "src/eval.mjs"];
  const 其余 = src全部.filter((f) => !stage0.includes(f) && !对照.includes(f));

  const 实测 = {
    "生成的数据": 算(生成),
    "C 机器代码": 算(c机器),
    "Stage 0": 算(stage0),
    "对照实现": 算(对照),
    "其余 src": 算(其余),
  };

  const 文 = fs.readFileSync(path.join(ROOT, "design/INDEPENDENCE.txt"), "utf8");
  const 表 = {};
  for (const m of 文.matchAll(/^\s+(生成的数据|C 机器代码|Stage 0|对照实现|其余 src)\s+(\d+) 份\s+(\d+) 行/gm)) {
    表[m[1]] = { 份: Number(m[2]), 行: Number(m[3]) };
  }

  for (const 名 of Object.keys(实测)) {
    ok("文档里有「" + 名 + "」那一行", 表[名] !== undefined, "");
    if (!表[名]) continue;
    ok(名 + " 的份数与文档一致（写 " + 表[名].份 + "，实 " + 实测[名].份 + "）", 表[名].份 === 实测[名].份, "");
    ok(名 + " 的行数与文档一致（写 " + 表[名].行 + "，实 " + 实测[名].行 + "）", 表[名].行 === 实测[名].行, "");
  }

  const 表之和 = Object.values(实测).reduce((n, x) => n + x.行, 0);
  const 实之和 = src全部.reduce((n, f) => n + 行数(f), 0) + vm全部.reduce((n, f) => n + 行数(f), 0);
  ok("五类加起来等于 src 与 vm 的总和（" + 表之和 + " 对 " + 实之和 + "）", 表之和 === 实之和, "");
  // 一条自明但不该省的：这一节要真能看出「有人改了代码没改文档」。
  // 改一个文件的行数就会红，红的是上面那两条「与文档一致」。
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
