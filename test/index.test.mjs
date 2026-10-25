// 索引：按键查的东西。约定在 design/INDEX.txt，这一套验它。
//
// 为什么这门语言需要它：语料生成要按码点回头查，而记录只能一次建好（键还必须像名字），
// 元组拼接是 O(n²) —— 实测八千个键就撞步数上限。索引是那件事的落点。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { Runtime } from "../src/eval.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 跑 = (body) => {
  const src = "fn main() -> Int {\n" + body + "\n  return 0\n}\n";
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });
  const 解析错 = (d.items || []).filter((x) => x.s === "error");
  if (解析错.length) return { error: "解析报错 " + 解析错.map((x) => x.c).join(",") };
  let out = "";
  const rt = new Runtime({});
  rt.write = (s) => { out += s; };
  rt.registerModule(ast);
  try { rt.callFunction(rt.functions.get("main"), [], null); return { out }; }
  catch (e) { return { error: (e.code || "") + " " + e.message }; }
};

console.log("一、造、放、取、有");
{
  const r = 跑(`
  var t = index_new()
  t = index_set(t, "0041", 65)
  t = index_set(t, "0042", 66)
  print(str(index_get(t, "0041")) + "," + str(index_get(t, "0042")))
  print("," + str(index_has(t, "0041")) + "," + str(index_has(t, "0043")))
  print("," + str(index_len(t)))`);
  ok("取回来的就是放进去的那个", r.out === "65,66,true,false,2", r.out || r.error);
}

console.log("二、键是任意字符串（这正是不用记录的理由）");
{
  const r = 跑(`
  var t = index_new()
  t = index_set(t, "U+0041", 1)
  t = index_set(t, "data/ucd/UnicodeData.txt", 2)
  t = index_set(t, "  带空格  ", 3)
  print(str(index_get(t, "U+0041")) + "," + str(index_get(t, "data/ucd/UnicodeData.txt")) + "," + str(index_get(t, "  带空格  ")))`);
  ok("码点、路径、带空格的名字都放得下", r.out === "1,2,3", r.out || r.error);
}

console.log("三、重复放同一个键是覆盖，而位置留在第一次那儿");
{
  const r = 跑(`
  var t = index_new()
  t = index_set(t, "a", 1)
  t = index_set(t, "b", 2)
  t = index_set(t, "a", 9)
  let 键 = index_keys(t)
  print(str(index_get(t, "a")) + "," + str(index_len(t)) + "," + 键[0] + "," + 键[1])`);
  ok("值被覆盖，键序不变", r.out === "9,2,a,b", r.out || r.error);
}

console.log("四、取不到与给错东西，各有一条编号");
{
  const r1 = 跑(`
  var t = index_new()
  print(str(index_get(t, "没有")))`);
  ok("index_get 取不到 → HMYR-R0218", String(r1.error || "").includes("HMYR-R0218"), r1.error || ("没有抛，输出 " + r1.out));

  const r2 = 跑(`
  var t = index_new()
  print(str(index_len("不是索引")))`);
  ok("index_len 给错东西 → HMYR-R0219", String(r2.error || "").includes("HMYR-R0219"), r2.error || ("没有抛，输出 " + r2.out));
}

console.log("五、index_has 是纯函数：给错东西也交回 false，不抛");
{
  const r = 跑(`
  print(str(index_has("不是索引", "k")))`);
  ok("给错东西交回 false", r.out === "false", r.out || r.error);
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
