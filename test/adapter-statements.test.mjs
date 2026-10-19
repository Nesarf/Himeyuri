// 适配层语句那一半的验收：两边跑完同一段程序，最后得同一个数。
//
// 表达式的验收是「同一个表达式同一个数」，而语句的不同——它们碰环境。
// let 把名字绑进去、assign 改它、if 挑一个块跑、return 中断。
// 于是唯一诚实的标准是：同一份源码，两边跑完，交回同一个值。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { statements } from "../src/adapter.mjs";
import { run } from "../src/eval.mjs";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 自举层 = loadUnit(path.join(ROOT, "self/eval.hmyr"));
const 自举 = runUnit(自举层);
const 宿主的 = (源) => run(源, {}).value;
const 那边的 = (源) => {
  const r = statements(源);
  if (r.错) return { err: r.错 };
  const 回 = 自举.callFunction(自举.functions.get("跑程序"), [r.语句们], null);
  if (回 && 回.ok === false) return { err: 回.text || "报错" };
  return { value: 回 && Object.prototype.hasOwnProperty.call(回, "value") ? 回.value : 回 };
};
const 程序 = (体) => "fn main() -> Int {\n" + 体.split("\n").map((l) => "  " + l).join("\n") + "\n}\n";

console.log("一、let 与 return");
{
  const 源 = 程序("let x = 1\nreturn x");
  ok("let 绑一个名字，return 交回它", 宿主的(源) === 1 && 那边的(源).value === 1, "宿主 " + 宿主的(源) + " · 自举 " + JSON.stringify(那边的(源)));
}

console.log("二、var 与 assign");
{
  const 源 = 程序("var y = 2\ny = y + 3\nreturn y");
  ok("var 可改，assign 改了，两边都是 5", 宿主的(源) === 5 && 那边的(源).value === 5, "宿主 " + 宿主的(源) + " · 自举 " + JSON.stringify(那边的(源)));
}

console.log("三、if 挑一个块");
{
  const 真 = 程序("var y = 2\nif y < 10 {\n  y = y + 10\n}\nreturn y");
  ok("条件真时走 then", 宿主的(真) === 12 && 那边的(真).value === 12, "宿主 " + 宿主的(真) + " · 自举 " + JSON.stringify(那边的(真)));
  const 假 = 程序("var y = 20\nif y < 10 {\n  y = y + 10\n}\nreturn y");
  ok("条件假时跳过 then", 宿主的(假) === 20 && 那边的(假).value === 20, "宿主 " + 宿主的(假) + " · 自举 " + JSON.stringify(那边的(假)));
  const 否则 = 程序("var y = 20\nif y < 10 {\n  y = 1\n} else {\n  y = 2\n}\nreturn y");
  ok("带 else 时走 otherwise", 宿主的(否则) === 2 && 那边的(否则).value === 2, "宿主 " + 宿主的(否则) + " · 自举 " + JSON.stringify(那边的(否则)));
}

console.log("四、一整段：几种语句串起来");
{
  const 源 = 程序([
    "let x = 1",
    "var y = 2",
    "y = x + 3",
    "if y > 3 {",
    "  y = y + 10",
    "}",
    "return y",
  ].join("\n"));
  const 甲 = 宿主的(源);
  const 乙 = 那边的(源);
  ok("两边都是 14", 甲 === 14 && 乙.value === 14, "宿主 " + 甲 + " · 自举 " + JSON.stringify(乙));
}

console.log("五、return 中途停下来");
{
  const 源 = 程序("var y = 1\nreturn y\ny = 99");
  // 第二个 y = 99 在 return 之后，于是不该被执行——
  // 若它被执行了，两边的答案会不同（而那样两边都不会是 1）。
  ok("return 之后的语句不执行", 宿主的(源) === 1 && 那边的(源).value === 1, "宿主 " + 宿主的(源) + " · 自举 " + JSON.stringify(那边的(源)));
}

console.log("六、函数声明不在这一层，而它说得出这句话");
{
  const 源 = "fn f() -> Int {\n  return 1\n}\nfn main() -> Int {\n  return f()\n}\n";
  const r = statements(源);
  // main 里只有一个 return f()，而 f() 是个调用——转得出形状
  ok("转得出形状", r.语句们 && r.语句们.length === 1, JSON.stringify(r).slice(0, 100));
  // 而函数表不在这一层：自举那边拿不到 f，于是会报错而不是算错
  const 乙 = 那边的(源);
  ok("自举那边找不到 f（而那是另一件事）", 乙.err !== undefined, JSON.stringify(乙).slice(0, 100));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
