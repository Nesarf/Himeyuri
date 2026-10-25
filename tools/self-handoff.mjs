// 门前的试推：把 self 造出的 Module 直接交给宿主的 Runtime —— 不做任何适配。
//
// 2026-10-24 之前这里有一层适配器：改名字、补 Literal 的 value 与 raw、把 then 包成 Block、
// 把空 return 变成 null、把 value 改成 expr。那些现在都在 HMYR 一侧的包装层（造模块）里做完了，
// 所以这一套今天只剩两个动作：registerModule，然后 callFunction。
//
// 它问的仍然是那句话：「宿主肯不肯把它当自己的树吃下去」。答案是肯 —— 而且是一口。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "./self-bridge.mjs";
import { Runtime } from "../src/eval.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "self/run.hmoca"));
if (!unit.ok) {
  console.log("self/run.hmyr 加载失败：" + JSON.stringify((unit.diagnostics.errors || []).slice(0, 2).map((e) => e.code)));
  process.exit(1);
}
const rt = runUnit(unit, { stepLimit: 40000000000 });
const 造模块 = (源) => rt.callFunction(rt.functions.get("造模块"), [源], null);

const 样本 = [
  ["常数", "fn main() -> Int {\n  return 42\n}\n", 42],
  ["let 与二元", "fn main() -> Int {\n  let a = 1\n  let b = 2\n  return a + b\n}\n", 3],
  ["if 分支", "fn main() -> Int {\n  let a = 3\n  if a > 2 {\n    return 10\n  }\n  return 0\n}\n", 10],
  ["while 累加", "fn main() -> Int {\n  var i = 0\n  var s = 0\n  while i < 4 {\n    s = s + i\n    i = i + 1\n  }\n  return s\n}\n", 6],
  ["十六进制", "fn main() -> Int {\n  return 0x1f + 1\n}\n", 32],
];

console.log("一、registerModule 收不收");
for (const [名, 源] of 样本) {
  const mod = 造模块(源);
  let 错误 = null;
  let 表 = null;
  try {
    const 宿主 = new Runtime({});
    宿主.registerModule(mod);
    表 = Array.from(宿主.functions.keys());
  } catch (e) {
    错误 = String(e && e.message).slice(0, 120);
  }
  ok(名 + "：登记进函数表", 错误 === null && 表 && 表.includes("main"), 错误 || JSON.stringify(表));
}

console.log("二、不做适配，callFunction 直接跑");
for (const [名, 源, 期望] of 样本) {
  let 结果 = null;
  let 错误 = null;
  try {
    const 宿主 = new Runtime({});
    宿主.registerModule(造模块(源));
    结果 = 宿主.callFunction(宿主.functions.get("main"), [], null);
  } catch (e) {
    错误 = String(e && e.message).slice(0, 160);
  }
  ok(名 + "：跑出 " + 期望, 错误 === null && 结果 === 期望, 错误 || "结果=" + JSON.stringify(结果));
}

console.log("三、整棵 import 树：两个文件，一个 Runtime");
{
  const 临 = fs.mkdtempSync(path.join(ROOT, ".tmp-tree-"));
  fs.writeFileSync(path.join(临, "lib.hmoca"), "fn double(x: Int) -> Int {\n  return x * 2\n}\n", "utf8");
  fs.writeFileSync(path.join(临, "main.hmoca"), 'import "./lib.hmoca"\nfn main() -> Int {\n  return double(21)\n}\n', "utf8");
  const 入口 = path.relative(ROOT, path.join(临, "main.hmoca")).split("\\").join("/");
  let 模块数 = 0;
  let 结果 = null;
  let 错误 = null;
  try {
    const 树 = rt.callFunction(rt.functions.get("造整棵"), [入口], null);
    if (!树.ok) {
      错误 = "加载失败：" + String(树.错);
    } else {
      const 模块们 = Array.from(树.模块们);
      模块数 = 模块们.length;
      const 宿主 = new Runtime({});
      for (const m of 模块们) 宿主.registerModule(m);
      结果 = 宿主.callFunction(宿主.functions.get("main"), [], null);
    }
  } catch (e) {
    错误 = String(e && e.message).slice(0, 140);
  }
  ok("造出两个 Module（依赖在前）", 模块数 === 2, String(模块数));
  ok("跨模块调用跑出 42", 结果 === 42, 错误 || "结果=" + JSON.stringify(结果));
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
