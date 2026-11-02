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
import { 跑字节码 } from "../src/vm.mjs";
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

console.log("四、为什么「出口不成立」不在这里验");
{
  // 要造一条「入口成立、出口不成立」的不变式，就得让函数改掉不变式引用的那个东西，
  // 而参数是不可写的（它是 定 绑的），于是只剩下模块级 var。
  //
  // 而解释这条路今天拒绝它：scope.assign 只沿作用域链走，不碰运行时的全局表，
  // 于是 `状态 = 1` 报 HMYR-行-017。字节码那台不一样 —— 编译器的 赋值 会回退到
  // 「槽里没有就是模块级」并生成 全域存。那是既有的不一致，不属于这一件该顺手动的东西，
  // 所以出口那两条判据放到第十一节（那里跑的是字节码）。
  // 这条样本要带一条契约：宿主解析器在「签名之后换行、再写 {」时不认那个体
  // （atPunct("{") 在换行上为假，body 成了 null）。有契约时 contracts 那一圈
  // 会把换行吃掉，形状才对 —— 那是既有行为，与不变式无关，这里绕开它而不是改它。
  ok("解释这一路拒绝写模块级 var（写下来，免得下次当成 bug 重查）", 跑("var 状态 = 0\nfn 进() -> Int\n  requires 1 == 1\n{\n  状态 = 1\n  return 0\n}\nfn main() { print(str(进())) }\n", false).diagnostics.errors.some((e) => e.code === "HMYR-行-017"), JSON.stringify(码(跑("var 状态 = 0\nfn 进() -> Int\n  requires 1 == 1\n{\n  状态 = 1\n  return 0\n}\nfn main() { print(str(进())) }\n", false))));
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

console.log("六、字节码那台：出口的不变式在这里才验得动");
{
  // 那一台能验出口，因为它的编译器把「槽里没有」的赋值编成 全域存；
  // 解释那一路拒绝它（第四节写下了这件事）。
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

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
