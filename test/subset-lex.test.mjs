// 子集切词器对得上宿主的切词器：六份源码，token 的种类、值、顺序逐个相同。
//
// 这一段之前是半成品，而它卡住的地方值得记下来，因为成因与症状完全不像：
//
//   ident 与 keyword 那一支用 出.push 而不是 记()，于是 末个 停在更早的运算符上，
//   续行() 把真实的行尾误判成续行，把 newline 吞掉。
//
// 一个笔误，六份里的四份各差几个 token，而看起来像「换行规则理解错了」。
// 于是这一套不只想钉「两边一致」，还想钉住那个具体的形状：行尾是一个 ident、
// 而它前面是运算符时，那一个换行必须出得来。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.mjs";
import { 切 } from "../src/subset-lex.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 种类、值、位置一起比。连末尾那个 eof 也比——它带着「源码到这里结束」的位置，
// 而一个没关的块要靠它把报错指到对的位子。
const 简 = (tokens) => tokens.map((t) => t.type + ":" + JSON.stringify(t.value) + "@" + t.line + ":" + t.column);

console.log("一、六份源码：与宿主逐个 token 相同（含行号与列号）");
let 总数 = 0;
for (const 名 of ["lex", "chain", "stmt", "body", "eval", "run"]) {
  const 源 = fs.readFileSync(path.join(ROOT, "self", 名 + ".hmyr"), "utf8");
  const 主 = 简(lex(源).tokens);
  let 子 = null, 错 = "";
  try { 子 = 简(切(源)); } catch (e) { 错 = e.message; }
  if (!子) { failed++; console.log("  不通过  " + 名 + " 子集抛错  " + 错); continue; }
  let 岔 = -1;
  for (let k = 0; k < Math.min(主.length, 子.length); k++) if (主[k] !== 子[k]) { 岔 = k; break; }
  if (岔 < 0 && 主.length !== 子.length) 岔 = Math.min(主.length, 子.length);
  ok(名 + "（" + 主.length + " 个 token）", 岔 < 0, 岔 >= 0 ? "分岔在第 " + 岔 + " 个：宿主 " + 主[岔] + " · 子集 " + 子[岔] : "");
  总数 += 主.length;
}

const 数换行 = (简们) => 简们.filter((t) => t.startsWith("newline:")).length;

console.log("二、行尾是 ident、前一个是运算符时，换行必须出得来（就是那个笔误的形状）");
for (const [标, 源] of [
  ["赋值", "let a = b.value\nlet c = 1\n"],
  ["比较", "return t.text == ch\nreturn 1\n"],
  ["运算", "let n = x + y\nlet m = 2\n"],
]) {
  const 主 = 简(lex(源).tokens);
  const 子 = 简(切(源));
  ok(标 + "：两边相同", JSON.stringify(主) === JSON.stringify(子), "宿主 " + 主.join(" ") + " · 子集 " + 子.join(" "));
  ok(标 + "：换行确实在", 数换行(子) === 2, 子.join(" "));
}

console.log("三、续行的两种情况仍然成立（规则不是靠吞掉一切凑出来的）");
{
  const 括号 = 简(切("let a = (1 +\n 2)\n"));
  // 括号内那一个不出，收尾行末那一个照出——于是整段只有一个换行。
  ok("括号开着 → 那一个换行不出", 数换行(括号) === 1, 括号.join(" "));
  const 运算符 = 简(切("let a = 1 +\n 2\n"));
  ok("行尾是运算符 → 那一个换行不出", 数换行(运算符) === 1, 运算符.join(" "));
  const 连接词 = 简(切("let a = 1 and\n 2\n"));
  ok("行尾是 and → 那一个换行不出", 数换行(连接词) === 1, 连接词.join(" "));
}

console.log("四、它认得窄，而窄这件事是明说的");
{
  // 浮点与进制认得：不认它们的话 0x10 会被切成 int「0」加 ident「x10」，那是个静默的错。
  for (const [标, 源] of [["小数", "let a = 1.5\n"], ["指数", "let a = 1e3\n"], ["进制", "let a = 0x10\n"]]) {
    const 主 = 简(lex(源).tokens);
    const 子 = 简(切(源));
    ok(标 + "：与宿主相同", JSON.stringify(主) === JSON.stringify(子), "宿主 " + 主.join(" ") + " · 子集 " + 子.join(" "));
  }
  let 错2 = "";
  try { 切("let a = \"\\x41\"\n"); } catch (e) { 错2 = e.message; }
  ok("未认的转义报错而不是猜", 错2.includes("转义"), 错2);
}

console.log("五、位置：CRLF、注释与多行，位置都跟着宿主的算法");
{
  // \r 也占一列——宿主如此，这里照办。CRLF 的源码上两边的列号才会一致。
  for (const [标, 源] of [
    ["CRLF 两行", "let a = 1\r\nlet b = 2\r\n"],
    ["行注释跨行", "// 一\nlet a = 1\n"],
    ["块注释跨行", "/* 一\n二 */ let a = 1\n"],
    ["中文标识符", "let 名字 = 1\nlet 换 = 2\n"],
    ["空行与缩进", "\n  let a = 1\n\n   let b = 2\n"],
  ]) {
    const 主 = 简(lex(源).tokens);
    const 子 = 简(切(源));
    ok(标 + "：位置相同", JSON.stringify(主) === JSON.stringify(子), "宿主 " + 主.join(" ") + " · 子集 " + 子.join(" "));
  }
  // 报错也带位置：一个指不回源码的错误，等于没有位置。
  let 错 = "";
  try { 切("let a = 1\nlet b = \"\\x41\"\n"); } catch (e) { 错 = e.message; }
  ok("报错带行列", 错.includes("行 2"), 错);
}

console.log("六、它自己的注释写着现在的账");
{
  const 文 = fs.readFileSync(path.join(ROOT, "src/subset-lex.mjs"), "utf8");
  ok("注释里有六份的 token 数", /lex 1989/.test(文), "在");
  ok("注释说清了那个笔误", 文.includes("出.push 而不是 记()"), "在");
  ok("注释说清了位置照谁抄", 文.includes("算法照 src/lexer.mjs"), "在");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
