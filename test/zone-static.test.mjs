// 三区模型的编译期那一半：design/MEMORY.txt 第一条硬规则的第二个半句。
//
// 那条规则写着「没有转换就是编译错误，不是未定义行为」。运行期那一半有编号
// （HMYR-碼-002 / HMYR-碼-003，见 test/zone.test.mjs 十六项），而这一套验的是装载时那一半：
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
  ok("编号是 HMYR-碼-001（那个码原来登记成 planned）", 错[0] && 错[0].code === "HMYR-碼-001", String(错[0] && 错[0].code));
  ok("点名了变量与 arena", /'b'/.test(错[0] ? 错[0].message : "") && /'a'/.test(错[0] ? 错[0].message : ""), 错[0] ? 错[0].message : "");
  ok("说了该调 freeze", /freeze/.test(错[0] ? 错[0].message : ""), 错[0] ? 错[0].message : "");
  ok("位置指得回去", 错[0] && 错[0].line > 0, String(错[0] && 错[0].line));
}

console.log("二、直接返回一块新分配也算逃逸");
{
  const 出 = 查(行们(["fn make() -> Int {", "  let a = arena()", "  return a.alloc(16)", "}"]));
  ok("一条错", 出.filter((d) => d.severity === "error" && d.code === "HMYR-碼-001").length === 1, JSON.stringify(出));
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
  ok("编号是 HMYR-載-016", 出[0] && 出[0].code === "HMYR-載-016", String(出[0] && 出[0].code));
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
  ok("诊断里有 HMYR-碼-001", 单.diagnostics.errors.some((e) => e.code === "HMYR-碼-001"),
    JSON.stringify(单.diagnostics.errors.map((e) => e.code + " " + e.message).slice(0, 2)));
  // 这里不要求 order 为空：加载器对语法错也不那样做（「有抱怨也收下」是它既有的语义，
  // 见 visit 的 import 循环）。判据落在「拦它的是区那一条」上，不替 loader 重定义。
  ok("没有别的错混进来", 单.diagnostics.errors.every((e) => e.code === "HMYR-碼-001"),
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
  // 判据说的是「整仓」，所以这里不只 self/。跳过的东西写清楚：点开头的目录、node_modules、
  // 以及 dist 与 build（那里是产物，不是源码）。
  const 收 = (根, 出 = [], 深 = 0) => {
    if (深 > 3) return 出;
    for (const e of fs.readdirSync(根, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist" || e.name === "build") continue;
      const p = path.join(根, e.name);
      if (e.isDirectory()) 收(p, 出, 深 + 1);
      else if (e.name.endsWith(".hmoca")) 出.push(p);
    }
    return 出;
  };
  const 份们 = 收(ROOT).sort();
  let 错误数 = 0, 警告数 = 0, 读不动 = 0;
  const 首个 = [];
  for (const p of 份们) {
    let 出 = [];
    try { 出 = 查(fs.readFileSync(p, "utf8")); } catch { 读不动++; continue; }
    if (出.length) 首个.push({ p: path.relative(ROOT, p), 出: 出.slice(0, 2) });
    错误数 += 出.filter((d) => d.severity === "error").length;
    警告数 += 出.filter((d) => d.severity === "warning").length;
  }
  ok(份们.length + " 份 .hmoca 零错误", 错误数 === 0, JSON.stringify(首个.slice(0, 3)));
  // 警告单列，口径写在这里：bench/realtime-callback.hmoca 把一个块交给实时回调，
  // 于是 HMYR-載-018 会响 —— 而那正是那个基准要的形状（回调必须拿到事先分好的内存）。
  // 「零错误」是底线，「零警告」不是：一条为了形状而存在的警告不该被当成误报。
  ok("警告数在预期之内（1 条：基准里的实时回调收一个块）", 警告数 <= 1, String(警告数));
  // 「读不动」不算误报（子集那一层认的窄），但它也不该被当成「检查过了」。
  ok("没有一份是读不动而跳过的", 读不动 === 0, String(读不动));
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
  ok("说的是 HMYR-碼-001", (甲.stderr || "").includes("HMYR-碼-001"), JSON.stringify((甲.stderr || "").slice(0, 100)));
  // 拒绝要发生在交给解释器之前：解释器对 arena 的回答是「这台机器没有」，而那句话
  // 会让「逃逸」看起来像「还没实现」。
  ok("没走到解释器那句「这台机器没有 arena」", !((甲.stdout || "") + (甲.stderr || "")).includes("HMYR-行-005"),
    JSON.stringify(((甲.stdout || "") + (甲.stderr || "")).slice(0, 100)));

  // 开关的意义是「这一次不检查」，不是「产出某一段输出」。所以判据是「不再被 HMYR-碼-001 拦」，
  // 而不是某个具体读数 —— 2026-10-27 之前这里等的是解释器那句「这台机器没有 arena」，
  // 而区在自举层有了之后，那句话不再出现，判断也就不能再押在它身上。
  const 乙 = 跑(["--no-zone-check", 逃]);
  ok("开关能把它放过去", 乙.status === 0 && !((乙.stdout || "") + (乙.stderr || "")).includes("HMYR-碼-001"),
    JSON.stringify({ status: 乙.status, out: ((乙.stdout || "") + (乙.stderr || "")).slice(0, 120) }));

  const 普 = 投(行们(["fn main() -> Int {", '  print("照跑" + chr(10))', "  return 0", "}"]), "主普.hmoca");
  const 丙 = 跑([普]);
  ok("普通程序照跑", (丙.stdout || "").includes("照跑"), JSON.stringify((丙.stdout || "").slice(0, 80)));

  // 缺口二：字节码编译器原来不认方法调用（只认按名字调用），于是 --compile 这一路
  // 会露出栈。2026-10-27 补上 CALLM 之后它编得过 —— 判据因此从「给一句编号」
  // 变成「编得过、而且没有栈」。当初那条「给编号」的判据是它还没修时写的，
  // 留着就成了「修好了反而红」，所以它跟着事实走。
  // 程序返回 0：--compile 那一面把 main 的返回值当退出码，返回 7 就会得到 status 7 ——
  // 那是它在跑通，不是它失败。判据要能在「退出码」与「拒绝」之间分清。
  const 编 = 跑(["--compile", 投(行们(["fn main() -> Int {", "  let a = arena()", "  let b = a.alloc(16)", "  return 0", "}"]), "主编.hmoca")]);
  ok("--compile 认得方法调用了", 编.status === 0, JSON.stringify({ status: 编.status, err: (编.stderr || "").slice(0, 120) }));
  ok("而且没有栈帧", !/(^|\n)\s+at /.test(编.stderr || ""), JSON.stringify((编.stderr || "").slice(0, 120)));
}

console.log("十、关掉之后那块不再可用，而借出去要看住");
{
  // 4.1 的原例里，close 之后接的是 b.size —— 「读它的字段」与「返回它」一样是碰了死内存，
  // 而运行期对那一下是不吭声的（块的 size 字段还在）。所以这条只能在装载时看。
  const 关后用 = 行们([
    "fn f() -> Int {",
    "  let a = arena()",
    "  let b = a.alloc(8)",
    "  a.close()",
    "  return b.size",
    "}",
  ]);
  ok("close 之后读字段给 HMYR-碼-001", 查(关后用).some((d) => d.code === "HMYR-碼-001" && d.severity === "error"), JSON.stringify(查(关后用)));

  // 交出去之后那块归托管，close 不带走它 —— 那正是 freeze 的意义，所以不该报。
  const 先交 = 行们([
    "fn f() -> Int {",
    "  let a = arena()",
    "  let b = a.alloc(8)",
    "  a.freeze(b)",
    "  a.close()",
    "  return b.size",
    "}",
  ]);
  ok("交出去之后 close 再用，不报", 查(先交).length === 0, JSON.stringify(查(先交)));

  // close 写在 if 里面时它可能没执行过，所以不算「上面已经关了」。漏报一种，比误报一种好。
  const 分支里 = 行们([
    "fn f(c: Int) -> Int {",
    "  let a = arena()",
    "  let b = a.alloc(8)",
    "  if c > 0 {",
    "    a.close()",
    "  }",
    "  return b.size",
    "}",
  ]);
  ok("分支里的 close 不算数", !查(分支里).some((d) => d.code === "HMYR-碼-001"), JSON.stringify(查(分支里)));

  // 4.2 的原例要一个模块级的可变变量，而语言里没有那种声明（顶层只有 fn / type / const /
  // effect / macro）。今天写得出来的近似是「把块交给别的函数」：那个函数的函数体不在这份
  // 源码里，没人保证它不把块留下。近似是保守的，所以它说警告，不说错误。
  const 交块 = 行们([
    "fn keep(x: Int) -> Int {",
    "  return x",
    "}",
    "fn f() -> Int {",
    "  let a = arena()",
    "  let b = a.alloc(8)",
    "  return keep(b)",
    "}",
  ]);
  ok("块交给别的函数给 HMYR-載-018", 查(交块).some((d) => d.code === "HMYR-載-018" && d.severity === "warning"), JSON.stringify(查(交块)));

  const 传字段 = 行们([
    "fn keep(x: Int) -> Int {",
    "  return x",
    "}",
    "fn f() -> Int {",
    "  let a = arena()",
    "  let b = a.alloc(8)",
    "  let n = keep(b.size)",
    "  a.close()",
    "  return n",
    "}",
  ]);
  ok("传字段不算传块", 查(传字段).length === 0, JSON.stringify(查(传字段)));

  // 4.2 的另一半：块被存进一条记录。记录可以交出去、可以返回，而区留在原地 ——
  // 那块就活过了它的区。这是原例（存到模块级变量）在今天写法里最近的形状。
  const 存记录 = 行们([
    "fn f() -> Int {",
    "  let a = arena()",
    "  let b = a.alloc(8)",
    "  let 盒 = { kept: b }",
    "  a.close()",
    "  return 0",
    "}",
  ]);
  ok("块存进记录给 HMYR-碼-004", 查(存记录).some((d) => d.code === "HMYR-碼-004" && d.severity === "error"), JSON.stringify(查(存记录)));

  const 存大小 = 行们([
    "fn f() -> Int {",
    "  let a = arena()",
    "  let b = a.alloc(8)",
    "  let 盒 = { 大小: b.size }",
    "  a.close()",
    "  return 0",
    "}",
  ]);
  ok("记录里存的是字段值就不报", 查(存大小).length === 0, JSON.stringify(查(存大小)));

  const 先交出 = 行们([
    "fn f() -> Int {",
    "  let a = arena()",
    "  let b = a.alloc(8)",
    "  a.freeze(b)",
    "  let 盒 = { kept: b }",
    "  return 0",
    "}",
  ]);
  ok("交出去之后再存进记录，不报", 查(先交出).length === 0, JSON.stringify(查(先交出)));

  // §4.2 的第二个形态，而且它比记录字面量更贴原例（kept = b）：块被写进一条索引。
  // 索引可变，所以它活得比这个函数久；而区不会 —— close 一到块就没了，索引里剩下一个死引用。
  const 存索引 = 行们([
    "fn f(表: Int) -> Int {",
    "  let a = arena()",
    "  let b = a.alloc(8)",
    "  index_set(表, \"kept\", b)",
    "  a.close()",
    "  return 0",
    "}",
  ]);
  ok("块存进索引给 HMYR-碼-004", 查(存索引).some((d) => d.code === "HMYR-碼-004"), JSON.stringify(查(存索引)));

  const 存索引值 = 行们([
    "fn f(表: Int) -> Int {",
    "  let a = arena()",
    "  let b = a.alloc(8)",
    "  index_set(表, \"size\", b.size)",
    "  a.close()",
    "  return 0",
    "}",
  ]);
  ok("索引里存的是字段值就不报", 查(存索引值).length === 0, JSON.stringify(查(存索引值)));
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
