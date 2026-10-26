// 三区模型的编译期那一半：design/MEMORY.txt 第一条硬规则的第二个半句。
//
// 那条规则写着「没有转换就是编译错误，不是未定义行为」。运行期那一半有编号
// （R0302 / R0303，见 test/zone.test.mjs 十六项），而这一套验的是装载时那一半：
//
//   一、逃逸报出来，而且说得出是哪个变量、哪个 arena、该调什么（§4.1）
//   二、来回都合法的那几种写法一条都不报 —— 检查器的价值在于不误报
//   三、循环里新建 arena 给警告，循环外不报（§4.4）
//   四、装载器真的拦：不是「工具能跑」，是「这条路走不过去」
//   五、逃生口存在且有效
//   六、整仓 .hmoca 零诊断 —— 一条会误报的检查会被关掉，而关掉的检查等于没有
//
// 不验的：跨函数的逃逸、记录字段里存的块、4.2 的静默换区。
// 前两条要类型与跨函数分析，第三条要语言里先有「能存它的地方」（顶层 var 今天不是一种声明）。
// 这一句话写在 src/zone-check.mjs 的文件头，也写在这里：漏报与没做，都应该看得见。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { 切 } from "../src/subset-lex.mjs";
import { 子集解 } from "../src/subset-parse.mjs";
import { 区检查 } from "../src/zone-check.mjs";
import { loadUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-zone-"));
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 查 = (源码) => 区检查(子集解(切(源码)).ast);
const 行们 = (v) => v.join("\n") + "\n";

console.log("一、逃逸报出来，而且说得出怎么办");
{
  const 源 = 行们([
    "fn make() -> Int {",
    "  let a = arena()",
    "  let b = a.alloc(16)",
    "  a.close()",
    "  return b",
    "}",
  ]);
  const 出 = 查(源);
  const 错 = 出.filter((d) => d.severity === "error");
  ok("一条错", 错.length === 1, JSON.stringify(出));
  ok("编号是 R0301（那个码原来登记成 planned）", 错[0] && 错[0].code === "HMYR-R0301", String(错[0] && 错[0].code));
  ok("点名了变量与 arena", /'b'/.test(错[0] ? 错[0].message : "") && /'a'/.test(错[0] ? 错[0].message : ""), 错[0] ? 错[0].message : "");
  ok("说了该调 freeze", /freeze/.test(错[0] ? 错[0].message : ""), 错[0] ? 错[0].message : "");
  ok("位置指得回去", 错[0] && 错[0].line > 0, String(错[0] && 错[0].line));
}

console.log("二、直接返回一块新分配也算逃逸");
{
  const 出 = 查(行们(["fn make() -> Int {", "  let a = arena()", "  return a.alloc(16)", "}"]));
  ok("一条错", 出.filter((d) => d.severity === "error" && d.code === "HMYR-R0301").length === 1, JSON.stringify(出));
}

console.log("三、来回都合法的写法，一条都不报");
{
  const 例 = [
    ["交出去之后返回它", ["fn f() -> Int {", "  let a = arena()", "  let b = a.alloc(16)", "  a.freeze(b)", "  return b", "}"]],
    ["返回块的大小（不是块）", ["fn f() -> Int {", "  let a = arena()", "  let b = a.alloc(16)", "  return b.size", "}"]],
    ["用完就关，返回常数", ["fn f() -> Int {", "  let a = arena()", "  let b = a.alloc(8)", "  a.close()", "  return 0", "}"]],
    ["交出去又收回，收回后再交出去", ["fn f() -> Int {", "  let a = arena()", "  let b = a.alloc(8)", "  a.freeze(b)", "  a.adopt(b)", "  a.freeze(b)", "  return b", "}"]],
    ["压根不用 arena", ["fn f() -> Int {", "  return 7", "}"]],
  ];
  for (const [标, 源] of 例) {
    const 出 = 查(行们(源));
    ok(标 + "：零诊断", 出.length === 0, JSON.stringify(出));
  }
}

console.log("四、循环里新建 arena：警告，不是错（§4.4）");
{
  const 源 = 行们([
    "fn f() -> Int {",
    "  var i = 0",
    "  while i < 3 {",
    "    let c = arena()",
    "    c.close()",
    "    i = i + 1",
    "  }",
    "  return 0",
    "}",
  ]);
  const 出 = 查(源);
  ok("一条警告", 出.length === 1 && 出[0].severity === "warning", JSON.stringify(出));
  ok("编号是 W0310", 出[0] && 出[0].code === "HMYR-W0310", String(出[0] && 出[0].code));
  ok("说的是「每轮新建一个」", /loop/.test(出[0] ? 出[0].message : ""), 出[0] ? 出[0].message : "");

  const 外 = 查(行们(["fn f() -> Int {", "  let a = arena()", "  a.close()", "  return 0", "}"]));
  ok("循环外不报", 外.length === 0, JSON.stringify(外));
}

console.log("五、装载器真的拦：这条路走不过去");
{
  const 逃 = path.join(临, "逃逸.hmoca");
  fs.writeFileSync(逃, 行们(["fn make() -> Int {", "  let a = arena()", "  let b = a.alloc(16)", "  return b", "}"]), "utf8");
  const 单 = loadUnit(逃);
  ok("装载结果是失败", 单.ok === false, JSON.stringify({ ok: 单.ok, errors: 单.diagnostics.errors.map((e) => e.code) }));
  ok("诊断里有 R0301", 单.diagnostics.errors.some((e) => e.code === "HMYR-R0301"),
    JSON.stringify(单.diagnostics.errors.map((e) => e.code + " " + e.message).slice(0, 2)));
  // 这里不要求 order 为空：加载器对语法错也不那样做（「有抱怨也收下」是它既有的语义，
  // 见 visit 的 import 循环）。判据落在「拦它的是区那一条」上，不替 loader 重定义。
  ok("没有别的错混进来", 单.diagnostics.errors.every((e) => e.code === "HMYR-R0301"),
    JSON.stringify(单.diagnostics.errors.map((e) => e.code)));

  const 好 = path.join(临, "好.hmoca");
  fs.writeFileSync(好, 行们(["fn make() -> Int {", "  let a = arena()", "  let b = a.alloc(16)", "  a.freeze(b)", "  return b", "}"]), "utf8");
  const 单好 = loadUnit(好);
  ok("交出去的那一份装得进来", 单好.ok === true, JSON.stringify(单好.diagnostics.errors.map((e) => e.code)));
}

console.log("六、逃生口存在且有效");
{
  // 一条误报会把整条路堵死，而堵死之后人只会去改加载器。所以开关必须在，而且必须真能关。
  const 逃 = path.join(临, "逃逸.hmoca");
  const 关 = loadUnit(逃, { zoneCheck: false });
  ok("关掉之后装得进来", 关.ok === true, JSON.stringify(关.diagnostics.errors.map((e) => e.code)));
}

console.log("七、整仓源码零诊断");
{
  const 份们 = fs.readdirSync(path.join(ROOT, "self")).filter((x) => x.endsWith(".hmoca")).sort();
  let 总数 = 0;
  const 首个 = [];
  for (const 名 of 份们) {
    const 源 = fs.readFileSync(path.join(ROOT, "self", 名), "utf8");
    const 出 = 查(源);
    if (出.length) 首个.push({ 名, 出: 出.slice(0, 2) });
    总数 += 出.length;
  }
  ok(份们.length + " 份 self/*.hmoca 零诊断", 总数 === 0, JSON.stringify(首个.slice(0, 2)));
}

console.log("八、检查器自己不抛");
{
  ok("null 交回空表", Array.isArray(区检查(null)) && 区检查(null).length === 0);
  ok("没有 decls 的树交回空表", 区检查({ kind: "Module" }).length === 0);
  ok("空函数体不抛", 查(行们(["fn f() -> Int {", "  return 0", "}"])).length === 0);
}

console.log("九、启动器：默认这条路也拦，而它不挡别人");
{
  // 默认这条路把解析交给了自举层，所以检查要在交出去之前做 —— 见 bin/hmyr.mjs 那段注释。
  // 判据不能只有「一跑就红」：那样把启动器整个弄坏也满足。所以要有一条「普通程序照跑」。
  const 具 = path.join(ROOT, "bin", "hmyr.mjs");
  const 投 = (内容, 名) => { const p = path.join(临, 名); fs.writeFileSync(p, 内容, "utf8"); return p; };
  const 跑 = (参) => spawnSync(process.execPath, [具, ...参], { encoding: "utf8", cwd: 临, timeout: 180000 });

  const 逃 = 投(行们(["fn main() -> Int {", "  let a = arena()", "  let b = a.alloc(16)", "  return b", "}"]), "主逃.hmoca");
  const 甲 = 跑([逃]);
  ok("默认路径拒绝它", 甲.status !== 0, JSON.stringify({ status: 甲.status }));
  ok("说的是 R0301", (甲.stderr || "").includes("HMYR-R0301"), JSON.stringify((甲.stderr || "").slice(0, 100)));
  // 拒绝要发生在交给解释器之前：解释器对 arena 的回答是「这台机器没有」，而那句话
  // 会让「逃逸」看起来像「还没实现」。
  ok("没走到解释器那句「这台机器没有 arena」", !((甲.stdout || "") + (甲.stderr || "")).includes("R0104"),
    JSON.stringify(((甲.stdout || "") + (甲.stderr || "")).slice(0, 100)));

  const 乙 = 跑(["--no-zone-check", 逃]);
  ok("开关能把它放过去", /R0104/.test((乙.stdout || "") + (乙.stderr || "")), JSON.stringify((乙.stdout || "").slice(0, 80)));

  const 普 = 投(行们(["fn main() -> Int {", '  print("照跑" + chr(10))', "  return 0", "}"]), "主普.hmoca");
  const 丙 = 跑([普]);
  ok("普通程序照跑", (丙.stdout || "").includes("照跑"), JSON.stringify((丙.stdout || "").slice(0, 80)));

  // 缺口二的一个半边：字节码编译器不认方法调用（它只认按名字调用），这本是它的实现限制。
  // 而那条错原来不带码，于是 --compile 这一路会露出栈 —— 崩了也退出非零，
  // 所以只看退出码会把「说了一句编号」与「栈」混成同一件事。判据落在有没有栈帧上。
  const 编 = 跑(["--compile", 投(行们(["fn main() -> Int {", "  let a = arena()", "  let b = a.alloc(16)", "  return 7", "}"]), "主编.hmoca")]);
  ok("--compile 上给的是编号而不是栈", (编.stderr || "").includes("HMYR-R0110"), JSON.stringify((编.stderr || "").slice(0, 120)));
  ok("而且没有栈帧", !/(^|\n)\s+at /.test(编.stderr || ""), JSON.stringify((编.stderr || "").slice(0, 120)));
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
