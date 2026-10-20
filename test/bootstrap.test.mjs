// 引导的账：Stage 0 有多大，而它做哪三件事。
//
// 这一套钉的是数字与边界，不是愿望：
//   一、Stage 0 现在有两份账，因为启动器与工具走的不是同一条路
//   二、它读进来自举那一层：六份、一百二十三条声明
//   三、它不包含求值——求值在 self/ 里
//
// 两份账的分法：
//   启动器那一路   bin/hmyr.mjs 用子集那两层读自举层，于是那一路上没有 host lexer/parser
//   默认那一路     loadUnit 不传 reader 时仍是宿主的两层，工具与别的套件都走它
// 早先只有一笔账，是因为那时两路是同一路。换成两份账并不是把数字变好看，而是两件事本来就在发生。
//
// 数字变了它就会红。红的时候先读 design/BOOTSTRAP.txt。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 行数 = (相对) => fs.readFileSync(path.join(ROOT, 相对), "utf8").split("\n").length;
const 合行数 = (几份) => 几份.reduce((n, f) => n + 行数(f), 0);

console.log("一、两份账：启动器实际走的那一路，与工具默认走的那一路");
{
  const 启动路 = ["src/loader.mjs", "src/subset-lex.mjs", "src/subset-parse.mjs"];
  const 默认路 = ["src/loader.mjs", "src/lexer.mjs", "src/parser.mjs"];
  for (const 文 of new Set([...启动路, ...默认路])) {
    const n = 行数(文);
    ok(文 + " 在，且行数是 " + n, n > 20, String(n));
  }
  const 启动合 = 合行数(启动路), 默认合 = 合行数(默认路);
  console.log("    （启动器那一路 " + 启动合 + " 行 · 默认那一路 " + 默认合 + " 行）");
  ok("启动器那一路在四百五到八百之间", 启动合 > 450 && 启动合 < 800, String(启动合));
  ok("默认那一路在八百到一千之间", 默认合 > 800 && 默认合 < 1000, String(默认合));
  // 这一条是这件事的意义：换过去的理由是那一路更小，而它确实更小。
  ok("启动器那一路确实比默认那一路小", 启动合 < 默认合, 启动合 + " 对 " + 默认合);
  ok("而启动器里没有引宿主那两层", !/from "\.\.\/src\/(lexer|parser)\.mjs"/.test(fs.readFileSync(path.join(ROOT, "bin/hmyr.mjs"), "utf8")));
}

console.log("二、它读进来自举那一层：六份，一百二十三条声明");
{
  const u = loadUnit(path.join(ROOT, "self/run.hmyr"));
  ok("loadUnit 读得动", u.ok, JSON.stringify(u.diagnostics.errors.map((e) => e.code)));
  ok("带进六份文件", u.modules.size === 6, String(u.modules.size));
  let 声明 = 0;
  for (const m of u.modules.values()) 声明 += m.decls.length;
  ok("一百二十三条声明", 声明 === 123, String(声明));
}

console.log("三、求值不在 Stage 0 里（两份账都不在）");
{
  // 这一条是边界，不是行数：两条路上的每一份都不该出现求值器的东西。
  const 五份 = ["src/loader.mjs", "src/lexer.mjs", "src/parser.mjs", "src/subset-lex.mjs", "src/subset-parse.mjs"];
  for (const 文 of 五份) {
    const 字 = fs.readFileSync(path.join(ROOT, 文), "utf8");
    ok(文 + " 里没有 evalExpr / execStatement 之类", !字.includes("evalExpr") && !字.includes("execStatement"), "出现求值器符号");
  }
  // 而求值器确实在 self/ 里——那才是「怎么算」的答案所在。
  const 求值 = fs.readFileSync(path.join(ROOT, "self/eval.hmyr"), "utf8");
  ok("求值器在 self/eval.hmyr 里", 求值.includes("fn 求值(") && 求值.includes("fn 执行("), "在");
}

console.log("四、启动器只做三件事");
{
  const 文 = fs.readFileSync(path.join(ROOT, "bin/hmyr.mjs"), "utf8");
  ok("它把自举那一层读进来", 文.includes("loadUnit"), "在");
  ok("它递 argv", 文.includes("rt.argv"), "在");
  ok("它按退出码退出", 文.includes("process.exit"), "在");
  ok("而它不再读目标文件（那搬进 self/run.hmyr 了）", !文.includes("readFileSync"), "仍在读");
}

console.log("五、说明文档在，且说了「缩到零不在路线里」");
{
  const 文档 = path.join(ROOT, "design/BOOTSTRAP.txt");
  ok("design/BOOTSTRAP.txt 在", fs.existsSync(文档));
  const 文 = fs.readFileSync(文档, "utf8");
  ok("说了「Stage 0 不能为零」", 文.includes("不能为零"), "在");
  ok("说了「缩到零不在路线里」", 文.includes("缩到零不在路线里"), "在");
  ok("也写了数字会变", 文.includes("数字会变"), "在");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
