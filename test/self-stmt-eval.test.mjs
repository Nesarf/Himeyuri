// 自举求值器的语句层：从「算一个表达式」到「跑一段带变量的程序」。
//
// 环境用追加一对的方式更新（这门语言的 let 不可变），查找从后往前，于是后定义覆盖先定义。
// 执行结果统一成 {ok, env, done, value}——错误一路往上走，不会被当成值。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "self/eval.hmoca"));
ok("求值器加载得动", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const 跑 = (语句们) => rt.callFunction(rt.functions.get("跑程序"), [语句们], null);
const int = (t) => ({ kind: "int", text: t });
const str = (t) => ({ kind: "字", text: t });
const name = (t) => ({ kind: "名", text: t });
const bin = (op, l, r) => ({ kind: "二元", op, left: l, right: r });
const 无值 = { kind: "nil" };   // 「没有值」与「一个空元组」是两件事，用 nil 节点区分开
const 值 = (语句们) => { const r = 跑(语句们); return r.ok ? r.value : "错：" + r.text; };

console.log("let 与 var");
ok("let 之后 return 它", 值([{ kind: "Let", name: "x", value: int("2") }, { kind: "Return", value: name("x") }]) === 2);
ok("var 可以再赋值", 值([{ kind: "Var", name: "n", value: int("1") }, { kind: "Assign", name: "n", value: bin("+", name("n"), int("1")) }, { kind: "Return", value: name("n") }]) === 2);
ok("后定义覆盖先定义（查找从后往前）", 值([{ kind: "Let", name: "x", value: int("1") }, { kind: "Let", name: "x", value: int("2") }, { kind: "Return", value: name("x") }]) === 2);
ok("多个名字互不干扰", 值([{ kind: "Let", name: "a", value: int("1") }, { kind: "Let", name: "b", value: int("2") }, { kind: "Return", value: bin("+", name("a"), name("b")) }]) === 3);

console.log("return 与执行块");
ok("不带值的 return 交回空元组", JSON.stringify(值([{ kind: "Return", value: 无值 }])) === "[]");
ok("return 之后的语句不再执行", 值([{ kind: "Return", value: int("1") }, { kind: "Return", value: int("2") }]) === 1);
ok("走完没有 return 时 done 是假", 跑([{ kind: "Let", name: "x", value: int("1") }]).done === false);
ok("表达式语句照样执行（求值一次）", 跑([{ kind: "ExprStmt", value: int("1") }]).ok === true);

console.log("if");
ok("条件真时走 then", 值([{ kind: "Let", name: "n", value: int("5") }, { kind: "If", cond: bin(">", name("n"), int("3")), then: [{ kind: "Return", value: int("1") }], otherwise: [{ kind: "Return", value: int("0") }] }]) === 1);
ok("条件假时走 otherwise", 值([{ kind: "Let", name: "n", value: int("1") }, { kind: "If", cond: bin(">", name("n"), int("3")), then: [{ kind: "Return", value: int("1") }], otherwise: [{ kind: "Return", value: int("0") }] }]) === 0);
ok("没有 otherwise 时什么都不做", 跑([{ kind: "If", cond: bin("<", int("1"), int("0")), then: [{ kind: "Return", value: int("9") }], otherwise: [] }]).done === false);

console.log("错处如实说");
{
  const r = 跑([{ kind: "Assign", name: "nope", value: int("1") }]);
  ok("给没声明的名字赋值被拒绝", r.ok === false && r.text.includes("没声明过"), String(r.text));
  const r2 = 跑([{ kind: "wat" }]);
  ok("不认的语句照实说", r2.ok === false && r2.text.includes("还不认"), String(r2.text));
  const r3 = 跑([{ kind: "Let", name: "x", value: name("缺") }]);
  ok("值里有未知名字时整体出错", r3.ok === false && r3.text.includes("没有这个名字"), String(r3.text));
  const r4 = 跑([{ kind: "Error", text: "语法层说这里坏了" }]);
  ok("语法层的错被原样带上来", r4.ok === false && r4.text.includes("语法层说这里坏了"), String(r4.text));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
