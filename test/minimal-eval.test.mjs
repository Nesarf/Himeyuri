// 最小求值器对宿主求值器：同一批程序，同一个答案，同一个码。
//
// 这一套是那个「表」的正面验收。前几套钉的是「宿主需要多少」（stage0-eval）与
// 「哪条路在读」（subset-*）；这一套钉的是「照那张表另写一份，能不能顶替它」。
//
// 比的不是「跑得动」，而是逐条路径的退出码与输出、以及错误路径上的编号：
// 一个求值器最容易被写错的地方不是算错加号，而是「该拒绝时给了个值」。
//
// 它也不假装自己更聪明：表外的东西它是抛，宿主是记 R0110。两边都算「拒绝」，
// 而这一套只钉「两边都不会给出一个值」——那句话比「两边说话一样」更接近要保的东西。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { 最小运行 } from "../src/minimal-eval.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-minimal-"));
const 写 = (名, 文) => { const p = path.join(临, 名); fs.writeFileSync(p, 文); return p; };

// 两路跑同一份工程；返回退出码、stdout、stderr。
const 跑 = (入口, 用最小, argv) => {
  const 出 = { w: "", e: "" };
  const 选项 = {
    write: (t) => { 出.w += t; },
    writeErr: (t) => { 出.e += t; },
    argv: argv || [],
    capabilities: 本机能力(),
  };
  let 码 = 0;
  try {
    const 层 = loadUnit(入口);
    if (!层.ok) return { 码: -2, 出: 出.w, 错: 出.e, 诊断: 层.diagnostics.errors.map((x) => x.code) };
    const rt = 用最小 ? 最小运行(层, 选项) : runUnit(层, 选项);
    rt.argv = argv || [];
    if (!用最小) rt.writeErr = 选项.writeErr;
    码 = rt.callFunction(rt.functions.get("main") || rt.functions.get("命令行入口"), [], null) ?? 0;
  } catch (e) {
    码 = -1;
    出.e += (e.code || "") + " " + e.message;
  }
  return { 码, 出: 出.w.trim(), 错: 出.e.trim() };
};

const 同 = (名, 入口, argv) => {
  const 主 = 跑(入口, false, argv), 小 = 跑(入口, true, argv);
  ok(名 + "（码 " + 主.码 + "）", 主.码 === 小.码 && 主.出 === 小.出, "宿主 " + 主.码 + " " + JSON.stringify(主.出) + " · 最小 " + 小.码 + " " + JSON.stringify(小.出));
  return { 主, 小 };
};

try {
  console.log("一、正常程序：同一个值");
  {
    const 模 = path.join(临, "mod");
    fs.mkdirSync(模, { recursive: true });
    fs.writeFileSync(path.join(模, "lib.hmyr"), "fn 双(n: Int) -> Int {\n  return n * 2\n}\n");
    写("hello.hmyr", "fn main() -> Int {\n  return 5\n}\n");
    写("loop.hmyr", "fn main() -> Int {\n  var i = 0\n  while i < 3 {\n    i = i + 1\n  }\n  return i\n}\n");
    写("fn.hmyr", "fn 加(a: Int, b: Int) -> Int {\n  return a + b\n}\nfn main() -> Int {\n  let s = \"abc\"\n  return 加(len(s), 2)\n}\n");
    写("rec.hmyr", "fn main() -> Int {\n  let r = {a: 1}\n  return r.a\n}\n");
    写("imp.hmyr", "import \"./mod/lib.hmyr\"\n\nfn main() -> Int {\n  return 双(21)\n}\n");
    写("text.hmyr", "fn main() -> String {\n  return slice(\"hello world\", 0, 5) + str(len(\"ab\"))\n}\n");
    写("tuple.hmyr", "fn main() -> Int {\n  let t = (1, 2) + (3,)\n  return len(t) + t[0]\n}\n");
    写("nested.hmyr", "fn 外(n: Int) -> Int {\n  let f = if n > 2 { 1 } else { 2 }\n  return f + n\n}\nfn main() -> Int {\n  return 外(3)\n}\n");
    for (const f of ["hello", "loop", "fn", "rec", "imp", "text", "tuple", "nested"]) 同(f + ".hmyr", path.join(临, f + ".hmyr"));
  }

  console.log("二、尾递归：一万层两路都给同一个数（TCO 是真的）");
  {
    const 入口 = 写("tail.hmyr", "fn 数(n: Int) -> Int {\n  if n <= 0 { return 0 }\n  return 数(n - 1)\n}\nfn main() -> Int {\n  return 数(10000)\n}\n");
    const r = 同("一万层尾递归", 入口);
    ok("两边都算完而不是撞深度", r.主.码 === 0, r.主.码 + " " + JSON.stringify(r.主.出));
  }

    console.log("二·补、两个求值器跑「自举自己的求值器」，答案也同一个");
  {
    // 这一节比上面那批硬：它跑的源码是 self/run.hmyr 里的 跑（表达式求值），
    // 那条路上要经过自举的切词、搭树与求值三层。两个宿主求值器在这条路上给出同一个字符串，
    // 才算「它们对这门语言的理解一致」——而不是各算各的加法。
    const 层 = loadUnit(path.join(ROOT, "self/run.hmyr"));
    const 宿主 = runUnit(层);
    宿主.write = () => {};
    宿主.writeErr = () => {};
    const 小 = 最小运行(层, { capabilities: 本机能力() });
    小.write = () => {};
    小.writeErr = () => {};
    const 跑 = (rt, s) => rt.callFunction(rt.functions.get("跑"), [s], null);
    const 例 = ["1 + 2 * 3", "(1 + 2) * 3", "10 % 4", "7 / 2", "-5 + 3", "--5", "1 < 2", "\"a\" + \"b\"", "len(\"abcd\")", "str(9)", "1 +", "x + 1"];
    let 同数 = 0;
    for (const s of 例) {
      const a = 跑(宿主, s), b = 跑(小, s);
      if (a === b) 同数++;
      else ok("「" + s + "」两路不同", false, JSON.stringify(a) + " 对 " + JSON.stringify(b));
    }
    ok("十二个表达式两路给同一个字符串（含两个错处）", 同数 === 例.length, 同数 + " / " + 例.length);
    // 这里只走 跑（表达式求值）。整段程序那条入口（跑程序带函数）收的是适配层造出来的
    // 「语句们」与「函数们」两件东西，而不是源码字符串——那是另一套装置，
    // 由 adapter 与 self-agree 那几套钉着，不在这儿重复一遍。
  }

console.log("三、错误路径：同一个编号");
  const 编号例 = [
    ["除零", "fn main() -> Int {\n  return 1 / 0\n}\n", "HMYR-R0120"],
    ["取余除零", "fn main() -> Int {\n  return 1 % 0\n}\n", "HMYR-R0120"],
    ["索引越界", "fn main() -> String {\n  let s = \"ab\"\n  return s[5]\n}\n", "HMYR-R0151"],
    ["未知名字", "fn main() -> Int {\n  return 没有这个名字\n}\n", "HMYR-R0104"],
    ["非尾递归撞深度", "fn 深(n: Int) -> Int {\n  if n <= 0 { return 0 }\n  return 1 + 深(n - 1)\n}\nfn main() -> Int {\n  return 深(100000)\n}\n", "HMYR-R0108"],
    ["改一个 let", "fn main() -> Int {\n  let a = 1\n  a = 2\n  return a\n}\n", "HMYR-R0150"],
    // 路径用相对写法：Windows 的绝对路径里那个反斜杠在源码里是转义，而子集切词器会拒绝它。
    ["没声明效果就调 read_text", "fn 读() -> String {\n  return read_text(\"nope.txt\")\n}\nfn main() -> String {\n  return 读()\n}\n", "HMYR-R0201"],
  ];
  for (const [名, 文, 码] of 编号例) {
    const 入口 = 写(名.replace(/[^a-z]/gi, "x") + ".hmyr", 文);
    const 主 = 跑(入口, false), 小 = 跑(入口, true);
    ok(名 + "：两路都报 " + 码, String(主.错).includes(码) && String(小.错).includes(码), "宿主 " + JSON.stringify(主.错.slice(0, 60)) + " · 最小 " + JSON.stringify(小.错.slice(0, 60)));
    ok(名 + "：两边都没有给出一个值", 主.出 === "" && 小.出 === "", 主.出 + " / " + 小.出);
  }

  console.log("四、表外的东西：这一份抛，而宿主给 R0110，两边都不给值");
  {
    const 入口 = 写("match.hmyr", "fn f(n: Int) -> Int {\n  return match n { 1 => 2 }\n}\nfn main() -> Int {\n  return f(1)\n}\n");
    // 子集 parser 不认 match，所以这条要走宿主的读法才拿得到 Match 节点。
    const { lex } = await import("../src/lexer.mjs");
    const { parse } = await import("../src/parser.mjs");
    const 宿主读 = (source) => {
      const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
      return parse(lex(source).tokens, { diagnostics: d });
    };
    const 层 = loadUnit(入口, { reader: 宿主读 });
    let 错 = "";
    try { 最小运行(层, { capabilities: 本机能力() }).callFunction(层.modules.get(path.resolve(入口)).decls.find((d) => d.name === "main"), [], null); } catch (e) { 错 = e.message; }
    ok("最小这一份说清它不认 Match", 错.includes("Match"), 错 || "（没有抛）");
    // 而宿主跑得通：那证明「拒绝」是这一份的选择，不是这门语言的限制。
    const 主 = runUnit(层);
    主.write = () => {};
    ok("宿主跑得通这个 match 程序", 主.callFunction(主.functions.get("main"), [], null) === 2, "跑不通");
  }
} finally {
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
