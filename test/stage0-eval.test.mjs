// Stage 0 的求值器需要什么：跑遍启动器会遇到的路径，把用到的节点与内置数出来。
//
// 这一套钉的是一张需求表，而不是一句愿望。它是这样量的：把宿主求值器的 evalExpr / evalCall
// 包一层，跑六条真实路径（正常、带 while、带函数、目标不存在、目标语法坏、目标 import 一件库），
// 记下每个节点种类与每个内置名。六条合起来就是全集。
//
// 量出来的事有一件值得说：宿主求值器有 18 种节点，而跑自举层只用到 11 种表达式与 5 种语句。
// Match 一次都没被用到——它在这门语言里存在，而读 self/ 那六份用不上它。
// 这不是「所以删掉 Match」，而是「想把求值器缩小的人该知道这 11 + 5 是硬要求」。
//
// 表变了它就会红。红的时候先读 design/BOOTSTRAP.txt 第十节：那里写着这张表是怎么来的。
// 而红的理由通常有两类——self/ 用了新的构造（表要扩），或者某条路径不再被走到（表要缩）。
// 两件都不是坏事，但都要有人看一眼。
//
// 统计的办法是包 Runtime.prototype。那是实现细节，写在这里是为了让人知道
// 「这张表来自真实的执行，而不是读 AST 数出来的」——读 AST 会漏掉「解出来了但从没执行到」的分支。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Runtime, isBuiltin } from "../src/eval.mjs";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 量 = (目标, options = {}) => {
  const 语句 = new Set(), 表达式 = new Set(), 内置 = new Set(), 用户 = new Set();
  const 原expr = Runtime.prototype.evalExpr;
  const 原call = Runtime.prototype.evalCall;
  const 原块 = Runtime.prototype.execBlock;
  Runtime.prototype.evalExpr = function (n, s, e) {
    if (n && n.kind) 表达式.add(n.kind);
    return 原expr.call(this, n, s, e);
  };
  Runtime.prototype.evalCall = function (n, s, e) {
    const 名 = n && n.callee && n.callee.kind === "名" ? n.callee.name : null;
    // 「算不算内置」要问 isBuiltin，不能看「函数表里有没有它」：
    // 内置优先于同名用户函数，而 self/ 里自己定义了 slice——于是它既在函数表里，
    // 又真的按内置执行。按函数表判断会把这种情况记成用户函数，而那正是第一版的错。
    if (名) { if (isBuiltin(名)) 内置.add(名); else 用户.add(名); }
    return 原call.call(this, n, s, e);
  };
  Runtime.prototype.execBlock = function (n, s, e) {
    for (const st of (n && n.statements) || []) if (st && st.kind) 语句.add(st.kind);
    return 原块.call(this, n, s, e);
  };
  try {
    const 层 = loadUnit(path.join(ROOT, "self/run.hmoca"));
    const rt = runUnit(层, options);
    let 出 = "";
    rt.write = (t) => { 出 += t; };
    rt.writeErr = () => {};
    rt.argv = ["hmyr", 目标];
    const 码 = rt.callFunction(rt.functions.get("命令行入口"), [], null);
    return { 码, 出, 语句, 表达式, 内置 };
  } finally {
    Runtime.prototype.evalExpr = 原expr;
    Runtime.prototype.evalCall = 原call;
    Runtime.prototype.execBlock = 原块;
  }
};

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-evalmin-"));
try {
  fs.writeFileSync(path.join(临, "w.hmoca"), "var i = 0\nwhile i < 3 {\n  i = i + 1\n}\nreturn i\n");
  fs.writeFileSync(path.join(临, "f.hmoca"), "fn 加(a: Int, b: Int) -> Int {\n  return a + b\n}\nfn main() -> Int {\n  let s = \"abc\"\n  return 加(len(s), 2)\n}\n");
  fs.writeFileSync(path.join(临, "bad.hmoca"), "let a = \nreturn a\n");
  fs.writeFileSync(path.join(临, "rec.hmoca"), "let r = {a: 1}\nreturn r.a\n");
  const 模块 = path.join(临, "mod");
  fs.mkdirSync(模块, { recursive: true });
  fs.writeFileSync(path.join(模块, "lib.hmoca"), "fn 双(n: Int) -> Int {\n  return n * 2\n}\n");
  fs.writeFileSync(path.join(模块, "main.hmoca"), "import \"./lib.hmoca\"\n\nfn main() -> Int {\n  return 双(21)\n}\n");

  const 全部语句 = new Set(), 全部表达式 = new Set(), 全部内置 = new Set();
  const 收 = (r) => { r.语句.forEach((x) => 全部语句.add(x)); r.表达式.forEach((x) => 全部表达式.add(x)); r.内置.forEach((x) => 全部内置.add(x)); return r; };

  console.log("一、七条路径，各自的答案先对");
  const hello = 收(量(path.join(ROOT, "examples/hello.hmoca")));
  ok("hello 给五", hello.码 === 0 && hello.出.trim() === "5", hello.码 + " / " + JSON.stringify(hello.出.trim()));
  const 循环 = 收(量(path.join(临, "w.hmoca")));
  ok("while 那个给三", 循环.码 === 0 && 循环.出.trim() === "3", 循环.码 + " / " + JSON.stringify(循环.出.trim()));
  const 函数 = 收(量(path.join(临, "f.hmoca")));
  ok("函数那个给五", 函数.码 === 0 && 函数.出.trim() === "5", 函数.码 + " / " + JSON.stringify(函数.出.trim()));
  const 记录 = 收(量(path.join(临, "rec.hmoca")));
  ok("记录那个给一", 记录.码 === 0 && 记录.出.trim() === "1", 记录.码 + " / " + JSON.stringify(记录.出.trim()));
  const 缺 = 收(量(path.join(临, "nope.hmoca")));
  ok("目标不存在给退出码 1", 缺.码 === 1, String(缺.码));
  const 坏 = 收(量(path.join(临, "bad.hmoca")));
  ok("目标语法坏时也说得出话（有退出码）", 坏.码 === 0 || 坏.码 === 1, String(坏.码));
  const 引 = 收(量(path.join(模块, "main.hmoca")));
  ok("import 那个给四十二", 引.码 === 0 && 引.出.trim() === "42", 引.码 + " / " + JSON.stringify(引.出.trim()));

  console.log("二、表达式：十一种（宿主有十八种，用不到的那几种不在表里）");
  const 应表达式 = ["二元", "Call", "Field", "名", "If", "Index", "字", "Record", "Tuple", "Unary", "While"];
  const 实表达式 = [...全部表达式].sort();
  ok("正好十一种", 实表达式.length === 11, 实表达式.join(" "));
  ok("而它们是那十一种", JSON.stringify(实表达式) === JSON.stringify(应表达式), 实表达式.join(" "));
  ok("Match 一次都没用到（这一条是这张表的价值所在）", !全部表达式.has("Match"), 实表达式.join(" "));

  console.log("三、语句：五种");
  const 应语句 = ["Assign", "ExprStmt", "Let", "Return", "Var"];
  const 实语句 = [...全部语句].sort();
  ok("正好五种", 实语句.length === 5, 实语句.join(" "));
  ok("而它们是那五种", JSON.stringify(实语句) === JSON.stringify(应语句), 实语句.join(" "));

  console.log("四、内置：十九个");
  // 这一栏漏过一次：第一版只跑了六条路径，里面没有一条用记录，于是表里少了
  // record_new / field_get / field_has。补上记录那条之后才齐。
  // 2026-11-02 又加一个 floor：自举层的词法器改分块累积，二分合并那一步要取一半，
  // 而 to_int 对 1.5 是拒绝（HMYR-內-008），所以那里只能用 floor。
  // 把它抓出来的是启动器在 stage0 模式下跑那个记录程序时抛的一句，而不是任何一份文档。
  // 2026-10-27 又长一个：区与所有权格子都用 index_new 建它们的记账表。
  // floor 在这一张表里没有：它进了 STAGE0_BUILTIN（允许调用），但这六条路径一条也没
  // 走到它 —— 自举层的 floor 只在二分合并里用，而这几条程序的 token 还不够两段。
  // 允许用与真的用了是两件事，这张表量的是后者。
  const 应内置 = ["argv", "chr", "field_get", "field_has", "file_exists", "index_get", "index_new", "index_set", "is_letter", "is_mark", "len", "nfc", "print", "print_err", "read_text", "record_new", "slice", "str", "to_int"];
  const 实内置 = [...全部内置].sort();
  ok("正好十九个", 实内置.length === 19, 实内置.join(" "));
  ok("而它们是那十九个", JSON.stringify(实内置) === JSON.stringify(应内置), 实内置.join(" "));
  // 一条值得单说的：slice 既是 self/ 里定义的函数，又真的按内置执行（内置优先）。
  ok("slice 被算成内置（同名用户函数调用不到它）", 全部内置.has("slice"), 实内置.join(" "));
  // 记录那一组三个：造记录、取字段、问字段在不在。
  ok("记录那一组三个都在", ["record_new", "field_get", "field_has"].every((n) => 全部内置.has(n)), 实内置.join(" "));

  console.log("五、这张表说明宿主求值器比需要的宽");
  {
    // 宿主求值器认得的节点种类，从它的源码里数——不是猜。
    const 源 = fs.readFileSync(path.join(ROOT, "src/eval.mjs"), "utf8");
    const 认得 = new Set([...源.matchAll(/case "([A-Z][a-zA-Z]+)"/g)].map((m) => m[1]));
    ok("宿主认得的节点比这一张表多", 认得.size > 全部表达式.size, 认得.size + " 对 " + 全部表达式.size);
    ok("其中含 Match（而这张表里没有）", 认得.has("Match"));
  }

  console.log("六、stage0 模式下同一批路径仍然全对（表不是写在纸上给人点头的）");
  {
    const 三 = [["hello", path.join(ROOT, "examples/hello.hmoca"), "5"], ["while", path.join(临, "w.hmoca"), "3"], ["函数", path.join(临, "f.hmoca"), "5"]];
    for (const [名, 目标, 应] of 三) {
      const r = 量(目标, { stage0: true });
      ok(名 + " 在 stage0 下给 " + 应, r.码 === 0 && r.出.trim() === 应, r.码 + " / " + JSON.stringify(r.出.trim()));
    }
    const 引二 = 量(path.join(模块, "main.hmoca"), { stage0: true });
    ok("import 那个在 stage0 下给四十二", 引二.码 === 0 && 引二.出.trim() === "42", 引二.码 + " / " + JSON.stringify(引二.出.trim()));
  }

  console.log("七、而表外的东西会被拦住，并说清拦的是哪一个");
  {
    // 直接造一份用 match 的源码给宿主求值器跑：这一层拦的是「求值器被要求做超出契约的事」。
    // 读它要用宿主那两层——子集 parser 不认 match，于是它压根产不出 Match 节点。
    // 那件事本身也是明写的：两道门各自拦，各有各的理由。
    const 宿主读 = (source) => {
      const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
      return parse(lex(source).tokens, { diagnostics: d });
    };
    const 文件 = path.join(临, "m.hmoca");
    fs.writeFileSync(文件, "fn f(n: Int) -> Int {\n  return match n { 1 => 2 }\n}\nfn main() -> Int {\n  return f(1)\n}\n");
    const rt = runUnit(loadUnit(文件, { reader: 宿主读 }), { stage0: true });
    rt.write = () => {};
    let 错 = "";
    try { rt.callFunction(rt.functions.get("main"), [], null); } catch (e) { 错 = e.message; }
    ok("stage0 下 Match 被拦", 错.includes("Match"), 错 || "（没有抛）");
    ok("消息里说了 stage 0 不需要它", 错.includes("stage 0 does not need"), 错);
    // 而同一个程序在默认求值器里跑得通：拦人的是 stage0 这个契约，不是求值器不会算 match。
    const 默认 = runUnit(loadUnit(文件, { reader: 宿主读 }));
    默认.write = () => {};
    ok("默认求值器跑得通这个 match 程序", 默认.callFunction(默认.functions.get("main"), [], null) === 2, "跑不通");
  }
} finally {
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
