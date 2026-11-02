// 不变式：SPEC §2.4 那三样的第三样（design/INVARIANTS.txt）。
//
// 它与契约同一时机、同一开关，但语义不同：不变式是「这个函数自己的前提」，
// 进入时查一次、每次返回之前再查一次。
//
// 这一套先钉语法（invariant 要真的进 contracts.invariant，而不是被跳过），
// 再钉行为；两个顺序各有一条用例，因为它们是可观察的。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { run } from "../src/eval.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { loadUnit } from "../src/loader.mjs";
import { 虚拟机, 跑字节码 } from "../src/vm.mjs";
import { 读程序 } from "../src/code-file.mjs";
import { 本机能力 } from "../src/capabilities.mjs";
import { 子集解 } from "../src/subset-parse.mjs";
import { 切 } from "../src/subset-lex.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

console.log("一、语法层：invariant 真的进了 contracts.invariant");
{
  const 源 = "fn 取(n: Int) -> Int\n  invariant n >= 0\n{\n  return n\n}\n";
  const 空诊断 = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const 主 = parse(lex(源).tokens, { diagnostics: 空诊断 }).ast;
  const f = 主.decls[0];
  ok("宿主那棵树里有它", f && f.contracts && f.contracts.invariant && f.contracts.invariant.length === 1, JSON.stringify(f && f.contracts && Object.keys(f.contracts)));
  ok("它没有混进 requires", f && f.contracts.requires.length === 0, String(f && f.contracts.requires.length));
  ok("它没有混进 ensures", f && f.contracts.ensures.length === 0, String(f && f.contracts.ensures.length));
  const 子 = 子集解(切(源)).ast;
  const g = 子.decls[0];
  ok("子集那一层也认", g && g.contracts && g.contracts.invariant && g.contracts.invariant.length === 1, JSON.stringify(g && g.contracts && Object.keys(g.contracts)));
}

const 码 = (r) => r.diagnostics.errors.map((e) => e.code);
const 话 = (r) => r.diagnostics.errors.map((e) => e.message);
const 跑 = (源, 开) => run(源, 开 ? { contracts: true } : {});

console.log("二、关档：不变式不成立也等于没写");
{
  const 源 = "fn 取(n: Int) -> Int\n  invariant n >= 0\n{\n  return n\n}\nfn main() { print(str(取(0 - 5))) }\n";
  const r = 跑(源, false);
  ok("跑得过去", r.diagnostics.errors.length === 0, JSON.stringify(码(r)));
  ok("输出的就是那个值", r.output.join("") === "-5", JSON.stringify(r.output));
}

console.log("三、开档：入口不成立");
{
  const 源 = "fn 取(n: Int) -> Int\n  invariant n >= 0\n{\n  return n\n}\nfn main() { print(str(取(0 - 5))) }\n";
  const r = 跑(源, true);
  ok("码是 HMYR-契-003", 码(r).includes("HMYR-契-003"), JSON.stringify(码(r)));
  ok("消息里有函数名、第几条与 invariant", 话(r).some((m) => m.includes("取") && m.includes("第 1 条") && m.includes("invariant")), JSON.stringify(话(r)));
  ok("没有跑出输出", r.output.length === 0, JSON.stringify(r.output));
}

console.log("四、解释这一台：出口不成立也验得动");
{
  // 2026-11-02：这一节原来是「解释这一路拒绝写模块级 var，所以出口只能在字节码那台验」。
  // 那条口子收掉之后，模块级的 var 在两台求值器里都能写（design/GLOBALS.txt），
  // 于是出口不变式在解释这一台上也验得动了 —— 而它本来就是四台一致的一部分。
  //
  // 要造一条「入口成立、出口不成立」的不变式，就得让函数改掉不变式引用的那个东西；
  // 参数是 定 绑的（不可写），所以只剩下模块级 var 这一条路。
  const 源 = "var 状态 = 0\nfn 进() -> Int\n  invariant 状态 == 0\n{\n  状态 = 1\n  return 0\n}\nfn main() { print(str(进())) }\n";
  const 关 = 跑(源, false), 开 = 跑(源, true);
  ok("关档跑得过去，输出 0", 关.diagnostics.errors.length === 0 && 关.output.join("") === "0", JSON.stringify([码(关), 关.output]));
  ok("开档停在 HMYR-契-003", 码(开).includes("HMYR-契-003"), JSON.stringify(码(开)));
  ok("消息与字节码那台同一句", 话(开).some((m) => m === "函数 进 的第 1 条 invariant 不成立"), JSON.stringify(话(开)));
}

console.log("五、顺序：入口先 requires 再 invariant");
{
  // 两条同时不成立时，报的是先查的那一条。
  const 源 = "fn 取(n: Int) -> Int\n  requires n > 0\n  invariant n < 100\n{\n  return n\n}\nfn main() { print(str(取(0 - 5))) }\n";
  const r = 跑(源, true);
  ok("报的是 HMYR-契-001", 码(r).includes("HMYR-契-001") && !码(r).includes("HMYR-契-003"), JSON.stringify(码(r)));
}

console.log("七、硬条款：不变式都成立时，开关两边同样");
{
  const 源 = "fn 取(n: Int) -> Int\n  invariant n >= 0\n{\n  return n * 2\n}\nfn main() { print(str(取(3))) }\n";
  const 关 = 跑(源, false), 开 = 跑(源, true);
  ok("两边都没有错", 关.diagnostics.errors.length === 0 && 开.diagnostics.errors.length === 0, JSON.stringify([码(关), 码(开)]));
  ok("两边输出一样且是 6", 关.output.join("") === 开.output.join("") && 关.output.join("") === "6", JSON.stringify([关.output, 开.output]));
}

console.log("六、字节码那台：出口那两条的顺序在这里才看得清");
{
  // 出口在这个语言里是两条：ensures 与 invariant，而有先后 —— 「我交出去的东西对不对」
  // 排在「我的前提还在不在」之前。这一节钉的就是那个顺序。
  //
  // 解释那台现在也验得动出口（第四节），而它验的是「出口不成立会报」；
  // 顺序这一条只在这一节有样本，因为它需要「两条同时不成立」的那份源码。
  const 新诊断 = () => ({
    items: [], errors: [], warnings: [],
    add(severity, code, message, line, column) {
      const one = { severity, code, message, line, column };
      this.items.push(one);
      if (severity === "error") this.errors.push(one);
    },
    error(code, message, line, column) { this.add("error", code, message, line, column); },
    warn(code, message, line, column) { this.add("warning", code, message, line, column); },
  });
  const 宿主读 = (source) => {
    const d = 新诊断();
    const { ast } = parse(lex(source).tokens, { diagnostics: d });
    return { ast, diagnostics: d };
  };
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-invariant-"));
  const 跑码 = (源, 强, 名) => {
    const 源路 = path.join(临, 名 + ".hmoca");
    fs.writeFileSync(源路, 源, "utf8");
    let 出 = "";
    const vm = 跑字节码(loadUnit(源路, { reader: 宿主读 }), {
      contracts: 强, capabilities: 本机能力(),
      write: (t) => { 出 += t; }, writeErr: (t) => { 出 += t; },
    });
    const r = vm.调用("main", [], null);
    return { ok: r.ok, 码: r.ok ? "" : r.码, 话: r.ok ? "" : r.话, 出 };
  };

  const 出口坏 = "var 状态 = 0\nfn 进() -> Int\n  invariant 状态 == 0\n{\n  状态 = 1\n  return 0\n}\nfn main() { print(str(进())) }\n";
  const 关 = 跑码(出口坏, false, "关"), 开 = 跑码(出口坏, true, "开");
  ok("关档跑得过去", 关.ok && 关.出 === "0", JSON.stringify([关.ok, 关.码, 关.出]));
  ok("开档停在 HMYR-契-003", !开.ok && 开.码 === "HMYR-契-003", JSON.stringify([开.ok, 开.码, 开.话]));

  // 出口顺序：ensures 先于 invariant，两条同时不成立时报 002。
  const 顺序坏 = "var 状态 = 0\nfn 进() -> Int\n  ensures 返回值 > 0\n  invariant 状态 == 0\n{\n  状态 = 1\n  return 0 - 1\n}\nfn main() { print(str(进())) }\n";
  const 序 = 跑码(顺序坏, true, "序");
  ok("出口先报 HMYR-契-002", !序.ok && 序.码 === "HMYR-契-002", JSON.stringify([序.ok, 序.码, 序.话]));

  // 入口不成立，且与解释那台说的是同一句话。
  const 入口坏 = "fn 取(n: Int) -> Int\n  invariant n >= 0\n{\n  return n\n}\nfn main() { print(str(取(0 - 5))) }\n";
  const 入 = 跑码(入口坏, true, "入");
  ok("入口停在 HMYR-契-003", !入.ok && 入.码 === "HMYR-契-003", JSON.stringify([入.ok, 入.码, 入.话]));
  ok("消息与解释那台同一句", 入.话 === "函数 取 的第 1 条 invariant 不成立", JSON.stringify(入.话));

  // 不变式都成立时，开关两边一样。
  const 好 = "fn 取(n: Int) -> Int\n  invariant n >= 0\n{\n  return n * 2\n}\nfn main() { print(str(取(3))) }\n";
  const 关好 = 跑码(好, false, "关好"), 开好 = 跑码(好, true, "开好");
  ok("两边输出一样且是 6", 关好.ok && 开好.ok && 关好.出 === 开好.出 && 关好.出 === "6", JSON.stringify([关好.ok, 关好.出, 开好.ok, 开好.出]));
}

console.log("七、自举那台：解释路上也查了");
{
  // 这一台的失败形状与别处不同（跑模块族把运行期错包成「错：…」并退出 0），
  // 所以判据看输出里有没有那个码与那句话 —— 理由写在 test/contracts.test.mjs 里。
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-invariant-self-"));
  const 写文件 = (名, 文) => { const p = path.join(临, 名); fs.writeFileSync(p, 文, "utf8"); return p; };
  const 坏 = 写文件("坏.hmoca", "fn 取(n: Int) -> Int\n  invariant n >= 0\n{\n  return n\n}\nfn main() -> Int {\n  print(str(取(0 - 5)))\n  return 0\n}\n");
  const 好 = 写文件("好.hmoca", "fn 取(n: Int) -> Int\n  invariant n >= 0\n{\n  return n * 2\n}\nfn main() -> Int {\n  print(str(取(3)))\n  return 0\n}\n");
  const 跑自 = (路, 开) => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), 路, ...(开 ? ["--contracts"] : [])], { encoding: "utf8", timeout: 180000 });
    return { 出: String(r.stdout || ""), 错: String(r.stderr || ""), 码: r.status };
  };
  const 关坏 = 跑自(坏, false), 开坏 = 跑自(坏, true);
  ok("关档跑得过去", 关坏.码 === 0 && 关坏.出.startsWith("-5"), JSON.stringify([关坏.码, 关坏.出.trim()]));
  ok("开档停在 HMYR-契-003", 开坏.出.includes("HMYR-契-003"), JSON.stringify([开坏.码, 开坏.出.trim().slice(0, 80)]));
  ok("消息与另外两台同一句", 开坏.出.includes("函数 取 的第 1 条 invariant 不成立"), JSON.stringify(开坏.出.trim().slice(0, 80)));
  const 关好 = 跑自(好, false), 开好 = 跑自(好, true);
  ok("两边输出一样", 关好.出.startsWith("6") && 开好.出.startsWith("6"), JSON.stringify([关好.出.trim(), 开好.出.trim()]));
}

console.log("八、循环不变式：挂在 当 上，入口一次、每轮体末一次");
{
  // 与函数不变式不同的地方只有位置与消息：它挂在 当 上，一次取一个循环；
  // 同一个函数里可以有若干个循环，所以消息报行号而不是「第几条」。
  // 行号取的是不变式表达式自己那一行 —— 它可能与 当 分行，而读的人要找的正是那一条条件。
  //
  // 三份样本，一件事各说一遍：
  //   入坏 —— 0 轮：条件一次都不真，体一次都不进，而入口那一次仍然要跑。
  //   保坏 —— 跑起来了，体把它改坏；体末那一次要拦住。
  //   好   —— 都成立，开关两边输出一样。
  const 空诊断2 = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const 语法 = "fn main() -> Int {\n  var i = 0\n  while i < 3 invariant i >= 0 {\n    i = i + 1\n  }\n  print(str(i))\n  return 0\n}\n";
  // 宿主把 当 当表达式、语句层包一层；自举那一层直接把它当语句。两边都取到底下的那个。
  const 取当 = (s) => (s && s.kind === "当" ? s : (s ? s.expr : null));
  const 甲 = 取当(parse(lex(语法).tokens, { diagnostics: 空诊断2 }).ast.decls[0].body.statements[1]);
  ok("宿主那棵树里那个当有 invariant", 甲 && 甲.kind === "当" && 甲.invariant && 甲.invariant.kind, JSON.stringify(甲 && Object.keys(甲)));
  const 乙 = 取当(子集解(切(语法)).ast.decls[0].body.statements[1]);
  ok("子集那一层也认", 乙 && 乙.kind === "当" && 乙.invariant && 乙.invariant.kind, JSON.stringify(乙 && Object.keys(乙)));

  const 入坏 = "fn main() -> Int {\n  var i = 5\n  while i < 0 invariant i >= 10 {\n    i = i + 1\n  }\n  print(str(i))\n  return 0\n}\n";
  const 保坏 = "fn main() -> Int {\n  var i = 0\n  while i < 3 invariant i >= 0 {\n    i = i - 1\n  }\n  print(str(i))\n  return 0\n}\n";
  const 好 = 语法;
  const 一句 = "第 3 行的循环不变式不成立";

  // ---- 解释那台 ----
  const 关入 = 跑(入坏, false);
  ok("关档：入口不成立也照样跑完", 关入.diagnostics.errors.length === 0 && 关入.output.join("") === "5", JSON.stringify([码(关入), 关入.output]));
  const 开入 = 跑(入坏, true);
  ok("开档：0 轮也查入口那一次", 码(开入).includes("HMYR-契-004"), JSON.stringify(码(开入)));
  ok("解释那台说的是那一句", 话(开入).some((m) => m === 一句), JSON.stringify(话(开入)));
  const 开保 = 跑(保坏, true);
  ok("开档：保持不成立停在体末", 码(开保).includes("HMYR-契-004"), JSON.stringify(码(开保)));
  const 关好 = 跑(好, false), 开好 = 跑(好, true);
  ok("都成立时两边输出一样且是 3", 关好.diagnostics.errors.length === 0 && 开好.diagnostics.errors.length === 0 && 关好.output.join("") === "3" && 开好.output.join("") === "3", JSON.stringify([关好.output, 开好.output]));

  // ---- 字节码那台 ----
  const 新诊断 = () => ({
    items: [], errors: [], warnings: [],
    add(severity, code, message, line, column) {
      const one = { severity, code, message, line, column };
      this.items.push(one);
      if (severity === "error") this.errors.push(one);
    },
    error(code, message, line, column) { this.add("error", code, message, line, column); },
    warn(code, message, line, column) { this.add("warning", code, message, line, column); },
  });
  const 宿主读 = (source) => {
    const d = 新诊断();
    const { ast } = parse(lex(source).tokens, { diagnostics: d });
    return { ast, diagnostics: d };
  };
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-loopinv-"));
  const 写文件 = (名, 文) => { const p = path.join(临, 名); fs.writeFileSync(p, 文, "utf8"); return p; };
  const 跑码 = (源, 强, 名) => {
    const 源路 = 写文件(名 + ".hmoca", 源);
    let 出 = "";
    const vm = 跑字节码(loadUnit(源路, { reader: 宿主读 }), {
      contracts: 强, capabilities: 本机能力(),
      write: (t) => { 出 += t; }, writeErr: (t) => { 出 += t; },
    });
    const r = vm.调用("main", [], null);
    return { ok: r.ok, 码: r.ok ? "" : r.码, 话: r.ok ? "" : r.话, 出 };
  };
  const 字节入 = 跑码(入坏, true, "字节入");
  ok("字节码那台：入口也拦住", !字节入.ok && 字节入.码 === "HMYR-契-004", JSON.stringify([字节入.ok, 字节入.码, 字节入.话]));
  ok("字节码那台说的是同一句", 字节入.话 === 一句, JSON.stringify(字节入.话));
  const 字节保 = 跑码(保坏, true, "字节保");
  ok("字节码那台：保持不成立也拦住", !字节保.ok && 字节保.码 === "HMYR-契-004", JSON.stringify([字节保.ok, 字节保.码, 字节保.话]));
  const 字节关 = 跑码(入坏, false, "字节关");
  ok("字节码那台：关档跑得过去", 字节关.ok && 字节关.出 === "5", JSON.stringify([字节关.ok, 字节关.出]));

  // ---- 自举解释那台 ----
  // 失败形状与别处不同（运行时错被包成「错：…」并退出 0），所以看输出不看退出码。
  const 入路 = 写文件("自入.hmoca", 入坏), 保路 = 写文件("自保.hmoca", 保坏), 好路 = 写文件("自好.hmoca", 好);
  const 跑自 = (路, 开) => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), 路, ...(开 ? ["--contracts"] : [])], { encoding: "utf8", timeout: 180000 });
    return { 出: String(r.stdout || ""), 错: String(r.stderr || ""), 码: r.status };
  };
  const 自入 = 跑自(入路, true);
  ok("自举那台：开了就拦住", 自入.出.includes("HMYR-契-004"), JSON.stringify(自入.出.trim().slice(0, 90)));
  ok("自举那台说的是同一句", 自入.出.includes(一句), JSON.stringify(自入.出.trim().slice(0, 90)));
  const 自关 = 跑自(入路, false);
  ok("自举那台：关档跑得过去", 自关.出.startsWith("5"), JSON.stringify(自关.出.trim().slice(0, 40)));
  const 自好 = 跑自(好路, true);
  ok("自举那台：都成立时输出 3", 自好.出.startsWith("3"), JSON.stringify(自好.出.trim().slice(0, 40)));
  const 自保 = 跑自(保路, true);
  ok("自举那台：保持不成立也拦住", 自保.出.includes("HMYR-契-004"), JSON.stringify(自保.出.trim().slice(0, 90)));

  // ---- 子集编译器那台 ----
  // 它没有开关，编出来一律是强档流（design/CONTRACTS.txt 那一节写了理由）。
  const 字节路 = path.join(ROOT, "runtime/pack.hmoks");
  if (!fs.existsSync(字节路)) {
    ok("runtime/pack.hmoks 在", false, "先跑 node tools/emit-code.mjs self/pack.hmoca runtime/pack.hmoks");
  } else {
    const 种子 = new 虚拟机(读程序(fs.readFileSync(字节路)), {
      capabilities: 本机能力(), stepLimit: 400000000, maxDepth: 4000,
    });
    const 取 = (v, k) => (v && v.fields ? v.fields.get(k) : (v ? v[k] : undefined));
    const 拍平 = (v, acc = []) => {
      if (typeof v === "number") { acc.push(v); return acc; }
      if (v && v.tag === "tuple") { for (const x of v.items) 拍平(x, acc); return acc; }
      if (Array.isArray(v)) { for (const x of v) 拍平(x, acc); return acc; }
      if (v && v.tag === "record") { for (const [, x] of v.fields) 拍平(x, acc); return acc; }
      return acc;
    };
    const 子集跑 = (源) => {
      const 编r = 种子.调用("编源码", [源, 1], null);
      if (!编r || !编r.ok) return { ok: false, 崩: String(编r && 编r.码 ? 编r.码 + " " + 编r.话 : "编源码 停机") };
      const 包r = 种子.调用("打包", [取(编r.值, "函数族")], null);
      if (!包r || !包r.ok) return { ok: false, 崩: String(包r && 包r.码 ? 包r.码 + " " + 包r.话 : "打包 停机") };
      let 出 = "";
      const vm = new 虚拟机(读程序(Buffer.from(拍平(包r.值))), {
        capabilities: 本机能力(), write: (t) => { 出 += t; }, writeErr: (t) => { 出 += t; },
      });
      const r = vm.调用("main", [], null);
      return { ok: r.ok, 码: r.ok ? "" : r.码, 话: r.ok ? "" : r.话, 出, 崩: "" };
    };
    const 子入 = 子集跑(入坏);
    ok("子集编译器那台：入口也拦住", 子入.ok === false && 子入.码 === "HMYR-契-004", JSON.stringify([子入.ok, 子入.码, 子入.话, 子入.崩]));
    ok("子集编译器那台说的是同一句", String(子入.话 || "") === 一句, JSON.stringify(子入.话 || 子入.崩));
    const 子好 = 子集跑(好);
    ok("子集编译器那台：都成立时输出 3", 子好.ok === true && 子好.出 === "3", JSON.stringify([子好.ok, 子好.码, 子好.出, 子好.崩]));
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
