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
import { loadUnit } from "../tools/self-bridge.mjs";
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

console.log("十一、归一化：分解、排序、组合，这台机器也做");
{
  // 样本从三张表里长出来，不从「想到哪儿试到哪儿」来：
  //   一、每个有规范分解的码点（表里全部）
  //   二、每个组合对，写成「前一个 + 后一个」两字
  //   三、一段等距抽样，拿 conformance/unicode-nfc.txt 当另一侧的答案
  //   四、组合类的次序：同一个起头后面跟两个记号，两种先后该给同一个结果
  //   五、韩文：三个字母拼一个音节，那条是算法不是表
  const 头 = fs.readFileSync(path.join(ROOT, "vm/ucd-nfc.h"), "utf8");
  const 分解码 = [...头.split("ucd_decomp[] = {")[1].split("};")[0].matchAll(/\{0x([0-9A-F]+)u, \d+u, \{/g)]
    .map((m) => parseInt(m[1], 16));
  const 组合对 = [...头.split("ucd_comp[] = {")[1].split("};")[0]
    .matchAll(/\{0x([0-9A-F]+)u, 0x([0-9A-F]+)u, 0x([0-9A-F]+)u\}/g)]
    .map((m) => [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]);
  const 组合类们 = [...头.split("ucd_ccc[] = {")[1].split("};")[0].matchAll(/\{0x([0-9A-F]+)u, (\d+)u\}/g)]
    .map((m) => [parseInt(m[1], 16), Number(m[2])]);

  const 单码 = new Set(分解码);
  for (let cp = 0; cp <= 0x10ffff; cp += 97) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) continue;   // 这些进不了按行读的文件
    单码.add(cp);
  }
  const 语料 = new Map();
  {
    // 不整份 split：这份语料十七点八兆，切下去是一百一十多万个短字符串，
    // 光对象头就要几百兆，而这里只要样本里那些码点。逐行走一遍，命中才解析。
    const 全文 = fs.readFileSync(path.join(ROOT, "conformance/unicode-nfc.txt"), "utf8");
    let 起 = 0;
    for (;;) {
      const 下 = 全文.indexOf("\n", 起);
      const 行 = 下 < 0 ? 全文.slice(起) : 全文.slice(起, 下);
      if (行) {
        const 分界 = 行.indexOf(";");
        if (分界 > 2) {
          const cp = parseInt(行.slice(2, 分界), 16);
          if (单码.has(cp)) {
            // 右边可能是一个码点，也可能是一串：组合被排除的那几个归一之后就是要分开的。
            const 到 = 行.slice(分界 + 1).trim().split(/\s+/).map((h) => parseInt(h.slice(2), 16)).filter((v) => !Number.isNaN(v));
            if (到.length) 语料.set(cp, 到);
          }
        }
      }
      if (下 < 0) break;
      起 = 下 + 1;
    }
  }

  const 行们 = [];
  for (const cp of [...单码].sort((a, b) => a - b)) 行们.push({ 种: "单", 文: String.fromCodePoint(cp), cp });
  for (const [a, b, c] of 组合对) 行们.push({ 种: "对", 文: String.fromCodePoint(a) + String.fromCodePoint(b), 到: c });
  // 组合类的次序：拿两个类不同的记号，和同一个起头按两种先后排，两行该给同一个结果。
  // 类相同的两个不换位，所以挑的时候要挑不同的类 —— 这一点本身也是那条规则的边界。
  const 各类代表 = new Map();
  for (const [cp, c] of 组合类们) {
    if (c === 0 || cp >= 0x10000) continue;
    if (!各类代表.has(c)) 各类代表.set(c, cp);
  }
  const 代表们 = [...各类代表.entries()].sort((a, b) => a[0] - b[0]).map(([, cp]) => cp);
  for (let k = 0; k + 1 < 代表们.length; k += 1) {
    const 前 = String.fromCodePoint(0x41, 代表们[k], 代表们[k + 1]);
    const 后 = String.fromCodePoint(0x41, 代表们[k + 1], 代表们[k]);
    行们.push({ 种: "序", 文: 前, 伴: 后 });
    行们.push({ 种: "序", 文: 后, 伴: 前 });
  }
  // 韩文：初声 + 中声，再加一个终声。
  for (let L = 0x1100; L < 0x1100 + 19; L += 3) {
    for (let V = 0x1161; V < 0x1161 + 21; V += 4) {
      行们.push({ 种: "韩", 文: String.fromCodePoint(L) + String.fromCodePoint(V), 长: 1 });
      行们.push({ 种: "韩", 文: String.fromCodePoint(L) + String.fromCodePoint(V) + String.fromCodePoint(0x11A8), 长: 1 });
    }
  }

  const 清单 = path.join(临, "nfc-sample.txt");
  fs.writeFileSync(清单, 行们.map((r) => r.文).join("\n") + "\n", "utf8");
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
    '    print(单元们(nfc(行们[i])) + "\\n")',
    "    i = i + 1",
    "  }",
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "nfc-fold");
  const 甲 = String(r.js || "").split("\n");
  const 乙 = String(r.c || "").split("\n");
  const 单元串 = (cp) => {
    if (cp <= 0xffff) return String(cp);
    const 码 = cp - 0x10000;
    return (0xd800 + (码 >> 10)) + " " + (0xdc00 + (码 & 0x3ff));
  };

  const 机器错 = [];
  const 语料错 = [];
  const 对错 = [];
  const 序错 = [];
  const 韩错 = [];
  const 位置 = new Map();
  for (let i = 0; i < 行们.length; i++) 位置.set(行们[i].文, i);
  for (let i = 0; i < 行们.length; i++) {
    const 甲行 = String(甲[i] || "").trim();
    const 乙行 = String(乙[i] || "").trim();
    if (甲行 !== 乙行) 机器错.push(i);
    const 行 = 行们[i];
    if (行.种 === "单" && 语料.has(行.cp)) {
      const 期 = 语料.get(行.cp).map((cp) => 单元串(cp)).join(" ");
      if (乙行 !== 期) 语料错.push(i);
    }
    if (行.种 === "对" && 乙行 !== 单元串(行.到)) 对错.push(i);
    if (行.种 === "序" && 乙行 !== String(乙[位置.get(行.伴)] || "").trim()) 序错.push(i);
    if (行.种 === "韩") {
      const 长 = 乙行 ? 乙行.split(" ").length : 0;
      if (长 !== 行.长) 韩错.push(i);
    }
  }
  const 说 = (i) => "第 " + i + " 行（" + 行们[i].种 + "），甲 " + JSON.stringify(甲[i]) + " 乙 " + JSON.stringify(乙[i]);
  ok("两台机器对整批样本一样", 机器错.length === 0, 机器错.length ? 说(机器错[0]) : "");
  ok("每个码点归一之后该是什么，与语料一字不差（" + 语料.size + " 个）",
     语料错.length === 0, 语料错.length ? 说(语料错[0]) : "");
  ok("组合对：前一个加后一个拼成第三个（" + 组合对.length + " 对）", 对错.length === 0, 对错.length ? 说(对错[0]) : "");
  ok("组合类的次序：两种先后给同一个结果", 序错.length === 0, 序错.length ? 说(序错[0]) : "");
  ok("韩文字母拼成音节（" + 行们.filter((q) => q.种 === "韩").length + " 组）",
     韩错.length === 0, 韩错.length ? 说(韩错[0]) : "");
  ok("组合对那一批确实跑了", 组合对.length > 900 && 乙.length > 5000, 组合对.length + " 对 / " + 乙.length + " 行");
}

console.log("十二、堆账：这台机器分配了不回收，而那个数读得出来");
{
  // 「没有 GC」是一条设计选择，而设计选择要有数字跟着，否则它既不能被验收，
  // 也不能被发现变坏。这台机器每次分配都记账，HMYR_MEM 一开就在退出时打一行。
  const 码路 = path.join(临, "self.hmyrb");
  if (fs.existsSync(码路)) {
    const 重 = spawnSync(exe, [码路, path.join(ROOT, "conformance/lib-strings.hmyr")], {
      encoding: "utf8", timeout: 180000,
      env: { ...process.env, HMYR_MEM: "1", HMYR_STEPS: "200000000" },
    });
    const m = /peak (\d+) bytes/.exec(String(重.stderr));
    const 峰 = m ? Number(m[1]) : -1;
    const 兆 = Math.round((峰 / 1048576) * 10) / 10;
    ok("最重的那一份工作能报出峰值", 峰 > 0, String(重.stderr).slice(0, 160));
    ok("峰值是真的量出来的，不是零", 峰 > 1048576, String(峰));
    // 界线从 256 抬到 320：自举层这一轮长到 173 个函数（加载器那一串搬了进来），
    // 它跑 lib-strings 时的峰值也就跟着从两百出头涨到两百九十上下。抬界线不是放纵 ——
    // 原来的 256 已经量到了头顶，那不是一段还能用的余量。
    ok("峰值在这条界线以内（" + 兆 + " 兆，界线 320）", 峰 > 0 && 峰 < 320 * 1048576, String(峰));
    ok("而且那一份工作还是跑对了", String(重.stdout).trim() === "0", JSON.stringify(String(重.stdout).trim().slice(0, 40)));
  } else {
    ok("最重的那一份工作能报出峰值", false, "没有自举层字节码");
  }
  // 不问就不出声：平常跑程序的人不该看见这一行。
  const 小 = spawnSync(exe, [path.join(临, "astral.hmyrb")], { encoding: "utf8" });
  if (fs.existsSync(path.join(临, "astral.hmyrb"))) {
    ok("不问的时候不出这一行", !String(小.stderr).includes("heap"), String(小.stderr).slice(0, 120));
  } else {
    ok("不问的时候不出这一行", false, "没有那一份字节码");
  }
}

console.log("十三、算术那一组：两台机器同一个数");
{
  // 这五个以前只在宿主求值器里有：同一段程序在宿主上跑得动，编成字节码就报
  // 「没有这个内置」。现在它们进了字节码内置表，两台机器都得给同一个数。
  const 源码 = [
    "fn main() -> Int {",
    '  print(str(abs(0 - 7)) + " ")',
    '  print(str(floor(2.7)) + " ")',
    '  print(str(floor(0 - 2.1)) + " ")',
    '  print(str(int(0 - 2.7)) + " ")',
    '  print(str(min(3, 9, 2)) + " ")',
    '  print(str(max(3, 9, 2)) + "\\n")',
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "arith");
  ok("六个数两台一样", r.js === r.c, JSON.stringify(r.js) + " 对 " + JSON.stringify(r.c));
  ok("负数的 floor 往下取，int 朝零截", r.c.includes("-3 -2"), JSON.stringify(r.c));
  ok("min 与 max 收得了三个参数", r.c.trim().endsWith("2 9"), JSON.stringify(r.c.trim().slice(-24)));
  ok("小数字面量也编得过", r.c.trim().startsWith("7 2"), JSON.stringify(r.c.trim().slice(0, 20)));
}

console.log("十四、切开一个字符串：三种边界两台一样");
{
  // split 是设计/COMPILER 里点名的「还差的那几个纯函数」之一。它在宿主求值器里
  // 一直有，而字节码执行器与 C 那台都没有 —— 于是同一段程序在宿主上跑得动，
  // 编成字节码就报「没有这个内置」。这里把三种容易写错的边界钉住：
  // 连续分隔留下空段、空分隔按码元切、末尾分隔留下尾空段。
  const 源码 = [
    "fn main() -> Int {",
    '  print(str(len(split("a,b,,c", ","))) + " ")',
    '  print(str(len(split("abc", ""))) + " ")',
    '  print(str(len(split("", ","))) + " ")',
    '  print(str(len(split(",a", ","))) + " ")',
    '  let 段 = split("x--y--z", "--")',
    "  print(段[1] + 段[2])",
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "split");
  ok("五种情形的答案两台一样", r.js === r.c, JSON.stringify(r.js) + " 对 " + JSON.stringify(r.c));
  ok("段数是 4 3 1 2，多字符分隔按子串切", r.c.trim() === "4 3 1 2 yz", JSON.stringify(r.c.trim()));
}

console.log("十五、调用深度：见底之前先说话");
{
  // 这台机器的调用是 C 递归。栈见底时 Windows 只给一个退出码 0xC00000FD，
  // 一行人话都没有 —— 所以深度要能量，也要能拦。2026 查那次爆栈，
  // 就是靠 HMYR_DEPTH 打出的峰值行找到「拼两半」在挖自己。
  const 源码 = [
    "fn 下(n: Int) -> Int {",
    "  if n <= 0 { return 0 }",
    "  return 下(n - 1) + 1",
    "}",
    "fn main() -> Int {",
    "  print(str(下(50)))",
    "  return 0",
    "}",
  ].join("\n");
  const 源路 = path.join(临, "deep.hmyr");
  fs.writeFileSync(源路, 源码, "utf8");
  const unit = loadUnit(源路);
  const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))));
  const 码路 = path.join(临, "deep.hmyrb");
  fs.writeFileSync(码路, 写程序(程序));

  const 拦 = spawnSync(exe, [码路], { encoding: "utf8", env: { ...process.env, HMYR_MAX_DEPTH: "8" } });
  ok("深度上限会拦住（退出码 72）", 拦.status === 72, String(拦.status));
  ok("拦住时说得清停在哪一层、哪个函数",
     /calls went \d+ deep, past the ceiling 8/.test(String(拦.stderr)) && String(拦.stderr).includes("下"),
     JSON.stringify(String(拦.stderr).slice(0, 140)));

  const 报 = spawnSync(exe, [码路], { encoding: "utf8", env: { ...process.env, HMYR_DEPTH: "1" } });
  ok("开了探针程序照样跑完", 报.status === 0 && String(报.stdout).trim() === "50",
     String(报.status) + " " + JSON.stringify(String(报.stdout).trim()));
  ok("探针把深度报出来了", /DEPTH \d+/.test(String(报.stderr)), JSON.stringify(String(报.stderr).slice(0, 140)));

  const 静 = spawnSync(exe, [码路], { encoding: "utf8" });
  ok("不问的时候不出声",
     !String(静.stderr).includes("DEPTH") && !String(静.stderr).includes("ceiling"),
     JSON.stringify(String(静.stderr).slice(0, 140)));
}

console.log("十六、终端那一组：只算不写");
{
  // 这些内置只交回「该写什么」，于是它们可以断言；真正的写出仍然只有 print。
  // 板子没有终端也不会假装有 —— 它们照样算出那串字节。
  const 源码 = [
    "fn main() -> Int {",
    '  print(str(len(term_clear())) + " ")',
    '  print(str(ord(slice(term_escape(3, 7), 0, 1))) + " ")',
    '  print(str(len(term_color(196))) + " ")',
    '  print(str(len(term_color(0 - 1))) + " ")',
    '  let 尺 = term_size()',
    '  print(str(len(尺)) + " ")',
    '  print(str(term_hide() == term_show()) + " ")',
    '  print(slice(term_escape(3, 7), 2, len(term_escape(3, 7))))',
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "term");
  ok("六条终端序列两台一样", r.js === r.c, JSON.stringify(r.js) + " 对 " + JSON.stringify(r.c));
  ok("答案是 4 27 11 4 2 false 3;7H", r.c.trim() === "4 27 11 4 2 false 3;7H", JSON.stringify(r.c.trim()));
}

console.log("十七、时间那一组：只断言形状，不断言值");
{
  // 这两条故意让程序不可复现，所以测试能问的只有形状：
  // 钟走过以后不倒退，而 sleep_ms 交回它答应等的那个数。
  const 源码 = [
    "fn main() -> Int {",
    '  print(str(now_ms() > 0) + " ")',
    '  print(str(sleep_ms(5)) + " ")',
    '  let 甲 = now_ms()',
    '  let 乙 = now_ms()',
    '  print(str(乙 >= 甲) + " ")',
    '  print(str(sleep_ms(0 - 3)))',
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "time");
  ok("两台机器的形状一样", r.js === r.c, JSON.stringify(r.js) + " 对 " + JSON.stringify(r.c));
  ok("钟在走、等多少交回多少、负数归零", r.c.trim() === "true 5 true 0", JSON.stringify(r.c.trim()));
}

console.log("十八、环境与路径：与机器有关的只断言形状");
{
  // 这些内置读的是「这台机器在哪儿」，两台机器给出不同的串本来就是对的。
  // 所以程序只输出「拿到的不是空串」与 locale 的名字，不输出路径本身。
  const 源码 = [
    "fn main() -> Int {",
    '  print(str(len(cwd()) > 0) + " ")',
    '  print(str(len(home_dir()) > 0) + " ")',
    '  print(str(len(temp_path("probe")) > 0) + " ")',
    '  print(str(len(repo_path("a/b")) > 0) + " ")',
    '  print(str(len(python_path()) > 0) + " ")',
    '  print(str(len(console_codepage()) > 0) + " ")',
    '  print(locale_set("zh-CN.utf8") + " ")',
    '  print(str(locale_current() == "zh-CN.utf8"))',
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "env");
  ok("六条形状加两条 locale 两台一样", r.js === r.c, JSON.stringify(r.js) + " 对 " + JSON.stringify(r.c));
  ok("形状是六个 true，locale 名字与选择都对",
     r.c.trim() === "true true true true true true zh-CN.utf8 true", JSON.stringify(r.c.trim()));
}

console.log("十九、不认识的 locale 要说出来");
{
  const 源路 = path.join(临, "badlocale.hmyr");
  fs.writeFileSync(源路, 'fn main() -> Int {\n  locale_set("xx-XX.utf8")\n  return 0\n}\n', "utf8");
  const unit = loadUnit(源路);
  const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))));
  const 码路 = path.join(临, "badlocale.hmyrb");
  fs.writeFileSync(码路, 写程序(程序));
  const r = spawnSync(exe, [码路], { encoding: "utf8" });
  ok("R0205 说的是没有这套档案",
     r.status !== 0 && String(r.stderr).includes("HMYR-R0205"),
     String(r.status) + " " + JSON.stringify(String(r.stderr).slice(0, 140)));
}

console.log("二十、输入那一组：一条队列，没有终端也不阻塞");
{
  // 套件往队列里塞键，于是「按一个键就停」这种程序没有终端也能被断言。
  // 队列空而 stdin 不是终端时 key_read 立即交回空串 —— 三条情形里最容易被忽略的那条。
  const 源码 = [
    "fn main() -> Int {",
    '  print(str(key_push("a")) + " ")',
    '  print(str(key_available()) + " ")',
    '  print(key_read() + " ")',
    '  print(str(key_available()) + " ")',
    '  print(str(key_read() == "") + " ")',
    '  print(str(key_start(false)))',
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "keys");
  ok("队列两端一致", r.js === r.c, JSON.stringify(r.js) + " 对 " + JSON.stringify(r.c));
  ok("推一个、取一个、空则空串、非终端的 raw 是假",
     r.c.trim() === "1 true a false true false", JSON.stringify(r.c.trim()));
}

console.log("二十一、改工作目录：进去、读回来、再回来");
{
  // chdir 会改进程状态，所以程序自己负责回到原处 —— 这一条既测「进得去」，
  // 也测「交回的是新目录」，还测「回得来」，于是三句都能被断言。
  const 源码 = [
    "fn main() -> Int effects(process) {",
    '  let 原 = cwd()',
    '  let 新 = chdir(temp_path("chdir-probe"))',
    '  print(str(len(新) > 0) + " ")',
    '  print(str(cwd() == 新) + " ")',
    '  chdir(原)',
    '  print(str(cwd() == 原))',
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "chdir");
  ok("两台机器都进得去、读得回、回得来", r.js === r.c, JSON.stringify(r.js) + " 对 " + JSON.stringify(r.c));
  ok("答案是 true true true", r.c.trim() === "true true true", JSON.stringify(r.c.trim()));
}

console.log("二十二、跑一个程序：退出码、两路输出、超时");
{
  // 这一条是进程组的大件：管道、超时、四个字段一份记录。
  // 程序只输出可断言的那几件，不输出 stderr 内容（它随宿主的措辞而变）。
  const 源码 = [
    "fn main() -> Int effects(process) {",
    '  let 甲 = run_program("cmd", ("/c", "echo hi"))',
    '  print(str(甲.code) + " " + 甲.stdout + " ")',
    '  let 乙 = run_program("cmd", ("/c", "exit 3"))',
    '  print(str(乙.code) + " ")',
    '  let 丙 = run_program("no-such-program-xyz")',
    '  print(str(丙.code) + " ")',
    '  let 丁 = run_program("cmd", ("/c", "ping -n 4 127.0.0.1"), 60)',
    '  print(str(丁.timedOut))',
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "proc");
  ok("两台机器的形状一样", r.js === r.c, JSON.stringify(r.js) + " 对 " + JSON.stringify(r.c));
  ok("退出码、输出与超时都对", r.c.trim() === "0 hi 3 -1 true", JSON.stringify(r.c.trim()));
}

console.log("二十三、线程：这一台没有，问了会说");
{
  // 跨核要一个独立的机器实例，而这台的执行状态是文件级全局。
  // 答案与 JS 那侧「起不来」时同一条路：spawn 交回 -1，活的数是 0。
  const 源码 = [
    "fn main() -> Int effects(thread) {",
    '  print(str(thr_spawn("(fn main() -> Int { 0 })", "main")) + " ")',
    '  print(str(thr_count()))',
    "  return 0",
    "}",
  ].join("\n");
  const r = 两侧跑(源码, "threads");
  ok("起不来时交回 -1、活的数是 0", r.js === r.c && r.c.trim() === "-1 0", JSON.stringify(r.c.trim()));
}

console.log("二十四、回收：同一个程序开着回收，峰值降下来");
{
  // 这台机器默认不回收。HMYR_GC=1 打开之后，元组的元素、记录的 vals、
  // 调用帧的槽都会被标扫；字符串这一轮不收，所以降下来的是一部分 ——
  // 而那一部分正是「一份一份编」时累积得最凶的那种临时对象。
  const 源码 = [
    "fn 造(k: Int) -> Int {",
    "  var t = ()",
    "  var i = 0",
    "  while i < k {",
    "    t = t + (i, i + 1, i + 2, i + 3)",
    "    i = i + 1",
    "  }",
    "  return t",
    "}",
    "fn 丢(k: Int, 次: Int) -> Int {",
    "  if 次 <= 0 { return 0 }",
    "  let x = 造(k)",
    "  return 丢(k, 次 - 1) + len(x)",
    "}",
    "fn main() -> Int {",
    "  var 和 = 0",
    "  var i = 0",
    "  while i < 50 {",
    "    和 = 和 + 丢(20, 20)",
    "    i = i + 1",
    "  }",
    '  print(str(和))',
    "  return 0",
    "}",
  ].join("\n");
  const 源路 = path.join(临, "gcmem.hmyr");
  fs.writeFileSync(源路, 源码, "utf8");
  const unit = loadUnit(源路);
  const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))));
  const 码路 = path.join(临, "gcmem.hmyrb");
  fs.writeFileSync(码路, 写程序(程序));
  const 读峰 = (env) => {
    const r = spawnSync(exe, [码路], { encoding: "utf8", timeout: 120000, env: { ...process.env, HMYR_MEM: "1", ...env } });
    const m = /peak (\d+)/.exec(String(r.stderr));
    return { 峰: m ? Number(m[1]) : -1, 出: String(r.stdout).trim(), 码: r.status };
  };
  const 甲 = 读峰({});
  const 乙 = 读峰({ HMYR_GC: "1" });
  ok("两次都跑对了", 甲.码 === 0 && 乙.码 === 0 && 甲.出 === 乙.出, JSON.stringify([甲, 乙]));
  ok("开着回收时峰值不到一半", 乙.峰 > 0 && 甲.峰 > 0 && 乙.峰 * 2 < 甲.峰,
     Math.round(乙.峰 / 1048576) + " MB 对 " + Math.round(甲.峰 / 1048576) + " MB");
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
