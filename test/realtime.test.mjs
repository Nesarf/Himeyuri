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
const 有 = (出, 词) => 出.some((d) => d.code === "HMYR-E0320" && d.message.includes(词));

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
  ok("诊断里有 E0320", 单.diagnostics.errors.some((e) => e.code === "HMYR-E0320"),
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

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
