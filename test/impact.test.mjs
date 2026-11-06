// 工程地图：改一个文件，该跑哪些套件 —— 把这句话从纪律变成可执行的一条。
//
// 为什么要有它：这一条以前写在纪律里（「改了这一层就跑全量」），靠人记。
// 而 tools/impact.mjs 早就算得出来，只是没有判据盯着它算得对不对。
// 这一套盯四件：
//   一、地图报的套件数与套件清单一致（两张表不会各自漂）；
//   二、会进字节产物的那几类一律报全量（那条边绕过 import 图，地图看不见它）；
//   三、给出的每一个名字都真的是一个套件（没有拼错、没有过期的名字）；
//   四、src 那几份说得出自己要碰谁（地图本身没坏）。
//
// 2026-11-06 改的是取数方式，不是判据。原来每问一个路径起一次子进程（一共十六次），
// 而每次都要重建整张图 —— 扫全仓 .hmoca、读每一份、解 import。图在两次调用之间
// 一个字都没变，所以那不是十六次测量，是同一次测量做了十六遍。
// 现在 --suites 吃多个路径：一个路径一行，行内逗号分隔。两次子进程就够了。
// 判据的标签与含义一条没动，只多了一条「问几个就答几行」—— 那是批量形态自己的判据。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 跑 = (...参) => execFileSync(process.execPath, [path.join(ROOT, "tools/impact.mjs"), ...参], { encoding: "utf8" }).trim();
const 清单 = fs.readFileSync(path.join(ROOT, "tools/suite-list.txt"), "utf8")
  .split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.split("\t")[0].trim());

// 一次问完所有要问的路径。答出来的行数与问的个数一致，否则说明批量形态坏了，
// 而「行数对不上」会让后面每一条判据都拿着错位的名单去比 —— 所以先在这里停住。
const 路径集 = [
  "self/body.hmoca", "runtime/run.hmoks", "bootstrap/pack.hmtn", "vm/pack_seed.h", "bin/hmyr.mjs",
  "src/parser.mjs", "src/eval.mjs", "tools/impact.mjs",
  "tools/curve-batch.mjs", "src/vm.mjs", "tools/hmget.mjs",
];
const 问 = (路径组) => {
  const 出 = 跑("--suites", ...路径组).split("\n");
  const 表 = new Map();
  路径组.forEach((路, i) => 表.set(路, (出[i] || "").split(",").map((s) => s.trim()).filter(Boolean)));
  return { 表, 行数: 出.length };
};
const 批 = 问(路径集);
const 套件名 = (路) => 批.表.get(路) || [];

console.log("一、地图报的套件数与套件清单一致");
const 总图 = 跑("--map");
{
  const 头 = 总图.split("\n")[0];
  const 数 = Number((头.match(/(\d+)\s*个套件/) || [])[1] || -1);
  ok("地图报 " + 清单.length + " 个套件", 数 === 清单.length, 头);
}

console.log("");
console.log("一之二、批量形态：问几个路径就答几行");
{
  ok("一次问 " + 路径集.length + " 个路径交出 " + 路径集.length + " 行", 批.行数 === 路径集.length,
     "答了 " + 批.行数 + " 行");
  // 单路径的形态必须与从前一字不差：命令行上一条用惯了，
  // 而「$(node tools/impact.mjs X --suites)」还接在 check-all 后面。
  const 单 = 跑("src/parser.mjs", "--suites");
  ok("单个路径的输出与批量里的那一行相同", 单 === 批.表.get("src/parser.mjs").join(","),
     "单 " + 单.length + " 字");
}

console.log("");
console.log("二、会进字节产物的那几类一律报全量");
{
  // self/*.hmoca 的改动顺着 runtime/*.hmoks → bootstrap/pack.hmtn → vm/pack_seed.h
  // 扩散到每一个跑 C 那台的套件，而那条边不走 import —— 地图看不见它。
  // 实测的证人是 self/body.hmoca：只按 import 算，名单里没有 selfvmcompile，
  // 而那一套读的正是它的字节。
  for (const 路 of ["self/body.hmoca", "runtime/run.hmoks", "bootstrap/pack.hmtn", "vm/pack_seed.h", "bin/hmyr.mjs"]) {
    const 列 = 套件名(路);
    ok(路 + " 报全量（" + 列.length + " 套）", 列.length === 清单.length, String(列.length));
  }
}

console.log("");
console.log("三、给出的每一个名字都真的是一个套件");
{
  const 集 = new Set(清单);
  for (const 路 of ["src/parser.mjs", "src/eval.mjs", "self/body.hmoca", "tools/impact.mjs"]) {
    const 生 = 套件名(路).filter((n) => !集.has(n));
    ok(路 + " 的名单里没有陌生的名字", 生.length === 0, JSON.stringify(生.slice(0, 4)));
  }
}

console.log("");
console.log("四、src 那几份说得出自己要碰谁");
{
  // 这两条是「地图本身没坏」的锚：改 parser 会碰到 parser，改 eval 会碰到 contracts。
  // 它们不是精确清单（那会随着加套件漂），只是「这张图还认得那两个名字」。
  const 甲 = new Set(套件名("src/parser.mjs"));
  ok("改 parser.mjs 会碰到 parser", 甲.has("parser"), String(甲.size) + " 套");
  ok("改 parser.mjs 会碰到 selfcompile", 甲.has("selfcompile"), "");
  const 乙 = new Set(套件名("src/eval.mjs"));
  ok("改 eval.mjs 会碰到 eval", 乙.has("eval"), String(乙.size) + " 套");
  ok("改 eval.mjs 会碰到 contracts", 乙.has("contracts"), "");
}

console.log("");
console.log("五、被 spawn 出去的工具脚本也是一条边");
{
  // test/curve.test.mjs 是通过命令行参数调 tools/curve-batch.mjs 的，那里没有 import。
  // 地图原来的三条规则只收 .hmoca，于是这条边是隐形的 —— 改那个探针会答「没有套件」，
  // 而 curve 会红。第四种规则（收仓库内的 .mjs 路径）就是为它加的。
  const 丙 = new Set(套件名("tools/curve-batch.mjs"));
  ok("改 curve-batch.mjs 会碰到 curve", 丙.has("curve"), String(丙.size) + " 套");
  // 探针自己 import 的 src 也要算进来：改 vm.mjs 时 curve 会红，而地图原来不认得这条路。
  const 丁 = new Set(套件名("src/vm.mjs"));
  ok("改 vm.mjs 会碰到 curve", 丁.has("curve"), String(丁.size) + " 套");
  // 第三种写法：path.join(ROOT, "tools", "hmget.mjs")。路径被拆成两段，而上面那条
  // 正则只认整段字符串，于是它一度也看不见 —— 这是同一条边换的第二个形状。
  const 戊 = new Set(套件名("tools/hmget.mjs"));
  ok("改 hmget.mjs 会碰到 hmget（拆成两段的路径也认得）", 戊.has("hmget"), String(戊.size) + " 套");
}

console.log("");
console.log("六、预期表现：基线那一份与地图那一节对得上");
{
  // 地图第四节的数字读的是 tools/expected.json，不写在代码里 —— 数字会漂，
  // 所以这一节不盯数值（那会天天红），盯的是「它还在、还完整、还印得出来」。
  // 少了这几条，第四节早晚退回硬编码，而套件数已经摔过两次那种跤。
  const 基线 = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/expected.json"), "utf8"));
  ok("基线带着测于与环境", typeof 基线.测于 === "string" && typeof 基线.环境 === "string",
     String(基线.测于));
  ok("基线带着容差，而且是大于一的数", typeof 基线.容差倍数 === "number" && 基线.容差倍数 > 1,
     String(基线.容差倍数));
  ok("每一项都齐：名字、数值、单位、量法",
     Array.isArray(基线.项) && 基线.项.length > 0 &&
       基线.项.every((p) => p.名 && typeof p.值 === "number" && p.单位 && p.量法),
     JSON.stringify(基线.项.slice(0, 1)));
  ok("地图里有第四节", 总图.indexOf("四、预期表现") >= 0, "");
  const 缺 = 基线.项.filter((p) => 总图.indexOf(p.名) < 0).map((p) => p.名);
  ok("每一项都印在地图上", 缺.length === 0, JSON.stringify(缺));
  ok("量法也印出来了", 总图.indexOf(基线.项[0].量法) >= 0, "");
  // 对照那一段记的是「换字宽之前是多少」，最容易被当成旧账删掉，而它正是下一次
  // 判断的参照 —— 没有它，36.1 秒只是一个孤立数字。
  ok("对照至少留一条", Array.isArray(基线.对照) && 基线.对照.length > 0,
     String((基线.对照 || []).length));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
