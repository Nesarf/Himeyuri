// 契约的强档：requires 与 ensures 在运行时查（design/CONTRACTS.txt）。
//
// 两条一起才说明 SPEC §2.4 那条硬条款是真的：三只旋钮只改检查强度、不改语义。
//   一、契约都成立的程序，开关两边跑出同样的输出。
//   二、契约不成立的程序，关档跑得过去（那是今天的样子），开档在第一条上停住。
// 只有前一条，说明检查没生效；只有后一条，说明检查会改变正常程序的行为。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../src/eval.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { loadUnit } from "../src/loader.mjs";
import { 跑字节码 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 码 = (r) => r.diagnostics.errors.map((e) => e.code);
const 话 = (r) => r.diagnostics.errors.map((e) => e.message);
const 跑 = (源, 开) => run(源, 开 ? { contracts: true } : {});

console.log("一、关档：写了契约也等于没写（今天的样子）");
{
  const 源 = "fn 取(n: Int) -> Int requires n > 0 ensures 返回值 > 0 { return n }\nfn main() { print(str(取(0 - 5))) }\n";
  const r = 跑(源, false);
  ok("契约不成立也照样跑完", r.diagnostics.errors.length === 0, JSON.stringify(码(r)));
  ok("输出的就是那个坏值", r.output.join("") === "-5", JSON.stringify(r.output));
}

console.log("二、开档：requires 不成立");
{
  const 源 = "fn 取(n: Int) -> Int requires n > 0 { return n }\nfn main() { print(str(取(0 - 5))) }\n";
  const r = 跑(源, true);
  ok("码是 HMYR-契-001", 码(r).includes("HMYR-契-001"), JSON.stringify(码(r)));
  ok("消息里有函数名与第几条", 话(r).some((m) => m.includes("取") && m.includes("第 1 条") && m.includes("requires")), JSON.stringify(话(r)));
  ok("没有跑出输出", r.output.length === 0, JSON.stringify(r.output));
}

console.log("三、开档：ensures 不成立");
{
  const 源 = "fn 取(n: Int) -> Int ensures 返回值 > 0 { return 0 - n }\nfn main() { print(str(取(1))) }\n";
  const r = 跑(源, true);
  ok("码是 HMYR-契-002", 码(r).includes("HMYR-契-002"), JSON.stringify(码(r)));
  ok("消息里带函数名与 ensures", 话(r).some((m) => m.includes("取") && m.includes("ensures")), JSON.stringify(话(r)));
}

console.log("四、硬条款：契约都成立时，开关两边同样");
{
  const 源 = "fn 取(n: Int) -> Int requires n > 0 ensures 返回值 > 0 { return n * 2 }\nfn main() { print(str(取(3))) }\n";
  const 关 = 跑(源, false), 开 = 跑(源, true);
  ok("关档没有错", 关.diagnostics.errors.length === 0, JSON.stringify(码(关)));
  ok("开档也没有错", 开.diagnostics.errors.length === 0, JSON.stringify(码(开)));
  ok("两边输出一样", 关.output.join("") === 开.output.join(""), JSON.stringify([关.output, 开.output]));
  ok("输出是 6", 关.output.join("") === "6", JSON.stringify(关.output));
}

console.log("五、多条契约：报的是第一条不成立的");
{
  const 源 = "fn 取(n: Int) -> Int requires n > 0 requires n < 10 { return n }\nfn main() { print(str(取(50))) }\n";
  const r = 跑(源, true);
  ok("说的是第 2 条", 话(r).some((m) => m.includes("第 2 条")), JSON.stringify(话(r)));
}

console.log("六、ensures 同时看得见参数与返回值");
{
  const 源 = "fn 加(a: Int, b: Int) -> Int ensures 返回值 == a + b { return a + b }\nfn main() { print(str(加(2, 3))) }\n";
  const r = 跑(源, true);
  ok("两个名字都在、条件成立", r.diagnostics.errors.length === 0, JSON.stringify(码(r)));
  ok("输出是 5", r.output.join("") === "5", JSON.stringify(r.output));
}

console.log("七、契约条件自己出错：报的是那个错，不是契约错");
{
  const 源 = "fn 取(n: Int) -> Int requires 没有这个名字 > 0 { return n }\nfn main() { print(str(取(1))) }\n";
  const r = 跑(源, true);
  ok("报的是 HMYR-行-005", 码(r).includes("HMYR-行-005"), JSON.stringify(码(r)));
  ok("没有报成契约错", !码(r).some((c) => c.startsWith("HMYR-契")), JSON.stringify(码(r)));
}

console.log("八、没有契约的函数不受开关影响");
{
  const 源 = "fn 加(a: Int, b: Int) -> Int { return a + b }\nfn main() { print(str(加(2, 3))) }\n";
  const 关 = 跑(源, false), 开 = 跑(源, true);
  ok("两边都没有错", 关.diagnostics.errors.length === 0 && 开.diagnostics.errors.length === 0, JSON.stringify([码(关), 码(开)]));
  ok("两边输出一样且是 5", 关.output.join("") === 开.output.join("") && 关.output.join("") === "5", JSON.stringify([关.output, 开.output]));
}

console.log("九、字节码那台：同一个开关，两个字节流，同样的判断");
{
  // 这一节走的路与启动器 --compile 同一条：装载、编译、跑。
  // 契约不进子集解析器（它的立场是只认 self/ 六份用到的构造），所以这里显式用宿主
  // reader。启动器 --compile 今天仍被子集 reader 卡住 —— 那是一条待收的口，
  // 写在 design/CONTRACTS.txt 第六节，而不是假装这一节已经等于「用户点得到」。
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

  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-contract-"));
  const 写 = (名, 文) => { const p = path.join(临, 名); fs.writeFileSync(p, 文); return p; };
  const 好 = 写("好.hmoca", "fn 取(n: Int) -> Int requires n > 0 ensures 返回值 > 0 {\n  return n * 2\n}\nfn main() -> Int {\n  print(str(取(3)))\n  return 0\n}\n");
  const 坏 = 写("坏.hmoca", "fn 取(n: Int) -> Int requires n > 0 {\n  return n\n}\nfn main() -> Int {\n  print(str(取(0 - 5)))\n  return 0\n}\n");
  const 跑 = (路, 强) => {
    let 出 = "";
    const vm = 跑字节码(loadUnit(路, { reader: 宿主读 }), {
      contracts: 强, capabilities: 本机能力(),
      write: (t) => { 出 += t; }, writeErr: (t) => { 出 += t; },
    });
    const r = vm.调用("main", [], null);
    return { ok: r.ok, 码: r.ok ? "" : r.码, 话: r.ok ? "" : r.话, 出 };
  };

  const 关好 = 跑(好, false), 开好 = 跑(好, true);
  ok("契约都成立时，关档跑得动", 关好.ok && 关好.出 === "6", JSON.stringify([关好.ok, 关好.码, 关好.出]));
  ok("契约都成立时，开档也跑得动", 开好.ok && 开好.出 === "6", JSON.stringify([开好.ok, 开好.码, 开好.出]));
  const 关坏 = 跑(坏, false), 开坏 = 跑(坏, true);
  ok("契约不成立时，关档跑得过去", 关坏.ok && 关坏.出 === "-5", JSON.stringify([关坏.ok, 关坏.码, 关坏.出]));
  ok("契约不成立时，开档停在 HMYR-契-001", !开坏.ok && 开坏.码 === "HMYR-契-001", JSON.stringify([开坏.ok, 开坏.码, 开坏.话]));
  ok("消息里有函数名与第几条", 开坏.话.includes("取") && 开坏.话.includes("第 1 条"), JSON.stringify(开坏.话));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
