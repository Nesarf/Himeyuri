// 实时档位的第一层：design/MEMORY.txt 第 3 节的四条约束。
//
// 一个函数用 effects(realtime) 声明自己跑在实时档位上。这一套验四件事：
//
//   一、四条反例各自被拒：托管分配、碰阻塞的世界、无界循环、调用链没闭合
//   二、一个正例一条都不报 —— 检查器的价值在于不误报
//   三、装载器真的拦（不是「工具能跑」，是这条路走不过去）
//   四、开关存在且有效
//
// 不验的：运行时的零停顿。这一层只管「写得对不对」，不管「跑起来快不快」。
// 那要等区在实时回调里真的能跑，而 §8 那次实测已经说明性能这件事今天谈不了。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { 切 } from "../src/subset-lex.mjs";
import { 子集解 } from "../src/subset-parse.mjs";
import { 实时检查 } from "../src/realtime-check.mjs";
import { loadUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-realtime-"));
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 查 = (源码) => 实时检查(子集解(切(源码)).ast);
const 行们 = (v) => v.join("\n") + "\n";
const 投 = (内容, 名) => { const p = path.join(临, 名); fs.writeFileSync(p, 内容, "utf8"); return p; };
const 有 = (出, 词) => 出.some((d) => d.code === "HMYR-載-020" && d.message.includes(词));

console.log("一、四条反例各自被拒");
{
  const 分配 = 行们([
    "fn 回调() -> Int effects(realtime) {",
    "  let a = arena()",
    "  return 0",
    "}",
  ]);
  ok("托管分配被拒", 有(查(分配), "arena()"), JSON.stringify(查(分配)));

  const 读文件 = 行们([
    "fn 回调() -> Int effects(realtime) {",
    "  let s = read_text(\"a.txt\")",
    "  return 0",
    "}",
  ]);
  ok("读文件被拒", 有(查(读文件), "file"), JSON.stringify(查(读文件)));

  const 无界 = 行们([
    "fn 回调() -> Int effects(realtime) {",
    "  var i = 0",
    "  while true {",
    "    i = i + 1",
    "  }",
    "  return i",
    "}",
  ]);
  ok("常量真值的循环被拒", 有(查(无界), "constant true"), JSON.stringify(查(无界)));

  const 没闭合 = 行们([
    "fn 普通() -> Int {",
    "  return 1",
    "}",
    "",
    "fn 回调() -> Int effects(realtime) {",
    "  return 普通()",
    "}",
  ]);
  ok("调用没声明 realtime 的函数被拒", 有(查(没闭合), "does not declare"), JSON.stringify(查(没闭合)));
}

console.log("二、正例一条都不报");
{
  const 正例 = 行们([
    "fn 内部(n: Int) -> Int effects(realtime) {",
    "  var s = 0",
    "  var i = 0",
    "  while i < n {",
    "    s = s + i",
    "    i = i + 1",
    "  }",
    "  return s",
    "}",
    "",
    "fn 回调(n: Int) -> Int effects(realtime) {",
    "  return 内部(n)",
    "}",
  ]);
  ok("实时函数之间可以互调", 查(正例).length === 0, JSON.stringify(查(正例)));

  // 没有 realtime 声明的函数不受这四条约束 —— 门只对实时开。
  const 平常 = 行们([
    "fn 普通() -> Int effects(process) {",
    "  let a = arena()",
    "  var i = 0",
    "  while true {",
    "    i = i + 1",
    "  }",
    "  return 0",
    "}",
  ]);
  ok("没声明 realtime 的函数不报", 查(平常).length === 0, JSON.stringify(查(平常)));
}

console.log("三、装载器真的拦");
{
  const 坏 = 投(行们([
    "fn 回调() -> Int effects(realtime) {",
    "  let a = arena()",
    "  return 0",
    "}",
  ]), "坏.hmoca");
  const 单 = loadUnit(坏);
  ok("装载结果是失败", 单.ok === false, JSON.stringify({ ok: 单.ok }));
  ok("诊断里有 HMYR-載-020", 单.diagnostics.errors.some((e) => e.code === "HMYR-載-020"),
    JSON.stringify(单.diagnostics.errors.map((e) => e.code)));

  const 好 = 投(行们([
    "fn 回调(n: Int) -> Int effects(realtime) {",
    "  return n + 1",
    "}",
    "",
    "fn main() -> Int effects(process) {",
    "  print(str(回调(1)) + chr(10))",
    "  return 0",
    "}",
  ]), "好.hmoca");
  const 单好 = loadUnit(好);
  ok("正例装得进来", 单好.ok === true, JSON.stringify(单好.diagnostics.errors.map((e) => e.code)));
}

console.log("四、开关存在且有效");
{
  const 坏 = path.join(临, "坏.hmoca");
  const 关 = loadUnit(坏, { realtimeCheck: false });
  ok("关掉之后装得进来", 关.ok === true, JSON.stringify(关.diagnostics.errors.map((e) => e.code)));
}

console.log("五、整仓现有 .hmoca 零误报");
{
  const 收 = (根, 出 = [], 深 = 0) => {
    if (深 > 3) return 出;
    for (const e of fs.readdirSync(根, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist" || e.name === "build") continue;
      const p = path.join(根, e.name);
      if (e.isDirectory()) 收(p, 出, 深 + 1);
      else if (e.name.endsWith(".hmoca")) 出.push(p);
    }
    return 出;
  };
  const 份们 = 收(ROOT).sort();
  let 总数 = 0, 读不动 = 0;
  for (const p of 份们) {
    let 出 = [];
    try { 出 = 查(fs.readFileSync(p, "utf8")); } catch { 读不动++; continue; }
    总数 += 出.length;
  }
  ok(份们.length + " 份 .hmoca 零诊断", 总数 === 0, String(总数));
  ok("没有一份是读不动而跳过的", 读不动 === 0, String(读不动));
}

console.log("六、真语法：fn f() realtime");
{
  // 档位原来借 effects(realtime) 写在权限位上。现在它有自己的位置 ——
  // 而旧写法仍然认，因为仓库里还有按那个写的文档与程序。
  const 反例 = 行们([
    "fn 回调() -> Int realtime {",
    "  let a = arena()",
    "  return 0",
    "}",
  ]);
  ok("真语法也认得（托管分配被拒）", 有(查(反例), "arena()"), JSON.stringify(查(反例)));

  const 正例 = 行们([
    "fn 回调(n: Int) -> Int realtime {",
    "  return n + 1",
    "}",
    "",
    "fn main(n: Int) -> Int {",
    "  return 回调(n)",
    "}",
  ]);
  ok("真语法的正例不报", 查(正例).length === 0, JSON.stringify(查(正例)));

  const 旧写法 = 行们([
    "fn 回调() -> Int effects(realtime) {",
    "  let a = arena()",
    "  return 0",
    "}",
  ]);
  ok("旧的 effects(realtime) 也认", 有(查(旧写法), "arena()"), JSON.stringify(查(旧写法)));
}

console.log("七、C 那台：分配真的少了（堆账是判据）");
{
  // 上面六节都在验「写得对不对」。这一节验「跑起来少了多少」——
  // 而它能验的方式只有一个：C 那台的堆账（HMYR_MEM 在退出时打到 stderr）。
  //
  // 判据是「低于二十万字节」。实测值约十二万，而**从堆上取槽之前是一百一十三万**。
  // 这个数不是精确的承诺，是一条回归防线：谁把槽数组搬回堆上，它立刻会红。
  const 有gcc = (() => {
    try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
  })();
  if (!有gcc) {
    console.log("  跳过  这台机器上没有 gcc —— 堆账那一侧不验");
  } else {
    const exe = path.join(临, "hmyr-rt.exe");
    const 编 = spawnSync("gcc", ["-std=c11", "-O2", "-w", "-Wl,--stack,67108864", "-o", exe,
      path.join(ROOT, "vm", "hmyr.c"), "-lm"], { encoding: "utf8" });
    ok("C 那台编得出来", 编.status === 0, String(编.stderr || "").slice(0, 160));

    const 码 = path.join(临, "callback.hmoks");
    const 源 = path.join(ROOT, "bench", "realtime-callback.hmoca");
    const 编程序 = spawnSync(process.execPath, [path.join(ROOT, "tools", "emit-code.mjs"), 源, 码],
      { encoding: "utf8" });
    ok("回调编得出来", 编程序.status === 0, String(编程序.stderr || "").slice(0, 160));

    if (编.status === 0 && 编程序.status === 0) {
      const r = spawnSync(exe, [码], {
        encoding: "utf8", timeout: 600000,
        // GC_BYTES 必须给，而且必须小于这份程序的堆（2026-11-02 量出来的）。
        // 默认阈值是三十二兆，而 bench/realtime-callback.hmoca 的堆不到一兆 ——
        // 于是回收一次都不会触发，那条判据量到的是「累计分配五十三万」，
        // 与它注释里说的「约十二万」差了四倍多。给了阈值之后 live 回到十三万。
        env: { ...process.env, HMYR_STEPS: "4000000000", HMYR_GC: "1", HMYR_GC_BYTES: "200000", HMYR_MEM: "1", HMYR_MEM_LIMIT: "0" },
      });
      const 账 = /(\d+)\s*(?:字节|bytes)/.exec(String(r.stderr || ""));
      const 字节 = 账 ? Number(账[1]) : -1;
      ok("跑得动", r.status === 0, JSON.stringify({ status: r.status, err: String(r.stderr || "").slice(0, 140) }));
      ok("堆账低于二十万字节", 字节 > 0 && 字节 < 200000, String(字节));
    }
  }
}

console.log("八、禁 panic：除法与取模的分母");
{
  // 分母是零的时候机器会停下来，而实时回调里没有地方可以展开栈。
  // 这一层只认一种证据：字面量且为正。变量、字段、表达式都不算 —— 宁可拒。
  const 除变量 = 行们([
    "fn 回调(n: Int) -> Int realtime {",
    "  return 10 / n",
    "}",
  ]);
  ok("除以变量被拒", 有(查(除变量), "cannot prove positive"), JSON.stringify(查(除变量)));

  const 取模变量 = 行们([
    "fn 回调(n: Int) -> Int realtime {",
    "  return 10 % n",
    "}",
  ]);
  ok("对变量取模被拒", 有(查(取模变量), "cannot prove positive"), JSON.stringify(查(取模变量)));

  const 除零 = 行们([
    "fn 回调() -> Int realtime {",
    "  return 10 / 0",
    "}",
  ]);
  ok("除以字面量零也被拒", 有(查(除零), "cannot prove positive"), JSON.stringify(查(除零)));

  // 正例：字面量正数分母，这一层证得了。
  const 除正数 = 行们([
    "fn 回调(n: Int) -> Int realtime {",
    "  return n / 2",
    "}",
  ]);
  ok("除以字面量正数不报", 查(除正数).length === 0, JSON.stringify(查(除正数)));

  // 而没声明 realtime 的普通函数不受这一条约束 —— 门只对实时开。
  const 普通函数 = 行们([
    "fn 普通(n: Int) -> Int {",
    "  return 10 / n",
    "}",
  ]);
  ok("普通函数的除法不报", 查(普通函数).length === 0, JSON.stringify(查(普通函数)));
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
