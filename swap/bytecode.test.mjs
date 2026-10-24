// 字节码那条路：编译得通，而且六条真实路径与最小求值器给出同一个答案。
//
// 这一套钉的是「执行模型换掉了」这件事，而不是「摆脱宿主机了」——后者还没有发生，
// 见 design/VM.txt 第一节。两条执行路径给出同一个答案，才叫换掉了模型；
// 一条通一条不通，那只是加了一条岔路。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../tools/self-bridge.mjs";
import { 最小运行 } from "../src/minimal-eval.mjs";
import { 跑字节码 } from "../src/vm.mjs";
import { 编译模块 } from "../src/bytecode.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 层 = loadUnit(path.join(ROOT, "self/run.hmyr"));

console.log("一、六份 self/ 全部编译通过");
{
  ok("自举层读得进来", 层.ok, JSON.stringify(层.diagnostics.errors.map((e) => e.code)));
  let 函数数 = 0, 指令数 = 0, 槽最大 = 0;
  let 错 = "";
  try {
    for (const 文件 of 层.order) {
      for (const [, 函] of 编译模块(层.modules.get(文件)).函数们) {
        函数数++; 指令数 += 函.码.length; 槽最大 = Math.max(槽最大, 函.槽数);
      }
    }
  } catch (e) { 错 = e.message; }
  ok("编译没有抛", 错 === "", 错);
  // 这个数随自举层的规模走：每加一个函数它就长一个（见 design/LIB.txt）。
  ok("一百七十三个函数", 函数数 === 173, String(函数数));
  // 槽数与指令数也随规模走。函数数从 151 长到 173，是加载器那一串（加载走、只加载、造模块、
  // 翻表达式、造整棵 …）搬进 self/run.hmyr 的结果；指令数因此跨过一万。
  // 早先长个的一次是自举层里 is_dir 的分派分支：
  // 它又多一个局部变量，于是单帧最大槽数从 31 抬到 32。
  ok("单帧最大槽数 32", 槽最大 === 32, String(槽最大));
  console.log("    （合计 " + 指令数 + " 条指令）");
  ok("指令数在五千到一万二之间", 指令数 > 5000 && 指令数 < 12000, String(指令数));
}

console.log("二、六条真实路径：两条执行路径给同一个答案");
{
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-vm-"));
  const 写 = (名, 文) => { const p = path.join(临, 名); fs.writeFileSync(p, 文); return p; };
  写("w.hmyr", "fn main() -> Int {\n  var i = 0\n  while i < 3 {\n    i = i + 1\n  }\n  return i\n}\n");
  写("r.hmyr", "fn main() -> Int {\n  let r = {a: 1}\n  return r.a\n}\n");
  写("bad.hmyr", "let a = \nreturn a\n");
  fs.mkdirSync(path.join(临, "mod"), { recursive: true });
  fs.writeFileSync(path.join(临, "mod/lib.hmyr"), "fn 双(n: Int) -> Int {\n  return n * 2\n}\n");
  写("mod/main.hmyr", "import \"./lib.hmyr\"\n\nfn main() -> Int {\n  return 双(21)\n}\n");

  const 跑 = (目标, 用字节码) => {
    const 出 = { w: "", e: "" };
    const 选项 = {
      write: (t) => { 出.w += t; }, writeErr: (t) => { 出.e += t; },
      argv: ["hmyr", 目标], capabilities: 本机能力(),
    };
    let 码 = 0;
    try {
      const rt = 用字节码 ? 跑字节码(层, 选项) : 最小运行(层, 选项);
      if (用字节码) {
        // 虚拟机现在不抛：它交回 { ok, 值 } 或 { ok:false, 码, 话 }。
        // 失败是一条要读的返回值，于是这一行必须两种都看。
        const r = rt.调用("命令行入口", [], null);
        if (r.ok) 码 = r.值 ?? 0; else { 码 = -1; 出.e += r.码 + " " + r.话; }
      } else { rt.argv = 选项.argv; rt.writeErr = 选项.writeErr; 码 = rt.callFunction(rt.functions.get("命令行入口"), [], null) ?? 0; }
    } catch (e) { 码 = -1; 出.e += (e.code || "") + " " + e.message; }
    return { 码, 出: 出.w.trim(), 错: 出.e.trim() };
  };

  const 例们 = [
    ["hello", path.join(ROOT, "examples/hello.hmyr"), "5"],
    ["while 与赋值", path.join(临, "w.hmyr"), "3"],
    ["记录", path.join(临, "r.hmyr"), "1"],
    ["import 一件库", path.join(临, "mod/main.hmyr"), "42"],
  ];
  for (const [名, 目标, 应] of 例们) {
    const 小 = 跑(目标, false), 大 = 跑(目标, true);
    ok(名 + "：两边都是 " + 应, 小.码 === 大.码 && 小.出 === 大.出 && 大.出 === 应,
      "最小 " + 小.码 + " " + JSON.stringify(小.出) + " · 字节码 " + 大.码 + " " + JSON.stringify(大.出) + (大.错 ? "  " + 大.错 : ""));
  }
  // 两条边界：缺文件与语法坏的目标。它们要的是一致，不是某个具体值。
  for (const [名, 目标] of [["目标不存在", path.join(临, "nope.hmyr")], ["语法坏的目标", path.join(临, "bad.hmyr")]]) {
    const 小 = 跑(目标, false), 大 = 跑(目标, true);
    ok(名 + "：两边退出码相同", 小.码 === 大.码, "最小 " + 小.码 + " · 字节码 " + 大.码);
    ok(名 + "：两边输出相同", 小.出 === 大.出, JSON.stringify(小.出) + " 对 " + JSON.stringify(大.出));
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("三、聚合值不再靠宿主怎么看它们");
{
  // 元组与记录现在各是一个带标签的对象（src/vm-values.mjs）。执行器判断值是什么，
  // 问的是 v.tag，不再问 Array.isArray，也不再问 typeof v === "object"。
  // 静态检查说清它是静态的：它证明「源码里没有这两种写法」，不证明运行时一定没用到。
  // 判据要剥掉注释：注释里提到那个名字，是为了说明「不用它」，那不算用到它。
  const 剥注释 = (文) => 文.replace(/^[ \t]*\/\/.*$/gm, " ").replace(/([^:])\/\/.*$/gm, "$1");
  for (const 相对 of ["src/vm.mjs", "src/vm-builtins.mjs"]) {
    const 文 = 剥注释(fs.readFileSync(path.join(ROOT, 相对), "utf8"));
    ok(相对 + " 里没有 Array.isArray", !文.includes("Array.isArray"));
    ok(相对 + " 里没有靠 typeof 判对象", !/typeof\s+\w+\s*===\s*"object"/.test(文));
  }
  const 值 = fs.readFileSync(path.join(ROOT, "src/vm-values.mjs"), "utf8");
  ok("两个值类各带一个标签", 值.includes('this.tag = "tuple"') && 值.includes('this.tag = "record"'));
  ok("执行器与内置表共用同一份值定义", fs.readFileSync(path.join(ROOT, "src/vm-builtins.mjs"), "utf8").includes('from "./vm-values.mjs"'));

  // 错误不再靠 JS 的 throw：VM 自己记停机，解释循环每步看一眼。
  // 唯一留下的那一处 throw 是「没给能力」，那是编程错误，不是语言里的失败。
  const 内置源 = 剥注释(fs.readFileSync(path.join(ROOT, "src/vm-builtins.mjs"), "utf8"));
  ok("内置表里没有 throw", !内置源.includes("throw"));
  const 执行源 = 剥注释(fs.readFileSync(path.join(ROOT, "src/vm.mjs"), "utf8"));
  const 几处 = (执行源.match(/\bthrow\b/g) || []).length;
  ok("执行器里只剩一处 throw（没给能力那一条）", 几处 === 1, String(几处));
  ok("而它记的是停机，不是异常", 执行源.includes("this.停机"));
}

console.log("四、错误编号也照旧");
{
  // 一个函数里除零：两条路都报 R0120，且都不给出一个值。
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-vm-err-"));
  try {
    const p = path.join(临, "z.hmyr");
    fs.writeFileSync(p, "fn main() -> Int {\n  return 1 / 0\n}\n");
    const 跑 = (用字节码) => {
      let 错 = "";
      try {
        const rt = 用字节码 ? 跑字节码(层, { capabilities: 本机能力(), write: () => {}, argv: ["hmyr", p] }) : 最小运行(层, { capabilities: 本机能力(), write: () => {}, argv: ["hmyr", p] });
        if (用字节码) { const r = rt.调用("命令行入口", [], null); if (!r.ok) 错 = r.码 + " " + r.话; }
        else { rt.argv = ["hmyr", p]; rt.callFunction(rt.functions.get("命令行入口"), [], null); }
      } catch (e) { 错 = (e.code || "") + " " + e.message; }
      return 错;
    };
    const 小 = 跑(false), 大 = 跑(true);
    ok("两边都报 R0120", 小.includes("HMYR-R0120") && 大.includes("HMYR-R0120"), "最小 " + 小 + " · 字节码 " + 大);
  } finally {
    fs.rmSync(临, { recursive: true, force: true });
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
