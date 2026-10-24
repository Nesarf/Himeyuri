// 按名字造记录、按名字取字段：这两件是「先动语言」的又一处落点。
//
// 为什么需要它们：记录字面量里的字段名在源码里是静态的，而自举的求值器要按
// 节点上的名字现场造——那时候名字是个变量，写成 .名字 写不出来。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../tools/self-bridge.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { Runtime } from "../src/eval.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 跑 = (body) => {
  const src = "fn main() -> Int {\n  " + body + "\n}\n";
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });
  const errs = d.items.filter((x) => x.s === "error");
  if (errs.length) return { error: "解析报错 " + errs.map((x) => x.c).join(",") };
  let out = "";
  const rt = new Runtime({});
  rt.write = (s) => { out += s; };
  rt.registerModule(ast);
  try { rt.callFunction(rt.functions.get("main"), [], null); return { out }; }
  catch (e) { return { error: (e.code || "") + " " + e.message }; }
};

console.log("record_new：从键值对造记录");
ok("一对", 跑('let r = record_new((("a", 1),))\n  print(str(r.a))').out === "1");
ok("两对", 跑('let r = record_new((("a", 1), ("b", 2)))\n  print(str(r.a + r.b))').out === "3");
// 空记录造得出来；而 len 只收字符串与元组，所以这里不用它来量记录——
// 改验「空记录取任何字段都被拒绝」，那才是空记录该有的行为。
{
  const r = 跑('let r = record_new(())\n  print(str(field_get(r, "a")))');
  ok("空记录造得出来，而取字段被拒绝（R0216）", r.error && r.error.includes("HMYR-R0216"), String(r.error).slice(0, 70));
}
ok("字符串值", 跑('let r = record_new((("name", "hi"),))\n  print(r.name)').out === "hi");
ok("中文名", 跑('let r = record_new((("名字", 7),))\n  print(str(r.名字))').out === "7");

console.log("record_new 的拒绝");
{
  const r = 跑('let r = record_new(("a", 1))\n  print("x")');
  ok("不是对表的元组被拒绝（R0214）", r.error && r.error.includes("HMYR-R0214"), String(r.error).slice(0, 70));
  const r2 = 跑('let r = record_new((("a b", 1),))\n  print("x")');
  ok("不是标识符的名字被拒绝（R0214）", r2.error && r2.error.includes("HMYR-R0214"), String(r2.error).slice(0, 70));
}

console.log("field_get：按名字取字段");
ok("取得到", 跑('let r = record_new((("a", 5),))\n  print(str(field_get(r, "a")))').out === "5");
ok("名字也是变量时照样能取", 跑('let r = record_new((("a", 5),))\n  let 名 = "a"\n  print(str(field_get(r, 名)))').out === "5");
{
  const r = 跑('let x = 5\n  print(str(field_get(x, "a")))');
  ok("不是记录时被拒绝（R0215）", r.error && r.error.includes("HMYR-R0215"), String(r.error).slice(0, 70));
  const r2 = 跑('let r = record_new((("a", 5),))\n  print(str(field_get(r, "没有的")))');
  ok("没有那个字段时被拒绝（R0216）", r2.error && r2.error.includes("HMYR-R0216"), String(r2.error).slice(0, 70));
}

console.log("field_names：字段名的列表");
{
  // 有了它，「把一条记录摊开」才写得出来 —— 标准库的表那一份卡在这里。
  ok("两个字段按造的顺序列出", 跑('let r = record_new((("a", 1), ("b", 2)))\n  let n = field_names(r)\n  print(n[0])\n  print(n[1])').out === "ab");
  ok("空记录交回空的元组", 跑('let r = record_new(())\n  print(str(len(field_names(r))))').out === "0");
  // 非记录给 R0217：交回空表会把「这不是记录」说成「这是一条空记录」。
  const r = 跑('let x = 5\n  print(str(field_names(x)))');
  ok("不是记录时被拒绝（R0217）", r.error && r.error.includes("HMYR-R0217"), String(r.error).slice(0, 70));
}

console.log("自举那边也能造记录了");
{
  const rt2 = runUnit(loadUnit(path.join(ROOT, "self/run.hmyr")));
  const 跑程序 = (s) => rt2.callFunction(rt2.functions.get("跑程序文字"), [s], null);
  ok("造记录并取字段", 跑程序("let r = {a: 1, b: 2}\nreturn r.a + r.b") === "3",
    JSON.stringify(跑程序("let r = {a: 1, b: 2}\nreturn r.a + r.b")));
  ok("嵌套记录", 跑程序("let r = {outer: {inner: 7}}\nreturn r.outer.inner") === "7");
  ok("记录里的字符串", 跑程序('let r = {name: "hi"}\nreturn r.name') === "hi");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
