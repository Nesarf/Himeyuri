// 临时：把返回类型写回 self/lex.hmyr 里那些「返回 {next, text}」的函数。
//
// 为什么 read_string 不在此列：它有两个返回形状 —— 有的分支带 closed 字段、有的不带。
// 而类型系统没有「可选字段」，所以给它写一个记录类型只会是半个谎。
// 那一条记在 design/LIB.txt 里，留给「可选字段」那件事。
import fs from "node:fs";
const 路 = "E:/himeyuri/self/lex.hmyr";
let t = fs.readFileSync(路, "utf8");
const 形状 = "{next: Int, text: String}";
const 名们 = ["read_ident", "read_based", "read_number", "read_escape", "read_punct", "read_punct_two"];
let n = 0;
for (const 名 of 名们) {
  const 旧 = new RegExp("^(fn " + 名 + "\\([^)]*\\))( \\{)", "m");
  if (旧.test(t)) { t = t.replace(旧, "$1 -> " + 形状 + "$2"); n++; }
}
fs.writeFileSync(路, t, "utf8");
console.log("写回 " + n + " 个返回类型");
