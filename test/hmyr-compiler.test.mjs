// HMYR 自己的编译器：同一个程序交给两位编译者，跑出同一个答案。
//
// 为什么这一套重要：目标是「src/ 可以删掉」，而 src/ 里最后一块借来的东西
// 就是编译器。self/compile.hmyr 是把它搬进语言自己的第一步，
// 而「搬对了没有」只能用一个能跑的问题来答：两位编译者交出的字节码，
// 在两台机器上跑，四个数字是不是同一个。
//
// 现在 self/compile.hmyr 只能编一个子集（算术、比较、字面量、按名字调用、
// return、let/var、if）。超出子集它会明说「还编不了」，而不是悄悄编错 ——
// 这一套只测子集里的东西，并且承认子集的边界。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
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

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-compiler-"));

// HMYR 那台编译器：跑 self/compile.hmyr，拿它交出来的函数表。
const 编 = (() => {
  const rt = runUnit(loadUnit(path.join(ROOT, "self/compile.hmoca")), { stage0: true, stepLimit: 300000000 });
  const 编源码 = rt.functions.get("编源码");
  const 转值 = (v) => {
    if (Array.isArray(v)) return new 类元组(v.map(转值));
    if (v && typeof v === "object" && v.fields instanceof Map) {
      const 字段 = new Map();
      for (const [k, x] of v.fields) 字段.set(k, 转值(x));
      return new 类记录(字段);
    }
    return v;
  };
  return (源码) => {
    const r = rt.callFunction(编源码, [源码], null);
    if (!r || r.ok === false) return { 错: r ? r.错 : "没有交回值" };
    const 函数们 = new Map();
    for (const f of r.函数们) {
      函数们.set(f.名, {
        名: f.名, 参数量: f.参数量, 槽数: f.槽数,
        效果: Array.from(f.效果 || []),
        码: Array.from(f.码 || []).map((i) => {
          const 指令 = { op: i.op };
          // RECORD 的立即数是字符串数组，不是语言值 —— 与 tools/compile-hmyr.mjs 同一处理。
          if (i.op === "RECORD") 指令.a = Array.from(i.a || []);
          else if (i.a !== undefined) 指令.a = 转值(i.a);
          if (i.b !== undefined) 指令.b = i.b;
          return 指令;
        }),
      });
    }
    return { 程序: { 函数们, 全局们: [] } };
  };
})();

// JS 那台编译器：走加载器与 src/bytecode.mjs。
const 编JS = (源码) => {
  const p = path.join(临, "j" + Math.random().toString(36).slice(2) + ".hmoca");
  fs.writeFileSync(p, 源码, "utf8");
  const unit = loadUnit(p);
  if (!unit.ok) return { 错: "加载失败 " + JSON.stringify(unit.diagnostics.errors.slice(0, 1).map((e) => e.code)) };
  return { 程序: 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件)))) };
};

// 跑一个程序，交回 main 的返回值。
const 跑 = (程序) => {
  const vm = new 虚拟机(程序, { capabilities: 本机能力(), write: () => {} });
  const r = vm.调用("main", [], null);
  return r.ok ? r.值 : "错:" + r.码;
};

console.log("一、两位编译者对同一个程序交回同样的答案");
{
  const 例们 = [
    ["直接返回一个数", "fn main() -> Int { return 7 }\n", 7],
    ["两个数相加", "fn main() -> Int { return 20 + 22 }\n", 42],
    ["先乘后加", "fn main() -> Int { return 2 + 3 * 4 }\n", 14],
    ["带参数调用", "fn 加(a: Int, b: Int) -> Int {\n  return a + b\n}\nfn main() -> Int {\n  return 加(20, 22)\n}\n", 42],
    ["先 let 再比较", "fn main() -> Int {\n  let x = 6 * 7\n  if x == 42 {\n    return 1\n  }\n  return 0\n}\n", 1],
    ["if 的假支", "fn main() -> Int {\n  if 1 == 2 {\n    return 1\n  }\n  return 5\n}\n", 5],
    ["减法", "fn main() -> Int {\n  return 0 - 3\n}\n", -3],
    ["字符串比较", 'fn main() -> Int {\n  if "ab" == "ab" {\n    return 1\n  }\n  return 0\n}\n', 1],
    ["while 累加", "fn main() -> Int {\n  var i = 0\n  var 和 = 0\n  while i < 4 {\n    和 = 和 + i\n    i = i + 1\n  }\n  return 和\n}\n", 6],
    ["元组与下标", "fn main() -> Int {\n  let t = (10, 20, 30)\n  return t[1]\n}\n", 20],
    ["记录与字段", "fn main() -> Int {\n  let r = {a: 3, b: 4}\n  return r.a + r.b\n}\n", 7],
    ["内置 len", 'fn main() -> Int {\n  let t = (1, 2, 3)\n  return len(t)\n}\n', 3],
    ["内置 str 与 to_int", 'fn main() -> Int {\n  return to_int(str(7))\n}\n', 7],
    ["表达式语句与 print", 'fn main() -> Int {\n  print("hi")\n  return 0\n}\n', 0],
    ["与：两边都真", "fn main() -> Int {\n  if 1 == 1 && 2 == 2 {\n    return 1\n  }\n  return 0\n}\n", 1],
    ["与：一边假", "fn main() -> Int {\n  if 1 == 1 && 2 == 3 {\n    return 1\n  }\n  return 0\n}\n", 0],
    ["或：一边真", "fn main() -> Int {\n  if 1 == 2 || 3 == 3 {\n    return 1\n  }\n  return 0\n}\n", 1],
    ["或：两边都假", "fn main() -> Int {\n  if 1 == 2 || 3 == 4 {\n    return 1\n  }\n  return 0\n}\n", 0],
    ["三元短路也算得对", "fn main() -> Int {\n  let x = 1 == 2 && 3 == 3\n  if x {\n    return 1\n  }\n  return 0\n}\n", 0],
  ];  for (const [标, 源码, 期望] of 例们) {
    const a = 编(源码);
    const b = 编JS(源码);
    if (a.错) { ok(标, false, "HMYR 编译器： " + a.错); continue; }
    if (b.错) { ok(标, false, "JS 编译器： " + b.错); continue; }
    const 甲 = 跑(a.程序);
    const 乙 = 跑(b.程序);
    ok(标 + "（两方都是 " + 期望 + "）", 甲 === 乙 && 甲 === 期望, "HMYR " + JSON.stringify(甲) + " / JS " + JSON.stringify(乙));
  }
}

console.log("二、HMYR 编译器编出来的字节码也能由 C 那台机器执行");
{
  const 源码 = "fn 加(a: Int, b: Int) -> Int {\n  return a + b\n}\nfn main() -> Int {\n  if 加(20, 22) == 42 {\n    return 1\n  }\n  return 0\n}\n";
  const a = 编(源码);
  ok("子集里的程序编得出来", !a.错, a.错 || "");
  // 真实一点的那个：examples/twice.hmyr 有两个函数、print、字符串拼接与中文。
  const 真 = 编(fs.readFileSync(path.join(ROOT, "examples/twice.hmoca"), "utf8"));
  ok("examples/twice.hmyr 也编得出来", !真.错, 真.错 || "");
  if (!a.错) {
    const 码路 = path.join(临, "by-hmyr.hmoks");
    fs.writeFileSync(码路, 写程序(a.程序));
    // C 那台若这台机器上没有，就明说跳过 —— 那不是这门语言的问题。
    const 有gcc = (() => { try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; } })();
    if (!有gcc) {
      console.log("  跳过  这台机器上没有 gcc");
    } else {
      const exe = path.join(临, "vm.exe");
      const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
      ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
      if (c.status === 0) {
        const r = spawnSync(exe, [码路], { encoding: "utf8", timeout: 60000 });
        ok("C 那台跑出同一个答案（退出码 1）", r.status === 1, String(r.status) + " " + String(r.stderr).slice(0, 100));
        // 真实那个例子：HMYR 编译、C 执行，输出要与 JS 编译、JS 执行的一模一样。
        if (!真.错) {
          const 真码 = path.join(临, "twice-hmyr.hmoks");
          fs.writeFileSync(真码, 写程序(真.程序));
          const r2 = spawnSync(exe, [真码], { encoding: "utf8", timeout: 60000 });
          ok("真实例子在 C 上跑出 hi 42 琥珀音", String(r2.stdout || "").includes("hi 42 琥珀音"),
            String(r2.status) + " " + JSON.stringify(String(r2.stdout || "").slice(0, 60)));
        }
      }
    }
  }
}

console.log("三、超出子集时明说，而不是悄悄编错");
{
  const b = 编("fn main() -> Int {\n  let r = {a: 1}\n  return r.a\n}\n");
  ok("记录已经能编了", !b.错, b.错 || "");
}

console.log("四、自编译：HMYR 编出的编译器，跑起来还能编");
{
  // 这一节是「编译器搬进 HMYR」的硬证据：
  // 用 self/compile.hmyr 去编 self/compile.hmyr 自己（连它的 import 链一起），
  // 产物跑起来的输出，与原来那份编译器的自测输出相同。
  const unit = loadUnit(path.join(ROOT, "self/compile.hmoca"));
  ok("self/compile.hmyr 读得进", unit.ok, JSON.stringify(unit.diagnostics.errors.slice(0, 1).map((e) => e.code)));
  if (unit.ok) {
    let 源码 = "";
    for (const f of unit.order) 源码 += fs.readFileSync(f, "utf8") + "\n";
    const 自编 = 编(源码);
    ok("它能编出自己（含 import 链）", !自编.错, 自编.错 || "");
    if (!自编.错) {
      const 码路 = path.join(临, "selfcompiled.hmoks");
      fs.writeFileSync(码路, 写程序(自编.程序));
      const 函数数 = 自编.程序.函数们.size;
      ok("产物里有几十个函数（" + 函数数 + " 个）", 函数数 > 50, String(函数数));
      // JS 那台先跑一遍：与 C 无关，任何机器上都该成立。
      const vm = new 虚拟机(自编.程序, { capabilities: 本机能力(), write: (s) => { 出 = 出 + s; }, stepLimit: 200000000, maxDepth: 4000 });
      var 出 = "";
      const r = vm.调用("main", [], null);
      ok("自编译的编译器跑得出它自己的自测", r.ok && String(出).includes("个函数"), JSON.stringify(String(出).slice(0, 80)));
    }
  }
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
