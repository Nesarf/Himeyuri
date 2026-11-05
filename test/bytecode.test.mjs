// 字节码那条路：编译得通，而且六条真实路径给同一个答案。
//
// 这一套钉的是「执行模型换掉了」这件事，而不是「摆脱宿主机了」——后者还没有发生，
// 见 design/VM.txt 第一节。几条执行路径给出同一个答案，才叫换掉了模型；
// 一条通一条不通，那只是加了一条岔路。
//
// 2026-11-04：第二节从两台变三台 —— 第三台是用 HMYR 自己写的 VM（self/vm.hmoca），
// 由 C 那台驮着跑。它是这一套里唯一一台「不是现成执行器」的机器，
// 所以它进来之后，这一节量的东西也跟着变：不只是「换掉了模型」，
// 而是「这门语言自己写的一台机器，与另外三台对同一份源码同答案」。
// 前三台用不到 gcc；第三台要，没有就退回两台（判据的标签会跟着写「两边」）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";
import { 最小运行 } from "../src/minimal-eval.mjs";
import { 跑字节码 } from "../src/vm.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { 写程序 } from "../src/code-file.mjs";
import { 本机能力 } from "../src/capabilities.mjs";
import { 平台参数 } from "../src/cc.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 层 = loadUnit(path.join(ROOT, "self/run.hmoca"));

console.log("一、六份 self/ 全部编译通过");
{
  ok("自举层读得进来", 层.ok, JSON.stringify(层.diagnostics.errors.map((e) => e.code)));
  let 函数数 = 0, 指令数 = 0, 槽最大 = 0;
  let 错 = "";
  try {
    for (const 文件 of 层.order) {
      for (const [, 函] of 编译模块(层.modules.get(文件)).函数族) {
        函数数++; 指令数 += 函.码.length; 槽最大 = Math.max(槽最大, 函.槽数);
      }
    }
  } catch (e) { 错 = e.message; }
  ok("编译没有抛", 错 === "", 错);
  // 这个数随自举层的规模走：每加一个函数它就长一个（见 design/LIB.txt）。
  // 2026-11-02：lex 加了四个（攒、取范围、合并们、收段，词法器改分块累积），
  // 六份合计从 210 条声明到 214，编译后是 213。同日 run 再加两个（是包名字、当路径，
  // 包名解析搬进自举层），合计 216、编译后 215。
  // 2026-11-02 晚些：lex 加了 关键字归一（汉字关键字那一条），合计 219、编译后 218。
  // 同日再晚些：run 加 导入词长、pack 加 导入起（两个文件各认两种 import 写法），合计 220、编译后 219。
  // 2026-11-02 再晚些（C 那台能跑带 引入 的程序那一轮）：body 加了 续到尾 与 续行
  // ——「行末停在一个要右操作数的记号上就不切语句」那一条，合计 222、编译后 221。
  // 同日再晚些（契约进自举层那一轮）：body 加 契约批、eval 加 契约开 / 查契约批 / 含参，
  // 合计 226、编译后 225。
  // 同日再晚些（循环不变式那一轮）：eval 加 查循环不变，合计 227、编译后 226。
  ok("两百三十三个函数", 函数数 === 233, String(函数数));
  // 槽数与指令数也随规模走。函数数从 151 长到 173，是加载器那一串（加载走、只加载、造模块、
  // 翻表达式、造整棵 …）搬进 self/run.hmoca 的结果；指令数因此跨过一万。
  // 早先长个的一次是自举层里 is_dir 的分派分支：它又多一个局部变量，槽数从 31 抬到 32。
  // 2026-10-27 区进来之后，六个新函数里局部最多的是 关区（区、下一个、i、键、块），
  // 于是单帧最大槽数到 34。同一天稍后块有了格子（存与取），指令数到 13762 ——
  // 那个上限跟着抬，因为它量的本来就是「自举层有多大」，不是「它该有多大」。
  // 2026-11-01：加载走 与 加载多 现在带着 已载、栈、源码、子 这些局部，
  // 单帧最大槽数从 34 抬到 55 —— 它量的仍然是「自举层有多大」。
  // 2026-11-02 再晚些（不变式那一轮）：出口那一段多了一条 invariant 的循环，
  // 单帧最大槽数从 58 抬到 60 —— 它量的仍然是「自举层有多大」。
  ok("单帧最大槽数", 槽最大 === 46, "slots=" + 槽最大);
  console.log("    （合计 " + 指令数 + " 条指令）");
  // 2026-11-02：词法器改分块累积之后指令数到 15052，于是上限从一万五抬到一万六 ——
  // 这一条量的本来就是「自举层有多大」，不是「它该有多大」。
  // 2026-11-02 再晚些：续行那两个函数（连同 collect 里多出来的一条判断）把指令数
  // 抬到 16127，于是上限从一万六抬到一万七 —— 这一条量的本来就是「自举层有多大」。
  ok("指令数在五千到一万七千五之间", 指令数 > 5000 && 指令数 < 17500, "insns=" + 指令数);
}

console.log("二、六条真实路径：三台执行路径给同一个答案");
{
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-vm-"));
  const 写 = (名, 文) => { const p = path.join(临, 名); fs.writeFileSync(p, 文); return p; };
  写("w.hmoca", "fn main() -> Int {\n  var i = 0\n  while i < 3 {\n    i = i + 1\n  }\n  return i\n}\n");
  写("r.hmoca", "fn main() -> Int {\n  let r = {a: 1}\n  return r.a\n}\n");
  写("bad.hmoca", "let a = \nreturn a\n");
  fs.mkdirSync(path.join(临, "mod"), { recursive: true });
  fs.writeFileSync(path.join(临, "mod/lib.hmoca"), "fn 双(n: Int) -> Int {\n  return n * 2\n}\n");
  写("mod/main.hmoca", "import \"./lib.hmoca\"\n\nfn main() -> Int {\n  return 双(21)\n}\n");

  // 第四台：用 HMYR 写的 VM 去跑同一份自举层。
  //
  // 它比前三台多绕一圈 —— 宿主（C 那台）跑 conformance/vm-boot.hmoca，那个探针
  // 装载自举层的字节码、点名调它的 命令行入口。绕这一圈正是这一台的意思：
  // 前三台都是现成的执行器，而这一台是「用这门语言自己写的一台」。
  //
  // 自举层那一份字节码这里现编，不读 runtime/run.hmoks：现编与上面那个 层 一定
  // 同源，而仓库里那一份是别人跑的产物，可能过期 —— 一个过期的基准比没有更难查。
  const 有编译器 = (() => {
    try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
  })();
  let 第四台 = null, 第四台的临 = null;
  if (有编译器) {
    第四台的临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-bc4-"));
    const exe = path.join(第四台的临, "hmyr");
    const 编 = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", ...平台参数(), "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
    const 探针层 = loadUnit(path.join(ROOT, "conformance/vm-boot.hmoca"));
    if (编.status === 0 && 探针层.ok) {
      const 编法 = (u) => 写程序(合并程序(
        u.order.map((f) => 编译模块(u.modules.get(f))),
        编译模块(u.modules.get(u.order[u.order.length - 1])),
      ));
      const 探针码路 = path.join(第四台的临, "vm-boot.hmoks");
      const 自举码路 = path.join(第四台的临, "run.hmoks");
      fs.writeFileSync(探针码路, 编法(探针层));
      fs.writeFileSync(自举码路, 编法(层));
      第四台 = (目标) => {
        const r = spawnSync(exe, [探针码路, 自举码路, 目标], {
          encoding: "utf8", timeout: 600000, cwd: ROOT,
          env: { ...process.env, HMYR_STEPS: "2000000000", HMYR_GC: "1", HMYR_MEM_LIMIT: "0" },
        });
        const 行们 = String(r.stdout || "").split("\n").filter((x) => x !== "");
        const 末 = 行们.length ? 行们[行们.length - 1] : "";
        // 探针最后一行是它自己说的退出码；再前面的行才是客人打出来的。
        const m = 末.match(/^命令行入口 跑完，值 (-?\d+)$/);
        return {
          码: m ? Number(m[1]) : -1,
          出: 行们.slice(0, -1).join("\n").trim(),
          错: String(r.stderr || "").trim(),
        };
      };
    }
  }

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
    ["hello", path.join(ROOT, "examples/hello.hmoca"), "5"],
    ["while 与赋值", path.join(临, "w.hmoca"), "3"],
    ["记录", path.join(临, "r.hmoca"), "1"],
    ["import 一件库", path.join(临, "mod/main.hmoca"), "42"],
  ];
  for (const [名, 目标, 应] of 例们) {
    const 小 = 跑(目标, false), 大 = 跑(目标, true);
    const 两台对 = 小.码 === 大.码 && 小.出 === 大.出 && 大.出 === 应;
    if (!第四台) {
      ok(名 + "：两台都是 " + 应, 两台对,
        "最小 " + 小.码 + " " + JSON.stringify(小.出) + " · 字节码 " + 大.码 + " " + JSON.stringify(大.出) + (大.错 ? "  " + 大.错 : ""));
      continue;
    }
    const 四 = 第四台(目标);
    ok(名 + "：三台都是 " + 应, 两台对 && 四.码 === 大.码 && 四.出 === 大.出,
      "最小 " + 小.码 + " " + JSON.stringify(小.出) + " · 字节码 " + 大.码 + " " + JSON.stringify(大.出) +
      " · HMYR 写的 VM " + 四.码 + " " + JSON.stringify(四.出) + (四.错 ? "  " + 四.错 : ""));
  }
  // 两条边界：缺文件与语法坏的目标。它们要的是一致，不是某个具体值。
  //
  // 这两条第四台也接得上，而它们比正向那四条更能说明问题：失败路径上的一致性
  // 是「这一层把宿主的内置失败变成了客人的值」这件事的影子。
  // 语法坏那一份三台都退 0、都打同一句话 —— 那是自举层自己的意思（它把语法错误
  // 当成一条要报告的诊断，不是一次中止），不是哪一台漏了什么。
  for (const [名, 目标] of [["目标不存在", path.join(临, "nope.hmoca")], ["语法坏的目标", path.join(临, "bad.hmoca")]]) {
    const 小 = 跑(目标, false), 大 = 跑(目标, true);
    const 四 = 第四台 ? 第四台(目标) : null;
    const 谁 = 四 ? "三台" : "两边";
    ok(名 + "：" + 谁 + "退出码相同", 小.码 === 大.码 && (!四 || 四.码 === 大.码),
      "最小 " + 小.码 + " · 字节码 " + 大.码 + (四 ? " · VM " + 四.码 : ""));
    ok(名 + "：" + 谁 + "输出相同", 小.出 === 大.出 && (!四 || 四.出 === 大.出),
      JSON.stringify(小.出) + " 对 " + JSON.stringify(大.出) + (四 ? " 对 " + JSON.stringify(四.出) : ""));
  }
  fs.rmSync(临, { recursive: true, force: true });
  if (第四台的临) fs.rmSync(第四台的临, { recursive: true, force: true });
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
  // 一个函数里除零：两条路都报 HMYR-行-012，且都不给出一个值。
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-vm-err-"));
  try {
    const p = path.join(临, "z.hmoca");
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
    ok("两边都报 HMYR-行-012", 小.includes("HMYR-行-012") && 大.includes("HMYR-行-012"), "最小 " + 小 + " · 字节码 " + 大);
  } finally {
    fs.rmSync(临, { recursive: true, force: true });
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
