// C 版虚拟机：同一份字节码，两台机器，同一个答案。
//
// 这一套的意思是「这门语言不再只有 JS 那一台机器」。它做三件事：
//   一、找一个 C 编译器（没有就明说跳过，不算失败 —— 那不是这门语言的问题）
//   二、把 vm/hmyr.c 编起来
//   三、对同一份源码，JS 那台与 C 那台各跑一遍，比输出
//
// 比输出而不是比值：值在这一层没有共同的表示，而输出是两边都要负责的东西。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { 写程序 } from "../src/code-file.mjs";
import { 虚拟机, 类元组, 类记录 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-cvm-"));

// 一、有没有编译器
const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc —— C 版虚拟机这一套不运行");
  console.log("");
  console.log("0 passed, 0 failed");
  fs.rmSync(临, { recursive: true, force: true });
  process.exit(0);
}

// 二、把它编起来
const exe = path.join(临, "hmyr-vm.exe");
{
  const r = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("vm/hmyr.c 编得出来", r.status === 0, String(r.stderr).slice(0, 200));
  ok("而且没有警告", String(r.stderr).trim() === "", String(r.stderr).slice(0, 200));
}
if (!fs.existsSync(exe)) {
  console.log("");
  console.log(passed + " passed, " + failed + " failed");
  fs.rmSync(临, { recursive: true, force: true });
  process.exit(1);
}

// 同一份源码：JS 那台跑内存里的字节码，C 那台跑文件里的字节码。
const 两侧跑 = (源码, 名字) => {
  const 源路 = path.join(临, 名字 + ".hmyr");
  fs.writeFileSync(源路, 源码, "utf8");
  const unit = loadUnit(源路);
  if (!unit.ok) return { 错: "加载失败 " + JSON.stringify(unit.diagnostics.errors.slice(0, 1).map((e) => e.code)) };
  const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))));

  let js出 = "";
  const vm = new 虚拟机(程序, {
    capabilities: 本机能力(),
    write: (s) => { js出 += s; },
  });
  const jsr = vm.调用("main", [], null);

  const 码路 = path.join(临, 名字 + ".hmyrb");
  fs.writeFileSync(码路, 写程序(程序));
  const c = spawnSync(exe, [码路], { encoding: "utf8" });

  return {
    js: js出, js码: jsr.ok ? jsr.值 : null,
    c: String(c.stdout || ""), c码: c.status,
  };
};

console.log("一、算数、递归、字符串、元组、记录");
{
  const 源码 = fs.readFileSync(path.join(ROOT, "examples/arith.hmyr"), "utf8");
  const r = 两侧跑(源码, "arith");
  ok("两台机器输出一样", r.js === r.c, JSON.stringify(r.js) + " 对 " + JSON.stringify(r.c));
  ok("输出里有算对的那个数", r.c.includes("42"), JSON.stringify(r.c));
  ok("递归也算对了", r.c.includes("120"), JSON.stringify(r.c));
}

console.log("二、比较、分支与逻辑");
{
  const 源码 = [
    "fn 分(n: Int) -> String {",
    '  if n < 0 { return "负" }',
    '  if n == 0 { return "零" }',
    '  return "正"',
    "}",
    "fn main() -> Int {",
    "  print(分(0 - 3))",
    "  print(分(0))",
    "  print(分(5))",
    "  let a = 1",
    "  let b = 2",
    '  if a == 1 && b == 2 { print(" 与") }',
    '  if a == 9 || b == 2 { print(" 或") }',
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "branch");
  ok("三分支都说对了", r.js === r.c && r.c.startsWith("负零正"), JSON.stringify(r.js) + " 对 " + JSON.stringify(r.c));
  // 与 / 或 以前在自举层根本解析不了：条件解析停在 && 上，报「语法层报的错：if」。
  ok("与和或都算得出来", r.c.includes(" 与 或"), JSON.stringify(r.c));
}

console.log("三、字符串上的东西");
{
  const 源码 = [
    "fn main() -> Int {",
    '  let s = "琥珀音"',
    "  print(str(len(s)))",
    "  print(s)",
    '  let t = "ab" + "cd"',
    "  print(t)",
    "  print(slice(t, 1, 3))",
    "  print(str(ord(s)))",
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "strings");
  ok("字符串那一套两边一样", r.js === r.c, JSON.stringify(r.js) + " 对 " + JSON.stringify(r.c));
  ok("中文原样出来", r.c.includes("琥珀音"), JSON.stringify(r.c));
}

console.log("四、坏文件要被拒绝，而不是跑出怪结果");
{
  const 坏 = path.join(临, "bad.hmyrb");
  fs.writeFileSync(坏, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  const r = spawnSync(exe, [坏], { encoding: "utf8" });
  ok("不是 .hmyrb 就拒绝", r.status !== 0, String(r.status));
  const 空 = path.join(临, "empty.hmyrb");
  fs.writeFileSync(空, Buffer.alloc(0));
  const r2 = spawnSync(exe, [空], { encoding: "utf8" });
  ok("空文件也拒绝", r2.status !== 0, String(r2.status));
}

console.log("五、自举层本身：HMYR 写的解释器，跑在 C 机器上");
{
  // 这一条是这一套存在的理由。self/run.hmyr 是「HMYR 写的解释器」，
  // 它自己的自测会真的解析并求值四段小表达式 —— 全是这台 C 机器在做，
  // 没有一步经过 JavaScript。
  const 码路 = path.join(临, "self.hmyrb");
  const emit = spawnSync(process.execPath, [path.join(ROOT, "tools/emit-code.mjs"),
    path.join(ROOT, "self/run.hmyr"), 码路], { encoding: "utf8" });
  ok("自举层编得出字节码", emit.status === 0 && fs.existsSync(码路), String(emit.stderr).slice(0, 200));
  if (fs.existsSync(码路)) {
    const r = spawnSync(exe, [码路], { encoding: "utf8", timeout: 60000 });
    const 出 = String(r.stdout || "");
    ok("C 机器跑得出自举层的自测", r.status === 0, String(r.status) + " " + String(r.stderr).slice(0, 120));
    ok("四段表达式的答案都对", 出.includes("1 + 2 * 3 → 7") && 出.includes("(1 + 2) * 3 → 9")
      && 出.includes('len("abcd") → 4') && 出.includes("10 % 4 → 2"), JSON.stringify(出.slice(0, 160)));
    ok("而且那四行就是全部输出", 出.trim().split("\n").length === 4, String(出.trim().split("\n").length));
  }
}

console.log("六、用这台机器跑一个 .hmyr 文件");
{
  // 这是「不依赖宿主」那句话该有的形状：C 跑自举层，自举层读一个 .hmyr、
  // 解析它、求值它。中间没有 JavaScript —— 上面第五节已经把字节码编好了。
  const 码路 = path.join(临, "self.hmyrb");
  if (fs.existsSync(码路)) {
    const r = spawnSync(exe, [码路, path.join(ROOT, "examples/twice.hmyr")], { encoding: "utf8", timeout: 60000 });
    const 出 = String(r.stdout || "");
    ok("C 机器跑通了一个 .hmyr 文件", r.status === 0, String(r.status) + " " + String(r.stderr).slice(0, 120));
    ok("那个文件算对了 21 乘 2", 出.includes("hi 42"), JSON.stringify(出.slice(0, 120)));
    ok("中文字符串也过得去", 出.includes("琥珀音"), JSON.stringify(出.slice(0, 120)));
  } else {
    ok("C 机器跑通了一个 .hmyr 文件", false, "把自举层编出来才能测这一条");
  }
}

console.log("七、真库跑在 C 机器上");
{
  // 这几条是「同一个 bug 追了三轮」的收尾：自举层替目标程序执行时，
  // C 那台的弹栈会越过帧基线，于是实参整体错位一格。
  // 修好之后，五个标准库的验收程序都能在 C 上跑出零。
  const 码路 = path.join(临, "self.hmyrb");
  const 库们 = [
    ["字符串库", "conformance/lib-strings.hmyr"],
    ["元组库", "conformance/lib-tuples.hmyr"],
    ["表库", "conformance/lib-tables.hmyr"],
    ["JSON 库", "conformance/lib-json.hmyr"],
    ["帧库", "conformance/lib-protocol.hmyr"],
  ];
  for (const [标, 路] of 库们) {
    if (!fs.existsSync(码路)) { ok(标 + "在 C 机器上全过", false, "没有自举层字节码"); continue; }
    const r = spawnSync(exe, [码路, path.join(ROOT, 路)], { encoding: "utf8", timeout: 120000, env: { ...process.env, HMYR_STEPS: "200000000" } });
    ok(标 + "在 C 机器上全过", r.status === 0 && String(r.stdout).trim() === "0",
      String(r.status) + " " + JSON.stringify(String(r.stdout).trim().slice(0, 40)) + " " + String(r.stderr).slice(0, 80));
  }
}

console.log("八、数字写成字，两台机器一字不差");
{
  // 这条以前是两台机器之间唯一被写下来的差异：C 用 %.15g，于是 0.1 写成
  // 0.100000000000000006。现在两边都走「最短往返 + ECMAScript 排版」。
  const 源码 = [
    "fn main() -> Int {",
    "  print(str(0))",
    '  print(" ")',
    "  print(str(1.5))",
    '  print(" ")',
    "  print(str(0.1))",
    '  print(" ")',
    "  print(str(0 - 2.25))",
    '  print(" ")',
    "  print(str(1000000))",
    '  print(" ")',
    "  print(str(0.000001))",
    '  print(" ")',
    "  print(str(123456789012345678))",
    '  print(" ")',
    "  print(str(1 / 3))",
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "numbers-text");
  ok("八个数两台写出来一样", r.js === r.c, JSON.stringify(r.js) + " 对 " + JSON.stringify(r.c));
  ok("0.1 不是那一长串", r.c.includes("0.1") && !r.c.includes("0.100000000000000006"), JSON.stringify(r.c));
  ok("三分之一是最短的那一串", r.c.includes("0.3333333333333333"), JSON.stringify(r.c));
}

console.log("九、效果声明在 C 上也管用");
{
  // 函数表里本来就带着每个函数声明的效果名，只是一直没人用。
  // 现在调用时往下核：被调者声明了什么，调用者就得先声明什么。
  const 临时 = path.join(临, "fx");
  fs.mkdirSync(临时, { recursive: true });
  const 路 = path.join(临时, "写.txt");
  const 源码 = [
    "fn 写(p: String) -> Int effects(file) {",
    '  return write_text(p, "x")',
    "}",
    "fn main() -> Int {",
    '  写("' + 路.replace(/\\/g, "/") + '")',
    "  return 0",
    "}",
  ].join("\n");
  const 源路 = path.join(临时, "fx.hmyr");
  fs.writeFileSync(源路, 源码, "utf8");
  const 码路 = path.join(临时, "fx.hmyrb");
  const emit = spawnSync(process.execPath, [path.join(ROOT, "tools/emit-code.mjs"), 源路, 码路], { encoding: "utf8" });
  ok("这个程序编得出来", emit.status === 0, String(emit.stderr).slice(0, 120));
  if (fs.existsSync(码路)) {
    const r = spawnSync(exe, [码路], { encoding: "utf8", timeout: 60000 });
    ok("没声明 file 的 main 调要 file 的函数被拒（R0201）", r.status !== 0 && String(r.stderr).includes("HMYR-R0201"),
      String(r.status) + " " + String(r.stderr).slice(0, 100));
    ok("而被拒的时候文件没有写出来", !fs.existsSync(路));
  }
}

console.log("十、大小写：表搬过来了，两台机器逐单元一样");
{
  // 两台机器对同一串文字该交出同一串单元。取样两批：一批是所有「映射之后会变」
  // 的码点（全码点扫过来，不是抽），一批是等距抽样（看「不该变的地方确实没变」）。
  // 每一行问五个问题：大写、小写、前面加一个带大小写的字母之后小写、
  // 后面加一个之后小写、以及大写。中间那三个问的是词尾那一条规则。
  const 会变 = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const 字 = String.fromCodePoint(cp);
    if (字.toUpperCase() !== 字 || 字.toLowerCase() !== 字) 会变.push(cp);
  }
  const 不变 = [];
  for (let cp = 0; cp <= 0x10ffff; cp += 311) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    不变.push(cp);
  }
  // 表里列出来的码点也要进样本：这样「表里有而宿主不认」的反方向也有机会现形。
  const 头文 = fs.readFileSync(path.join(ROOT, "vm/ucd-case.h"), "utf8");
  for (const m of 头文.matchAll(/\{0x([0-9A-F]+)u, \d+u, \{/g)) {
    const cp = parseInt(m[1], 16);
    if (!会变.includes(cp)) 会变.push(cp);
  }
  const 样本 = [...new Set([...会变, ...不变])];
  // 语料那一侧：直接从 data/ucd 读「每个码点换成什么」。这就是 C 那台该给的答案，
  // 而且是独立于生成器再读一遍 —— 生成器读错了字段，这里就会吵。
  const 转单元 = (cps) => {
    const 单 = [];
    for (const c of cps) {
      if (c <= 0xffff) 单.push(c);
      else { 单.push(0xd800 + ((c - 0x10000) >> 10)); 单.push(0xdc00 + ((c - 0x10000) & 0x3ff)); }
    }
    return 单;
  };
  const 语料上 = new Map();
  const 语料下 = new Map();
  for (const 行 of fs.readFileSync(path.join(ROOT, "data/ucd/UnicodeData.txt"), "utf8").split("\n")) {
    if (!行) continue;
    const 段 = 行.split(";");
    if (段.length < 15) continue;
    if (段[1].startsWith("<") && 段[1].includes(",")) continue;
    const cp = parseInt(段[0], 16);
    if (Number.isNaN(cp)) continue;
    const 拆 = (文) => 转单元(文.split(/\s+/).map((h) => parseInt(h, 16)));
    if (段[12].trim()) 语料上.set(cp, 拆(段[12].trim()));
    if (段[13].trim()) 语料下.set(cp, 拆(段[13].trim()));
  }
  for (const 行 of fs.readFileSync(path.join(ROOT, "data/ucd/SpecialCasing.txt"), "utf8").split("\n")) {
    const 净 = 行.split("#")[0].trim();
    if (!净) continue;
    const 段 = 净.split(";").map((s) => s.trim());
    if (段.length < 5 || 段[4] !== "") continue;      // 带条件的是地区规则，这门语言没有地区
    const cp = parseInt(段[0], 16);
    if (Number.isNaN(cp)) continue;
    const 拆 = (文) => (文 ? 转单元(文.split(/\s+/).map((h) => parseInt(h, 16))) : null);
    const 下 = 拆(段[1]);
    const 上 = 拆(段[3]);
    if (上) 语料上.set(cp, 上);
    if (下) 语料下.set(cp, 下);
  }
  const 清单 = path.join(临, "case-sample.txt");
  fs.writeFileSync(清单, 样本.join("\n") + "\n", "utf8");
  const 路径 = 清单.replace(/\\/g, "/");
  const 源码 = [
    "fn 单元们(s: String) -> String {",
    "  var i = 0",
    '  var 出 = ""',
    "  while i < len(s) {",
    '    if i > 0 { 出 = 出 + " " }',
    "    出 = 出 + str(ord(slice(s, i, i + 1)))",
    "    i = i + 1",
    "  }",
    "  return 出",
    "}",
    "fn main() -> Int effects(file) {",
    '  var 行们 = read_lines("' + 路径 + '")',
    "  var i = 0",
    "  while i < len(行们) {",
    "    var 字 = chr(to_int(行们[i]))",
    '    print(单元们(to_upper(字)) + " | " + 单元们(to_lower(字)) + " | " + 单元们(to_lower(chr(913) + 字)) + " | " + 单元们(to_lower(字 + chr(913))) + " | " + 单元们(to_upper(chr(913) + 字)) + "\\n")',
    "    i = i + 1",
    "  }",
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "case-fold");
  const 甲 = String(r.js || "").split("\n");
  const 乙 = String(r.c || "").split("\n");
  // 失败信息里只说第几行、哪个码点、哪一列 —— 不把字形印出来。
  const 哪列 = ["大写", "小写", "前有字母时小写", "后有字母时小写", "前面有字母时大写"];
  const 说一处 = (i) => {
    const 列甲 = String(甲[i] || "").split(" | ");
    const 列乙 = String(乙[i] || "").split(" | ");
    let 第 = -1;
    for (let k = 0; k < Math.max(列甲.length, 列乙.length); k++) if (列甲[k] !== 列乙[k]) { 第 = k; break; }
    return "第 " + i + " 行，码点 " + 样本[i] + "，" + (哪列[第] || 第 + " 列")
      + "；甲 " + JSON.stringify(列甲[第]) + " 乙 " + JSON.stringify(列乙[第]);
  };
  const 不同 = [];
  for (let i = 0; i < Math.max(甲.length, 乙.length); i++) if (甲[i] !== 乙[i]) 不同.push(i);
  // 单位串：拿码点直接算出串里的单元，用来写「什么都不该变」的期望。
  const 单元串 = (单元) => 单元.join(" ");
  const 未动 = (cp) => {
    const 甲一 = 单元串(转单元([cp]));
    return [甲一, 甲一, "945 " + 甲一, 甲一 + " 945", "913 " + 甲一].join(" | ");
  };
  const 语料错 = [];
  const 机器错 = [];
  const 缝 = [];
  const 缝错 = [];
  for (let i = 0; i < 样本.length; i++) {
    const cp = 样本[i];
    const 列乙 = String(乙[i] || "").split(" | ");
    const 语上 = 语料上.get(cp);
    const 语下 = 语料下.get(cp);
    if (语上 || 语下) {
      // 语料说的就是答案：大写、小写两列要一字不差地照它来。
      const 期上 = 语上 ? 单元串(语上) : 单元串(转单元([cp]));
      const 期下 = 语下 ? 单元串(语下) : 单元串(转单元([cp]));
      if (列乙[0] !== 期上 || 列乙[1] !== 期下) 语料错.push(i);
      if (甲[i] !== 乙[i]) 机器错.push(i);
    } else if (甲[i] !== 乙[i]) {
      // 语料没给它映射，而宿主认得（宿主是 Unicode 17.0，语料是 16.0）：
      // C 那台该一个字也不动。这条缝不藏，但要小到能量出来。
      缝.push(i);
      if (String(乙[i] || "").trim() !== 未动(cp)) 缝错.push(i);
    }
  }
  ok("语料里有映射的码点，C 那台照语料换", 语料错.length === 0, 语料错.length ? 说一处(语料错[0]) : "");
  ok("语料覆盖到的那些，连上下文那三列两台机器也一样", 机器错.length === 0, 机器错.length ? 说一处(机器错[0]) : "");
  ok("宿主比语料多认得的那些，C 一个字也不动（" + 缝.length + " 个）",
     缝错.length === 0, 缝错.length ? 说一处(缝错[0]) : "");
  ok("样本不是空跑", 乙.length > 5000, String(乙.length));

  // 词尾那一条规则单独钉住：同一个字母，位置不同形状就不同。
  const 单元们 = [
    "fn 单元们(s: String) -> String {",
    "  var i = 0",
    '  var 出 = ""',
    "  while i < len(s) {",
    '    if i > 0 { 出 = 出 + " " }',
    "    出 = 出 + str(ord(slice(s, i, i + 1)))",
    "    i = i + 1",
    "  }",
    "  return 出",
    "}",
  ];
  const 词尾 = [...单元们,
    "fn main() -> Int {",
    '  print(单元们(to_lower(chr(931))) + "\\n")',
    '  print(单元们(to_lower(chr(913) + chr(931))) + "\\n")',
    '  print(单元们(to_lower(chr(913) + chr(931) + chr(913))) + "\\n")',
    "  return 0",
    "}",
  ].join("\n");
  const 词 = 两侧跑(词尾, "case-final");
  const 行 = String(词.c || "").trim().split("\n");
  ok("单独一个 sigma 换成词中间那个形状", 行[0] === "963", JSON.stringify(行[0]));
  ok("前面有字母、后面没有，换成词尾那个形状", 行[1] === "945 962", JSON.stringify(行[1]));
  ok("前后都有字母，回到词中间那个形状", 行[2] === "945 963 945", JSON.stringify(行[2]));
  ok("词尾那三条两种走法都一样", 词.js === 词.c, JSON.stringify(词.js) + " 对 " + JSON.stringify(词.c));

  // 基本平面之外的字符：chr 该给出两个单元，ord 该读回整个码点。
  // 这两条以前在 C 上都是错的 —— chr 截成一个单元，ord 只读那一个单元。
  const 增补 = [
    "fn main() -> Int {",
    "  var 字 = chr(66560)",
    '  print(str(len(字)) + "\\n")',
    '  print(str(ord(字)) + "\\n")',
    '  print(str(ord(to_upper(字))) + "\\n")',
    '  print(str(ord(to_lower(字))) + "\\n")',
    "  return 0",
    "}",
  ].join("\n");
  const 补 = 两侧跑(增补, "astral");
  const 补行 = String(补.c || "").trim().split("\n");
  ok("增补面的字符占两个单元", 补行[0] === "2", JSON.stringify(补行[0]));
  ok("ord 读回整个码点", 补行[1] === "66560", JSON.stringify(补行[1]));
  ok("大写之后还是它自己", 补行[2] === "66560", JSON.stringify(补行[2]));
  ok("小写之后是另一枚增补面的字符", 补行[3] === "66600", JSON.stringify(补行[3]));
  ok("增补面这批两种走法也一样", 补.js === 补.c, JSON.stringify(补.js) + " 对 " + JSON.stringify(补.c));
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
