// 返回类型的静态核对：声明说了什么，交回的东西就得是什么。
//
// 为什么这是一套单独的：design/LIB.txt 把「类型的检查本身」记成最大的那个缺口 ——
// 写 Int 而交回字符串，没有任何一层会说话。这一套让「说话」这件事有据可查：
// 每一种不合都给一个具体的例子，每一种「查不了」都明说放过。
//
// 边界（与 src/bytecode.mjs 顶上那段注释一致）：
//   查得了  字面量、元组字面量、记录字面量、调用（查被调者的声明）、算术与比较的结果
//   查不了  变量、下标、字段 —— 一律放过。静态检查的价值在于「说了就一定对」，
//           而不是「猜得多」；把猜出来的东西当错误报出去，比不查更坏。
import { loadUnit } from "../tools/self-bridge.mjs";
import { 核对返回类型 } from "../src/bytecode.mjs";

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 只看一份源码：读进来，看核对器说什么。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-types-"));
const 查 = (源码) => {
  const 路 = path.join(临, "t.hmyr");
  fs.writeFileSync(路, 源码, "utf8");
  const unit = loadUnit(路);
  if (!unit.ok) return { 加载错: unit.diagnostics.errors.map((e) => e.code) };
  const 声明们 = [];
  for (const 文件 of unit.order) for (const d of unit.modules.get(文件).decls || []) 声明们.push(d);
  return { 问题们: 核对返回类型(声明们) };
};

console.log("一、对的东西不报");
{
  const 例们 = [
    ["数交点回数", "fn f() -> Int {\n  return 1\n}\n"],
    ["串交点回串", 'fn f() -> String {\n  return "a"\n}\n'],
    ["布尔交点回布尔", "fn f() -> Bool {\n  return 1 == 1\n}\n"],
    ["算术结果是数", "fn f() -> Int {\n  return 1 + 2 * 3\n}\n"],
    ["串拼接是串", 'fn f() -> String {\n  return "a" + "b"\n}\n'],
    ["元组形状对", 'fn f() -> (Int, String) {\n  return (1, "a")\n}\n'],
    ["嵌套元组", "fn f() -> (Int, (Int, Int)) {\n  return (1, (2, 3))\n}\n"],
    ["变量放过（推不出来）", "fn f() -> Int {\n  let x = 1\n  return x\n}\n"],
    ["没写返回类型就不查", "fn f() {\n  return \"随便\"\n}\n"],
  ];
  for (const [标, 源码] of 例们) {
    const r = 查(源码);
    ok(标, !r.加载错 && r.问题们.length === 0, JSON.stringify(r.加载错 || r.问题们));
  }
}

console.log("二、不对的要说出来，而且说清楚");
{
  const 例们 = [
    ["声明 String 交回数", "fn f() -> String {\n  return 1\n}\n", "String"],
    ["声明 Int 交回串", 'fn f() -> Int {\n  return "a"\n}\n', "Int"],
    ["声明 Bool 交回数", "fn f() -> Bool {\n  return 1\n}\n", "Bool"],
    ["元组元素形状不对", 'fn f() -> (Int, String) {\n  return (1, 2)\n}\n', "第 2 个元素"],
    ["元组长度不对", 'fn f() -> (Int, String) {\n  return (1, "a", 2)\n}\n', "3 个"],
    ["声明数交回元组", "fn f() -> Int {\n  return (1, 2)\n}\n", "Int"],
  ];
  for (const [标, 源码, 该提到] of 例们) {
    const r = 查(源码);
    const 话 = (r.问题们 || []).map((p) => p.话).join(" / ");
    ok(标, (r.问题们 || []).length > 0 && 话.includes(该提到), JSON.stringify(话 || r.加载错));
  }
}

console.log("三、调用的返回类型也照着核");
{
  const 源码 = [
    "fn 甲() -> String {",
    '  return "a"',
    "}",
    "fn 乙() -> Int {",
    "  return 甲()",
    "}",
    "",
  ].join("\n");
  const r = 查(源码);
  ok("乙 声明 Int 而 甲 交回 String，要报出来", (r.问题们 || []).length === 1, JSON.stringify(r.问题们));
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
