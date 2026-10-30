// Unicode 别名的验收：全角标点与数学符号归一成 ASCII 记号。
//
// 一条规矩两种落点：源码接受得宽（中文输入法下不必来回切换），而规范输出仍是 ASCII
// （格式化器那一侧保证）。这里验的是前一半，顺带把「真正的未知字符仍然报错」也钉住——
// 归一不是把错误静音。
import { lex } from "../src/lexer.mjs";

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const run = (source) => {
  const diagnostics = { items: [], errors: [], warnings: [], add(s, c, m) { this.items.push({ s, c, m }); if (s === "error") this.errors.push({ code: c, message: m }); }, error(c, m) { this.add("error", c, m); }, warn(c, m) { this.add("warning", c, m); } };
  const out = lex(source, { diagnostics });
  return { tokens: out.tokens, errors: diagnostics.errors.map((e) => e.code) };
};
const shape = (r) => r.tokens.filter((t) => t.type !== "eof").map((t) => t.type + ":" + t.value).join(" ");

console.log("全角标点：读出来的 token 与 ASCII 写法完全一样");
ok("全角括号", shape(run("（a）")) === shape(run("(a)")), shape(run("（a）")));
ok("全角逗号与方括号", shape(run("【1，2】")) === shape(run("[1,2]")), shape(run("【1，2】")));
ok("全角冒号与等于号", shape(run("a：＝b")) === shape(run("a:=b")), shape(run("a：＝b")));
ok("全角问号与感叹号", shape(run("？？！")) === shape(run("??!")), shape(run("？？！")));

console.log("数学符号：一个符号归一成一个运算符");
ok("小于等于合成一个 token", shape(run("a≤b")) === shape(run("a<=b")), shape(run("a≤b")));
ok("大于等于", shape(run("a≥b")) === shape(run("a>=b")), shape(run("a≥b")));
ok("不等于", shape(run("a≠b")) === shape(run("a!=b")), shape(run("a≠b")));
ok("箭头", shape(run("a→b")) === shape(run("a->b")), shape(run("a→b")));
ok("逻辑与", shape(run("a∧b")) === shape(run("a&&b")), shape(run("a∧b")));
ok("逻辑或", shape(run("a∨b")) === shape(run("a||b")), shape(run("a∨b")));
ok("非", shape(run("¬a")) === shape(run("!a")), shape(run("¬a")));
ok("约等号读作比较", shape(run("a≈b")) === shape(run("a==b")), shape(run("a≈b")));

console.log("括号平衡：归一之后仍然要成对");
ok("全角括号成对时没有错", run("（a）").errors.length === 0, run("（a）").errors.join(","));
ok("全角右括号单独出现要报错", run("a）").errors.includes("HMYR-詞-005"), run("a）").errors.join(","));
ok("全角左括号不闭合要报错", run("（a").errors.includes("HMYR-詞-005"), run("（a").errors.join(","));

console.log("归一不是把错误静音");
ok("真正的未知字符仍然报 HMYR-詞-007", run("a§b").errors.includes("HMYR-詞-007"), run("a§b").errors.join(","));
ok("而 @ 本来就在标点表里，它不算未知", run("a@b").errors.length === 0, run("a@b").errors.join(","));
ok("控制字符仍然报 HMYR-詞-007", run("a" + String.fromCharCode(7) + "b").errors.includes("HMYR-詞-007"), "控制符那条");
ok("未映射的全角符号也报错（破折号不在表里）", run("a—b").errors.includes("HMYR-詞-007"), run("a—b").errors.join(","));

console.log("行列号仍然可信");
{
  const r = run("a\n≤b");
  const lt = r.tokens.find((t) => t.value === "<=");
  ok("归一出来的符号带着自己的行列号", lt && lt.line === 2, JSON.stringify(lt && { line: lt.line, column: lt.column }));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
