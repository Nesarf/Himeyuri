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

// 只看种类与值：位置字段是子集还没有的东西，这里不该因为它而红。
const 简 = (tokens) => tokens.filter((t) => t.type !== "eof").map((t) => t.type + ":" + JSON.stringify(t.value));

console.log("一、六份源码：与宿主逐个 token 相同");
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

console.log("二、行尾是 ident、前一个是运算符时，换行必须出得来（就是那个笔误的形状）");
for (const [标, 源] of [
  ["赋值", "let a = b.value\nlet c = 1\n"],
  ["比较", "return t.text == ch\nreturn 1\n"],
  ["运算", "let n = x + y\nlet m = 2\n"],
]) {
  const 主 = 简(lex(源).tokens);
  const 子 = 简(切(源));
  ok(标 + "：两边相同", JSON.stringify(主) === JSON.stringify(子), "宿主 " + 主.join(" ") + " · 子集 " + 子.join(" "));
  ok(标 + "：换行确实在", 子.includes("newline:" + JSON.stringify("\n")), 子.join(" "));
}

console.log("三、续行的两种情况仍然成立（规则不是靠吞掉一切凑出来的）");
{
  const 括号 = 切("let a = (1 +\n 2)\n");
  // 括号内那一个不出，收尾行末那一个照出——于是整段只有一个换行。
  ok("括号开着 → 那一个换行不出", 简(括号).filter((t) => t === "newline:" + JSON.stringify("\n")).length === 1, 简(括号).join(" "));
  const 运算符 = 切("let a = 1 +\n 2\n");
  const 简运 = 简(运算符);
  ok("行尾是运算符 → 那一个换行不出", 简运.filter((t) => t === "newline:" + JSON.stringify("\n")).length === 1, 简运.join(" "));
}

console.log("四、它认得窄，而窄这件事是明说的");
{
  let 错 = "";
  try { 切("let a = 1.5\n"); } catch (e) { 错 = e.message; }
  ok("浮点数报错而不是猜", 错.includes("浮点"), 错);
  let 错2 = "";
  try { 切("let a = \"\\x41\"\n"); } catch (e) { 错2 = e.message; }
  ok("未认的转义报错而不是猜", 错2.includes("转义"), 错2);
}

console.log("五、它自己的注释写着现在的账");
{
  const 文 = fs.readFileSync(path.join(ROOT, "src/subset-lex.mjs"), "utf8");
  ok("注释里有六份的 token 数", /lex 1988/.test(文), "在");
  ok("注释说清了那个笔误", 文.includes("出.push 而不是 记()"), "在");
  ok("注释说清了它还缺什么", 文.includes("行号与列号"), "在");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
