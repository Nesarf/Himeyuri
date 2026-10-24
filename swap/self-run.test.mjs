// 自举串起来的验收：一段源码，从头到尾没经过别人的语言。
//
//   源码 → lex.scan → chain.chain → eval.求值 → 值
//
// 这四件都是 Himeyuri 自己写的，所以这一套验的其实是「这门语言能不能跑自己」。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../tools/self-bridge.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "self/run.hmyr"));
ok("那件串起来的程序加载得动（import 三件都成立）", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const 跑 = (s) => rt.callFunction(rt.functions.get("跑"), [s], null);

console.log("表达式：词法、语法、求值三层一起工作");
ok("1 + 2 * 3 等于七", 跑("1 + 2 * 3") === "7", JSON.stringify(跑("1 + 2 * 3")));
ok("(1 + 2) * 3 等于九（括号改变了树）", 跑("(1 + 2) * 3") === "9", JSON.stringify(跑("(1 + 2) * 3")));
ok("多余空白不影响", 跑("  1   +   2 * 3  ") === "7", JSON.stringify(跑("  1   +   2 * 3  ")));
ok("取余", 跑("10 % 4") === "2");
ok("除法", 跑("7 / 2") === "3.5", JSON.stringify(跑("7 / 2")));
ok("一元负号单独用", 跑("-5") === "-5", JSON.stringify(跑("-5")));
// 那一格补上了：一元负号的结果会回到加减的尾部继续走，于是 -5 + 3 是 (-5) + 3。
ok("一元负号与加法一起用", 跑("-5 + 3") === "-2", JSON.stringify(跑("-5 + 3")));
ok("两个负号叠起来", 跑("--5") === "5", JSON.stringify(跑("--5")));
ok("而二元减法照旧", 跑("1 - 5") === "-4", JSON.stringify(跑("1 - 5")));
ok("比较", 跑("1 < 2") === "true");

console.log("字符串与调用");
ok("字符串字面量", 跑('"abc"') === "abc", JSON.stringify(跑('"abc"')));
ok("len 认得", 跑('len("abcd")') === "4", JSON.stringify(跑('len("abcd")')));
ok("str 认得", 跑('str(9)') === "9", JSON.stringify(跑("str(9)")));
ok("字符串相加", 跑('"a" + "b"') === "ab", JSON.stringify(跑('"a" + "b"')));

console.log("错处如实说，不静音也不猜");
{
  const r = 跑("x + 1");
  ok("未知名字报出来", r.includes("没有这个名字") && r.includes("x"), JSON.stringify(r));
  const r2 = 跑("1 +");
  ok("语法错报出来（语法层报的错）", r2.includes("语法层报的错"), JSON.stringify(r2));
  const r3 = 跑('nope("a")');
  // 错误文字随那次「调用认得函数表」一起变了：现在是「没有这个函数」。
  ok("没有的函数据实说", r3.indexOf("没有这个函数") >= 0, JSON.stringify(r3));
}

console.log("整段程序：语句层也串进来了");
{
  const 跑程序 = (s) => rt.callFunction(rt.functions.get("跑程序文字"), [s], null);
  ok("两个变量相加", 跑程序("let a = 2\nlet b = 3\nreturn a + b") === "5", JSON.stringify(跑程序("let a = 2\nlet b = 3\nreturn a + b")));
  ok("后定义覆盖先定义", 跑程序("let x = 1\nlet x = 2\nreturn x") === "2");
  ok("条件真时走 then", 跑程序("let n = 7\nif n > 3 { return 1 }\nreturn 0") === "1");
  ok("条件假时走后面的语句", 跑程序("let n = 1\nif n > 3 { return 1 }\nreturn 0") === "0");
  ok("表达式语句也能跑", 跑程序("1 + 2\nreturn 9") === "9", JSON.stringify(跑程序("1 + 2\nreturn 9")));
  const 坏 = 跑程序("let a = \nreturn a");
  ok("语法坏的整段程序报错，不静音", 坏.startsWith("错："), JSON.stringify(坏).slice(0, 80));
  const 缺名 = 跑程序("return nope");
  ok("未知名字报出来", 缺名.includes("没有这个名字"), JSON.stringify(缺名).slice(0, 60));
}

console.log("两种输入：裸语句与带声明");
{
  const 跑程序 = (s) => rt.callFunction(rt.functions.get("跑程序文字"), [s], null);
  ok("带声明的程序也跑得动", 跑程序("fn main() -> Int {\n  let a = 2\n  return a + 1\n}\n") === "3",
    JSON.stringify(跑程序("fn main() -> Int {\n  let a = 2\n  return a + 1\n}\n")));
  ok("声明里的分支照样走", 跑程序("fn main() -> Int {\n  let n = 7\n  if n > 3 { return 1 }\n  return 0\n}\n") === "1");
  ok("中文标识符也行", 跑程序("fn main() -> Int {\n  let 数 = 4\n  return 数 * 2\n}\n") === "8",
    JSON.stringify(跑程序("fn main() -> Int {\n  let 数 = 4\n  return 数 * 2\n}\n")));
  ok("裸语句那条路仍然可用", 跑程序("let a = 1\nreturn a + 1") === "2");
}

console.log("多声明：一个文件里几个函数");
{
  const 跑程序 = (s) => rt.callFunction(rt.functions.get("跑程序文字"), [s], null);
  ok("两个函数时挑 main 来跑", 跑程序("fn helper() -> Int {\n  return 9\n}\nfn main() -> Int {\n  let a = 2\n  return a + 3\n}\n") === "5",
    JSON.stringify(跑程序("fn helper() -> Int {\n  return 9\n}\nfn main() -> Int {\n  let a = 2\n  return a + 3\n}\n")));
  ok("main 写在前面也认得", 跑程序("fn main() -> Int {\n  return 7\n}\nfn other() -> Int {\n  return 9\n}\n") === "7");
  ok("三个函数时仍然挑 main", 跑程序("fn a() -> Int {\n  return 1\n}\nfn main() -> Int {\n  return 2\n}\nfn c() -> Int {\n  return 3\n}\n") === "2");
  // 曾经是边界：函数之间不能互相调用；现在能了
  ok("调用自定函数", 跑程序("fn helper() -> Int {\n  return 9\n}\nfn main() -> Int {\n  return helper()\n}\n") === "9",
    JSON.stringify(跑程序("fn helper() -> Int {\n  return 9\n}\nfn main() -> Int {\n  return helper()\n}\n")));
  ok("函数写在调用之后也行（前向引用）", 跑程序("fn main() -> Int {\n  return helper() * 2\n}\nfn helper() -> Int {\n  return 5\n}\n") === "10");
  ok("嵌套调用", 跑程序("fn one() -> Int {\n  return 1\n}\nfn two() -> Int {\n  return one() + one()\n}\nfn main() -> Int {\n  return two() + one()\n}\n") === "3");
  const 坏 = 跑程序("fn main() -> Int {\n  return nope()\n}\n");
  const 坏文字 = String(坏);
  ok("不存在的函数被报出来（提到名字）", 坏文字.indexOf("nope") >= 0, JSON.stringify(坏文字.slice(0, 60)));
  ok("而且说清是「没有这个函数」", 坏文字.indexOf("函数") >= 0, JSON.stringify(坏文字.slice(0, 60)));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
