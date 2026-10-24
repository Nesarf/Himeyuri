// 自举求值器的验收：十二种节点，逐条过。
//
// 这一件是自举的最后一格——词法、语法、语句都在 self/ 里了，缺的就是它。
// 立起来之后，一段源码可以由 Himeyuri 自己读、自己解析、自己求值。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const rt = runUnit(loadUnit(path.join(ROOT, "self/eval.hmyr")));
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};
const 一 = (label, 节点, 环境, 期望) => {
  const r = call("求值成文字", [节点, 环境]);
  ok(label, r === 期望, JSON.stringify(r) + " 期望 " + JSON.stringify(期望));
};
const int = (t) => ({ kind: "int", text: t });
const str = (t) => ({ kind: "Literal", type: "string", text: t });
const name = (t) => ({ kind: "Ident", text: t });
const bin = (op, l, r) => ({ kind: "Binary", op, left: l, right: r });
const 空 = [];

console.log("字面量与名字");
一("整数", int("42"), 空, "42");
一("num 也是整数", { kind: "Literal", type: "int", text: "7" }, 空, "7");
一("字符串", str("hi"), 空, "hi");
一("名字查环境", name("x"), [["x", 5]], "5");
一("环境里的字符串", name("s"), [["s", "abc"]], "abc");

console.log("二元与一元：括号的优先级由 AST 决定，不由求值器猜");
一("1 + 2 * 3（树是 1+(2*3)）", bin("+", int("1"), bin("*", int("2"), int("3"))), 空, "7");
一("(1 + 2) * 3", bin("*", bin("+", int("1"), int("2")), int("3")), 空, "9");
一("除法", bin("/", int("7"), int("2")), 空, "3.5");
一("取余", bin("%", int("7"), int("2")), 空, "1");
一("比较", bin("<", int("1"), int("2")), 空, "true");
一("相等", bin("==", str("a"), str("a")), 空, "true");
一("一元负号", { kind: "Unary", op: "-", operand: int("5") }, 空, "-5");
一("字符串相加", bin("+", str("a"), str("b")), 空, "ab");

console.log("调用：这一版认的内置");
一("len", { kind: "Call", callee: name("len"), args: [str("abc")] }, 空, "3");
一("str", { kind: "Call", callee: name("str"), args: [int("9")] }, 空, "9");
// 早先这一条写的是「print 不在求值器里（打印是调用方的事）」。
// 那句约定本身是错的：目标程序就是调用方，它跑在求值器内部，于是它连一句话都说不出。
// 现在 print 会转发到宿主那一层，交回空元组（写出去的那一下没有值）。
一("print 转发给宿主（交回空元组）", { kind: "Call", callee: name("print"), args: [str("x")] }, 空, "[]");
一("参数先求值", { kind: "Call", callee: name("len"), args: [bin("+", str("ab"), str("cd"))] }, 空, "4");

console.log("下标、字段、元组");
一("下标", { kind: "Index", target: str("abc"), index: int("1") }, 空, "b");
// 记录现在造得出来了：空记录取一个不存在的字段，报的是「没有这个字段」。
一("空记录取字段被拒绝", { kind: "Field", target: { kind: "Record", fields: [] }, name: "x" }, 空, "错：没有这个字段：x");
一("元组取长度", { kind: "Call", callee: name("len"), args: [{ kind: "Tuple", items: [int("1"), int("2")] }] }, 空, "2");

console.log("错处要说清，不静音");
{
  const r = call("求值成文字", [name("没有的"), 空]);
  ok("没有这个名字", r.includes("没有这个名字"), JSON.stringify(r));
  const r2 = call("求值成文字", [bin("**", int("2"), int("3")), 空]);
  ok("不认识的运算符", r2.includes("不认识的运算符"), JSON.stringify(r2));
  const r3 = call("求值成文字", [{ kind: "wat" }, 空]);
  ok("不认识的节点", r3.includes("不认识的节点"), JSON.stringify(r3));
  const r4 = call("求值成文字", [{ kind: "Error", text: "坏括号" }, 空]);
  ok("语法层的错被原样带上来", r4.includes("语法层报的错") && r4.includes("坏括号"), JSON.stringify(r4));
  const r5 = call("求值成文字", [{ kind: "Call", callee: name("nope"), args: [] }, 空]);
  ok("没有的函数据实说", r5.includes("没有这个函数"), JSON.stringify(r5));
  const r6 = call("求值成文字", [bin("+", int("1"), name("缺")), 空]);
  ok("左边对、右边错时整体出错（不拿左边顶上去）", r6.includes("没有这个名字"), JSON.stringify(r6));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
