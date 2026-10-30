// 卫生宏的验收：声明、展开、参数替换，以及「展开之后两台机器看到同一棵树」。
//
// 语法是一行一条：macro 名(参数们) = 表达式
// 展开在 src/expand.mjs 里，两处接线：src/eval.mjs 的 run 与 src/loader.mjs 的 loadUnit。
//
// 这一份只验「窄的那一条卫生」：模板不引入绑定，所以实参树原样嵌入、不被改名，
// 也不存在「模板内的绑定捕获实参」。带绑定的模板要块表达式，而字节码那台不认块表达式 ——
// 那条边界写在 src/expand.mjs 的文件头，也写在 design/ 的账里。
import fs from "node:fs";
import path from "node:path";
import { run } from "../src/eval.mjs";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/hmyr-macro-");
let 序 = 0;

const 走求值器 = (源) => {
  const r = run(源);
  if (r.diagnostics.errors.length) return { 错: r.diagnostics.errors[0].code + " " + r.diagnostics.errors[0].message };
  return { 值: r.value };
};

const 走加载器 = (源) => {
  const p = path.join(临, "m" + (序++) + ".hmoca");
  fs.writeFileSync(p, 源, "utf8");
  const 层 = loadUnit(p);
  if (!层.ok) {
    const e = 层.diagnostics.errors[0] || {};
    return { 错: String(e.code) + " " + String(e.message) };
  }
  try {
    const rt = runUnit(层, { capabilities: 本机能力(), stepLimit: 10000000 });
    return { 值: rt.callFunction(rt.functions.get("main"), [], null) };
  } catch (e) {
    return { 错: String(e && e.code ? e.code + " " + e.message : e) };
  }
};

const 一条 = (标, 源, 期望) => {
  const a = 走求值器(源);
  ok("求值器：" + 标, a.值 === 期望, JSON.stringify(a));
  const b = 走加载器(源);
  ok("加载器：" + 标, b.值 === 期望, JSON.stringify(b));
};

console.log("一、展开：参数替换");
一条("两次(3) 变成 3 + 3", [
  "macro 两次(x) = x + x",
  "",
  "fn main() -> Int {",
  "  return 两次(3)",
  "}",
].join("\n"), 6);

一条("模板里带一次真调用", [
  "macro 十倍(x) = x * 10",
  "fn 加(a: Int, b: Int) -> Int {",
  "  return a + b",
  "}",
  "fn main() -> Int {",
  "  return 十倍(加(1, 2))",
  "}",
].join("\n"), 30);

console.log("二、嵌套：模板里再用别的宏");
一条("加一(两次(2)) 是 5", [
  "macro 加一(x) = x + 1",
  "macro 两次(x) = x + x",
  "",
  "fn main() -> Int {",
  "  return 加一(两次(2))",
  "}",
].join("\n"), 5);

console.log("三、卫生的窄那一条：实参原样嵌入，不被改名");
一条("取(a) 里的 a 指的是调用处的 a", [
  "macro 取(x) = x",
  "",
  "fn main() -> Int {",
  "  let a = 7",
  "  return 取(a)",
  "}",
].join("\n"), 7);

一条("同一个宏用两次，互不影响", [
  "macro 两次(x) = x + x",
  "",
  "fn main() -> Int {",
  "  let a = 两次(1)",
  "  let b = 两次(2)",
  "  return a * 10 + b",
  "}",
].join("\n"), 24);

console.log("四、错要说清：参数个数不对");
{
  const 源 = [
    "macro 两次(x) = x + x",
    "",
    "fn main() -> Int {",
    "  return 两次()",
    "}",
  ].join("\n");
  const a = 走求值器(源);
  ok("求值器报 E0103", String(a.错 || "").includes("HMYR-形-006"), a.错 || "（没有报）");
  ok("而且说了它要几个参数", String(a.错 || "").includes("1"), a.错 || "");
}

console.log("五、没有宏的模块原样通过");
{
  const 源 = "fn main() -> Int {\n  return 1 + 2\n}\n";
  const a = 走求值器(源);
  ok("求值器照跑", a.值 === 3, JSON.stringify(a));
  const b = 走加载器(源);
  ok("加载器照跑", b.值 === 3, JSON.stringify(b));
}

fs.rmSync(临, { recursive: true, force: true });

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
