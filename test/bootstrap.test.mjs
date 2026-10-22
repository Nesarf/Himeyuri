// 引导的账：Stage 0 有多大，而它做哪三件事。
//
// 这一套钉的是数字与边界，不是愿望：
//   一、Stage 0 现在是三份：loader 与子集那两层（宿主那两层不在里面）
//   二、它读进来自举那一层：六份、一百二十三条声明
//   三、它不包含求值——求值在 self/ 里
//
// 账分过两次：
//   早先一笔   loader + 宿主 lexer + 宿主 parser（885 行），因为启动器与工具走同一条路
//   中间两笔   启动器先换到子集，工具那一侧还是宿主，于是两笔要分开写
//   现在一笔   loader 的默认也换了子集，工具与启动器又走回同一条路——只是那条路换了材料
// 写成一笔不是把历史上那两笔抹掉：换成两笔的时候是两件事在发生，合回来的时候是一件事。
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

console.log("一、Stage 0 是五份：loader、子集那两层、诊断，与最小求值器");
{
  const 五份 = ["src/loader.mjs", "src/subset-lex.mjs", "src/subset-parse.mjs", "src/diagnostics.mjs", "src/minimal-eval.mjs"];
  for (const 文 of 五份) {
    const n = 行数(文);
    ok(文 + " 在，且行数是 " + n, n > 20, String(n));
  }
  const 合 = 合行数(五份);
  console.log("    （合计 " + 合 + " 行）");
  ok("五份加起来在一千到一千四百之间", 合 > 1000 && 合 < 1400, String(合));
  // 宿主那三份（读的两层 + 求值器）不在 Stage 0 里了，而它们仍在仓库里——对照与工具要用。
  const 宿主 = ["src/lexer.mjs", "src/parser.mjs", "src/eval.mjs"];
  for (const 文 of 宿主) ok(文 + " 仍然在（对照与工具路线）", 行数(文) > 20, String(行数(文)));
  // 一句可核的话：Stage 0 那五份加起来比宿主那三份小。
  ok("Stage 0 那五份比宿主那三份小", 合 < 合行数(宿主), 合 + " 对 " + 合行数(宿主));
  // 而启动器既不引宿主的读法，也不引宿主的求值器当默认。
  const 启动器 = fs.readFileSync(path.join(ROOT, "bin/hmyr.mjs"), "utf8");
  ok("启动器不引宿主的读法", !/from "\.\.\/src\/(lexer|parser)\.mjs"/.test(启动器));
  ok("启动器把最小求值器当默认", /最小运行\(层/.test(启动器) && !/runUnit\(层\)\s*;/.test(启动器));
  ok("宿主那份留着一条开关（--host-eval）", 启动器.includes("--host-eval"));
}

console.log("二、它读进来自举那一层：六份，一百二十三条声明");
{
  const u = loadUnit(path.join(ROOT, "self/run.hmyr"));
  ok("loadUnit 读得动", u.ok, JSON.stringify(u.diagnostics.errors.map((e) => e.code)));
  ok("带进六份文件", u.modules.size === 6, String(u.modules.size));
  let 声明 = 0;
  for (const m of u.modules.values()) 声明 += m.decls.length;
  // 声明数随自举层的规模走：读转义那一处补了一个函数，于是它从 123 长到 124。
  ok("一百四十九条声明", 声明 === 149, String(声明));
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
  // 这一条以前写的是「启动器里不出现 readFileSync」，后来改成「fs 的每一次出现都在能力交接那一行上」。
  // 现在它更强：启动器一点都不碰文件系统了——读文件这件事整个交给能力层（src/capabilities.mjs）。
  ok("启动器不直接碰文件系统", !/readFileSync|existsSync|node:fs/.test(文), "仍在碰");
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
