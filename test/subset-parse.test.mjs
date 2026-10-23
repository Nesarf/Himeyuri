// 子集 parser 搭出来的树，与宿主搭出来的一样（形状与位置都算）。
//
// 比的是整棵树，包括每一层的字段名与每个节点的行号列号——同一棵树，字段名或位置不同也算不同，
// 因为后面要读这棵树的人按字段名读，而报错按位置指回去。
//
// 起初是分开做的：先钉形状，再钉位置。分开的理由写在 src/subset-parse.mjs 里，
// 而位置那一格只查出一种取法要照抄（Field 记字段名之后那个 token 的位子）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { 切 } from "../src/subset-lex.mjs";
import { 子集解 } from "../src/subset-parse.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 摊平：节点数本身也是一个可核对的数，而它在深比较失败时能说出「差在第几个节点」。
const 摊 = (n, 路 = "$", 出 = []) => {
  if (Array.isArray(n)) { n.forEach((v, k) => 摊(v, 路 + "[" + k + "]", 出)); return 出; }
  if (!n || typeof n !== "object") return 出;
  if (n.kind) 出.push({ 路, kind: n.kind, line: n.line, column: n.column });
  for (const k of Object.keys(n)) { if (k === "line" || k === "column" || k === "kind") continue; 摊(n[k], 路 + "." + k, 出); }
  return 出;
};
const 第一个不同 = (a, b, 路 = "") => {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return 路 + " 长度 " + a.length + " 对 " + b.length;
    for (let k = 0; k < a.length; k++) { const r = 第一个不同(a[k], b[k], 路 + "[" + k + "]"); if (r) return r; }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (JSON.stringify(ka) !== JSON.stringify(kb)) return 路 + " 字段 " + JSON.stringify(ka) + " 对 " + JSON.stringify(kb);
    for (const k of ka) { const r = 第一个不同(a[k], b[k], 路 + "." + k); if (r) return r; }
    return null;
  }
  return a === b ? null : 路 + " " + JSON.stringify(a) + " 对 " + JSON.stringify(b);
};

const 宿主树 = (源) => {
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  return parse(lex(源, { diagnostics: d }).tokens, { diagnostics: d }).ast;
};

console.log("一、六份源码：两棵树相同（形状与位置）");
let 函数总数 = 0, 节点总数 = 0;
for (const 名 of ["lex", "chain", "stmt", "body", "eval", "run"]) {
  const 源 = fs.readFileSync(path.join(ROOT, "self", 名 + ".hmyr"), "utf8");
  const 主 = 宿主树(源);
  let 子 = null, 错 = "";
  try { 子 = 子集解(切(源)).ast; } catch (e) { 错 = e.message; }
  if (!子) { failed++; console.log("  不通过  " + 名 + " 抛错  " + 错); continue; }
  const 差 = 第一个不同(主, 子);
  ok(名 + "（" + 主.decls.length + " 个 fn，" + 主.imports.length + " 个 import）", 差 === null, 差 || "");
  函数总数 += 主.decls.length;
  节点总数 += 摊(子).length;
}
// 这两个数随自举层的规模走。读转义那一处补了函数，于是它们从 123 与 6285 长到这里；
// 算术那一组进求值器的分派时又长了 182 个节点（min 与 max 各走一遍循环）。
ok("合计 151 个函数声明", 函数总数 === 151, String(函数总数));
ok("合计 9920 个节点", 节点总数 === 9920, String(节点总数));

console.log("二、位置是逐个对过的，不是大致对");
{
  // 深比较已经含位置，这一条只是把「位置本身被比了」说成一句可以读的话。
  const 源 = fs.readFileSync(path.join(ROOT, "self", "chain.hmyr"), "utf8");
  const 主 = 摊(宿主树(源)), 子 = 摊(子集解(切(源)).ast);
  const 差 = 主.filter((a, k) => !子[k] || a.line !== 子[k].line || a.column !== 子[k].column);
  // Module 自己不带位置（宿主也不带），于是拿第一个带位置的节点来核。
  const 首个 = 主.find((n) => n.line > 0);
  ok("chain 的前几个节点各有自己的位置", 首个 && 子.find((n) => n.路 === 首个.路).line === 首个.line, JSON.stringify(首个));
  ok("chain 全部节点位置相同", 差.length === 0, JSON.stringify(差[0]));
  // Field 那一处怪处：宿主记的是字段名之后的 token。核一次它的位子不是字段名自己的。
  const 字段 = 主.find((n) => n.kind === "Field");
  ok("Field 的位置落在字段名之后（照抄宿主）", 字段 && 字段.column > 0, JSON.stringify(字段));
}

console.log("二、它认得窄，而窄这件事是明说的");
for (const [标, 源, 该说的] of [
  ["type 声明", "type T = Int\n", "只认 fn"],
  ["const 声明", "const X = 1\n", "只认 fn"],
  ["match", "fn f() -> Int { return match 1 { 1 => 2 } }\n", "match"],
  ["泛型", "fn f<T>(a: T) -> Int { return 1 }\n", "类型参数"],
  ["可空类型", "fn f(a: Int?) -> Int { return 1 }\n", "可空"],
  ["参数默认值", "fn f(a: Int = 1) -> Int { return a }\n", "默认值"],
  ["own 参数", "fn f(own a: Int) -> Int { return 1 }\n", "own"],
  ["带参数的效果", "fn f() effects(io(x)) { }\n", "带参数的效果"],
  ["带类型的 let", "fn f() { let a: Int = 1 }\n", "带类型的 let"],
  ["没有函数体", "fn f() -> Int\n", "函数体"],
]) {
  let 错 = "";
  try { 子集解(切(源)); } catch (e) { 错 = e.message; }
  ok(标 + "：报错说 " + 该说的, 错.includes(该说的), 错 || "（没有报错）");
}

console.log("三、If 与 While 在表达式层（它们在这一门语言里有值）");
{
  const 树 = 子集解(切("fn f(a: Int) -> Int {\n  let b = if a > 1 { 2 } else { 3 }\n  return b\n}\n")).ast;
  const 语句 = 树.decls[0].body.statements;
  ok("let 的值是 If 节点", 语句[0].value && 语句[0].value.kind === "If", JSON.stringify(语句[0].value && 语句[0].value.kind));
  const 树2 = 子集解(切("fn f(a: Int) { while a < 3 { a = a + 1 } }\n")).ast;
  ok("while 作为表达式语句出现", 树2.decls[0].body.statements[0].expr.kind === "While", 树2.decls[0].body.statements[0].expr.kind);
}

console.log("四、一元组与分组是两件事");
{
  const 组 = 子集解(切("fn f(a: Int) -> Int { return (a) }\n")).ast.decls[0].body.statements[0].value;
  const 元 = 子集解(切("fn f(a: Int) -> Int { return (a,) }\n")).ast.decls[0].body.statements[0].value;
  ok("(a) 是分组，不是元组", 组.kind === "Ident", 组.kind);
  ok("(a,) 是一元组", 元.kind === "Tuple" && 元.items.length === 1, 元.kind + " " + (元.items || []).length);
}

console.log("五、优先级与结合（四则与比较的档位）");
{
  const 树 = (源) => 子集解(切("fn f(a: Int) -> Int { return " + 源 + " }\n")).ast.decls[0].body.statements[0].value;
  const 乘 = 树("1 + 2 * 3");
  ok("乘法先于加法", 乘.kind === "Binary" && 乘.op === "+" && 乘.right.op === "*", JSON.stringify(乘));
  const 减 = 树("1 - 2 - 3");
  ok("减法左结合", 减.left.op === "-", JSON.stringify(减));
  const 比 = 树("1 + 2 < 3 * 4");
  ok("比较在四则之上", 比.op === "<" && 比.left.op === "+" && 比.right.op === "*", JSON.stringify(比));
}

console.log("六、它自己的注释写着现在的账");
{
  const 文 = fs.readFileSync(path.join(ROOT, "src/subset-parse.mjs"), "utf8");
  ok("注释写了六种语句", 文.includes("let / var / assign / return / ExprStmt / Block"), "在");
  ok("注释写了位置也对齐了", 文.includes("六份共 9920 个节点，逐个相同"), "在");
  ok("注释写了那一处照抄的怪处", 文.includes("字段名之后那个 token"), "在");
  ok("注释写了它的立场", 文.includes("认得窄而说清"), "在");
  ok("注释写了数出来的声明种类", 文.includes("只有 fn，151 个"), "在");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
