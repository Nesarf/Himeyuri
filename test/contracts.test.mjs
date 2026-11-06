// 契约的强档：requires 与 ensures 在运行时查（design/CONTRACTS.txt）。
//
// 两条一起才说明 SPEC §2.4 那条硬条款是真的：三只旋钮只改检查强度、不改语义。
//   一、契约都成立的程序，开关两边跑出同样的输出。
//   二、契约不成立的程序，关档跑得过去（那是今天的样子），开档在第一条上停住。
// 只有前一条，说明检查没生效；只有后一条，说明检查会改变正常程序的行为。
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
import { 最小运行 } from "../src/minimal-eval.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { 读程序, 写程序 } from "../src/code-file.mjs";
import { 本机能力 } from "../src/capabilities.mjs";
import { 平台参数 } from "../src/cc.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

console.log("十、minimal-eval 那台：开关在它上面也有意义");
{
  // 要说清这一台的位置：bin/hmyr.mjs 的默认路用 最小运行 跑的是**自举解释器**，
  // 不是用户的程序。所以「用户在默认路上写契约」要等 self/eval.hmoca 那一台 ——
  // 契约不在这条路上被查，不是因为这一台没做，而是因为这一台跑的不是那段源码。
  //
  // 这一节钉的是另一件事：同一个开关在它上面也有意义，而且与另外两台给出同一句话。
  // 四台一致从这一句开始，而不是从「用户点得到」开始。
  const 新诊断2 = () => ({
    items: [], errors: [], warnings: [],
    add(severity, code, message, line, column) {
      const one = { severity, code, message, line, column };
      this.items.push(one);
      if (severity === "error") this.errors.push(one);
    },
    error(code, message, line, column) { this.add("error", code, message, line, column); },
    warn(code, message, line, column) { this.add("warning", code, message, line, column); },
  });
  const 宿主读2 = (source) => {
    const d = 新诊断2();
    const { ast } = parse(lex(source).tokens, { diagnostics: d });
    return { ast, diagnostics: d };
  };
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-contract-min-"));
  const 写 = (名, 文) => { const p = path.join(临, 名); fs.writeFileSync(p, 文); return p; };
  const 坏 = 写("坏.hmoca", "fn 取(n: Int) -> Int requires n > 0 {\n  return n\n}\nfn main() -> Int {\n  print(str(取(0 - 5)))\n  return 0\n}\n");
  const 好 = 写("好.hmoca", "fn 取(n: Int) -> Int requires n > 0 ensures 返回值 > 0 {\n  return n * 2\n}\nfn main() -> Int {\n  print(str(取(3)))\n  return 0\n}\n");
  const 跑 = (路, 强) => {
    let 出 = "";
    const rt = 最小运行(loadUnit(路, { reader: 宿主读2 }), {
      capabilities: 本机能力(), contracts: 强, write: (t) => { 出 += t; },
    });
    try { rt.callFunction(rt.functions.get("main"), [], null); }
    catch (e) { return { ok: false, 码: e.code || "", 话: e.message || "", 出 }; }
    return { ok: true, 码: "", 话: "", 出 };
  };
  const 关坏 = 跑(坏, false), 开坏 = 跑(坏, true);
  ok("关档跑得过去", 关坏.ok && 关坏.出 === "-5", JSON.stringify([关坏.ok, 关坏.码, 关坏.出]));
  ok("开档停在 HMYR-契-001", !开坏.ok && 开坏.码 === "HMYR-契-001", JSON.stringify([开坏.ok, 开坏.码, 开坏.话]));
  ok("与另外两台说的是同一句", 开坏.话 === "函数 取 的第 1 条 requires 不成立", JSON.stringify(开坏.话));
  const 关好 = 跑(好, false), 开好 = 跑(好, true);
  ok("契约都成立时两边输出一样", 关好.ok && 开好.ok && 关好.出 === 开好.出 && 关好.出 === "6", JSON.stringify([关好.ok, 关好.出, 开好.ok, 开好.出]));
}

console.log("十一、C 那台：契约已经在字节码里，所以它只差一个内置");
{
  // 这一节要说的道理很短：C 那台执行的是**已经编好的字节码**，而契约检查是编译器
  // 编进去的。所以它不需要自己的契约实现，只需要认「契约失败」这个名字。
  // 判据因此不是「它自己也查一遍」，而是「同一份字节在它那里给出同一个答案与同一句话」。
  const 有gcc = (() => { try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; } })();
  if (!有gcc) {
    console.log("  跳过  这台机器上没有 gcc");
  } else {
    const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-contract-c-"));
    const exe = path.join(临, "hmyr.exe");
    const cc = spawnSync("gcc", ["-std=c11", "-O3", ...平台参数(), "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
    ok("C 那台编得出来", cc.status === 0, String(cc.stderr).slice(0, 160));
    if (cc.status === 0) {
      const 新诊断3 = () => ({
        items: [], errors: [], warnings: [],
        add(severity, code, message, line, column) {
          const one = { severity, code, message, line, column };
          this.items.push(one);
          if (severity === "error") this.errors.push(one);
        },
        error(code, message, line, column) { this.add("error", code, message, line, column); },
        warn(code, message, line, column) { this.add("warning", code, message, line, column); },
      });
      const 宿主读3 = (source) => {
        const d = 新诊断3();
        const { ast } = parse(lex(source).tokens, { diagnostics: d });
        return { ast, diagnostics: d };
      };
      const 跑 = (源, 强, 名) => {
        const 源路 = path.join(临, 名 + ".hmoca");
        fs.writeFileSync(源路, 源, "utf8");
        const unit = loadUnit(源路, { reader: 宿主读3 });
        const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件), { contracts: 强 })));
        const 码路 = path.join(临, 名 + ".hmoks");
        fs.writeFileSync(码路, 写程序(程序));
        const r = spawnSync(exe, [码路], { encoding: "utf8", timeout: 120000 });
        return { 出: String(r.stdout || "").trim(), 错: String(r.stderr || ""), 码: r.status };
      };
      const 好源 = "fn 取(n: Int) -> Int requires n > 0 ensures 返回值 > 0 {\n  return n * 2\n}\nfn main() -> Int {\n  print(str(取(3)))\n  return 0\n}\n";
      const 坏源 = "fn 取(n: Int) -> Int requires n > 0 {\n  return n\n}\nfn main() -> Int {\n  print(str(取(0 - 5)))\n  return 0\n}\n";
      const 关坏 = 跑(坏源, false, "关坏"), 开坏 = 跑(坏源, true, "开坏");
      ok("关档跑得过去", 关坏.码 === 0 && 关坏.出 === "-5", JSON.stringify([关坏.码, 关坏.出]));
      ok("开档停在 HMYR-契-001", 开坏.码 === 1 && 开坏.错.includes("HMYR-契-001"), JSON.stringify([开坏.码, 开坏.错.slice(0, 80)]));
      ok("消息与 JS 那三台同一句", 开坏.错.includes("函数 取 的第 1 条 requires 不成立"), JSON.stringify(开坏.错.slice(0, 80)));
      const 关好 = 跑(好源, false, "关好"), 开好 = 跑(好源, true, "开好");
      ok("契约都成立时两台输出一样", 关好.出 === "6" && 开好.出 === "6", JSON.stringify([关好.出, 开好.出]));
    }
  }
}

console.log("十二、自举那台：默认路（解释）也查了");
{
  // 五台里最后补上的一台，而它正是「用户不给 --compile 时」走的那条路。
  //
  // 开关走命令行而不是环境：自举层读不到环境变量（locale_env 交回的是语言环境猜测，
  // 不是环境），而 argv 本来就是它的。见 self/eval.hmoca 的 跑程序带常量与参。
  //
  // 输出要留意：解释那一条会把 main 的返回值也打出来（self/run.hmoca 顶部那段注释），
  // 所以 -5 会变成 -50、6 会变成 60。判据因此看前缀，不看相等。
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-contract-self-"));
  const 写 = (名, 文) => { const p = path.join(临, 名); fs.writeFileSync(p, 文, "utf8"); return p; };
  const 坏 = 写("坏.hmoca", "fn 取(n: Int) -> Int requires n > 0 {\n  return n\n}\nfn main() -> Int {\n  print(str(取(0 - 5)))\n  return 0\n}\n");
  const 好 = 写("好.hmoca", "fn 取(n: Int) -> Int requires n > 0 ensures 返回值 > 0 {\n  return n * 2\n}\nfn main() -> Int {\n  print(str(取(3)))\n  return 0\n}\n");
  const 跑 = (路, 开) => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), 路, ...(开 ? ["--contracts"] : [])], { encoding: "utf8", timeout: 180000 });
    return { 出: String(r.stdout || ""), 错: String(r.stderr || ""), 码: r.status };
  };
  const 关坏 = 跑(坏, false), 开坏 = 跑(坏, true);
  ok("关档跑得过去", 关坏.码 === 0 && 关坏.出.startsWith("-5"), JSON.stringify([关坏.码, 关坏.出.trim()]));
  // 失败形状与另外四台不同，而那不是这次改出来的：self/run.hmoca 的 跑模块族 把运行期的错
  // 包成「错：…」当成正常文字交回去，于是 命令行入口 打印它并以 0 退出。
  // 所以这一条的判据看输出里有没有那个码与那句话，不看退出码 ——
  // 若将来那一层改成「运行错误以非零退出」，这条判据要跟着改成看码，而不是两边都放宽。
  ok("开档停在 HMYR-契-001", 开坏.出.includes("HMYR-契-001"), JSON.stringify([开坏.码, 开坏.出.trim().slice(0, 80)]));
  ok("消息与另外四台同一句", 开坏.出.includes("函数 取 的第 1 条 requires 不成立"), JSON.stringify(开坏.出.trim().slice(0, 80)));
  const 关好 = 跑(好, false), 开好 = 跑(好, true);
  ok("契约都成立时两台输出一样", 关好.出.startsWith("6") && 开好.出.startsWith("6"), JSON.stringify([关好.出.trim(), 开好.出.trim()]));
}

console.log("十三、子集编译器：它编出的字节里，契约真的在");
{
  // 第五条编路：self/compile.hmoca。
  //
  // 它在 2026-11-02 之前只读声明的头四件 —— 第九格的契约从不打开。于是拿它编一份
  // 带契约的源码，那些条件会静默消失：没有错，没有警告，只是不再查。
  // 这一节盯的就是「它不再静默」，而判据分成两层：
  //   一、两台编译器逐字节一致（tools/self-vm-compile.mjs 那一套钉这一层）；
  //   二、同一份字节跑在 vm 上，坏契约要停在 HMYR-契-001（这一节钉这一层）。
  // 只有第一层，说明两边错得一样；只有第二层，说明不了子集交的就是同一份字节。
  //
  // 与另外几台的形状差别要说清：这一位没有开关。编源码 不带选项，编出来的永远是强档流。
  // 所以这里没有「关档跑得过去」那一半 —— 那一半在字节码那台（第九节）钉着。
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
    // 契约分行写：自举那一层靠行尾切条件，写在签名同一行会把 { 也吃进去。
    const 坏源 = "fn 取(n: Int) -> Int\n  requires n > 0\n{\n  return n\n}\nfn main() -> Int {\n  print(str(取(0 - 5)))\n  return 0\n}\n";
    const 好源 = "fn 取(n: Int) -> Int\n  requires n > 0\n  ensures 返回值 > 0\n{\n  return n * 2\n}\nfn main() -> Int {\n  print(str(取(3)))\n  return 0\n}\n";
    const 坏 = 子集跑(坏源);
    ok("坏契约停在 HMYR-契-001", 坏.ok === false && 坏.码 === "HMYR-契-001", JSON.stringify([坏.ok, 坏.码, 坏.话, 坏.崩]));
    ok("消息与另外五台同一句", String(坏.话 || "").includes("函数 取 的第 1 条 requires 不成立"), JSON.stringify(坏.话 || 坏.崩));
    const 好 = 子集跑(好源);
    ok("好契约跑出 6", 好.ok === true && 好.出 === "6", JSON.stringify([好.ok, 好.码, 好.出, 好.崩]));
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
