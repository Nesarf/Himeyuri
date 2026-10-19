// AST 反射：一棵树里的符号，按行说出来。
//
// 语言服务器要两件事才能工作：知道「这个名字在哪儿定义的」，与知道
// 「这一行上有什么」。前者是跳转，后者是补全的上下文。
// 而这个工具就做那一层——不是服务器，是服务器脚下那块地。
//
// 两条要说清的缺口，都是 AST 自己的形状决定的：
//
//   一、只有行，没有列。于是这里能答「第几行有 foo」，不能答「第几列」。
//   二、参数不带行：参数对象是 { name, type } 而没有 line。
//      于是参数在符号表里 line 为 null——那不是漏了，那是它真的不知道。
//      用类型的行去代替它是个诱人的做法，而那是猜；猜出来的位置比没有位置更坏，
//      因为读的人分不出哪个是记下来的、哪个是猜出来的。
//
// 两条都要动词法与语法才能补。而那正说明这一层是诚实的：它只说自己知道的。
//
//   node tools/ast.mjs 文件.hmyr        符号表（JSON）
//   node tools/ast.mjs 文件.hmyr --行 7  第 7 行上有什么
import fs from "node:fs";
import path from "node:path";

const { lex } = await import("../src/lexer.mjs");
const { parse } = await import("../src/parser.mjs");

const 参 = process.argv.slice(2);
const 文件 = 参[0];
if (!文件) {
  console.error("  给一个文件：node tools/ast.mjs 你的文件.hmyr");
  process.exit(2);
}
const 源 = fs.readFileSync(path.resolve(文件), "utf8");
const d = { items: [], errors: [], warnings: [], add(s, c, m) { this.items.push({ s, c, m }); }, error(c, m) { this.add("error", c, m); }, warn(c, m) { this.add("warning", c, m); } };
const { ast } = parse(lex(源, { diagnostics: d }).tokens, { diagnostics: d });
const 错 = d.items.filter((x) => (x.s || x.severity) === "error");
if (错.length) {
  // 解析不出树时如实说，而不是交出一份空符号表让人以为文件里没东西。
  console.error("  这文件解析不了，于是没有符号表：" + 错.slice(0, 3).map((x) => (x.c || x.code)).join(" "));
  process.exit(1);
}

// 一、走一遍树，收集符号。
//
// 为什么要递归而不是按已知的字段取：树的形状会长（新的语句种类、新的表达式种类），
// 而写死字段名的那种走法会在树长大的那天静默地少收东西。递归不会。
const 符号们 = [];
const 走 = (节点, 上下文) => {
  if (!节点 || typeof 节点 !== "object") return;
  if (Array.isArray(节点)) { for (const x of 节点) 走(x, 上下文); return; }

  const 种类 = 节点.kind;
  const 行 = typeof 节点.line === "number" ? 节点.line : null;

  if (种类 === "Fn" && 节点.name) {
    符号们.push({ kind: "fn", name: 节点.name, line: 行, detail: "函数" });
    走(节点.params, { 在: 节点.name });
    走(节点.body, { 在: 节点.name });
    return;
  }
  if (种类 === "Param" || (节点.name && 节点.type && !种类)) {
    // 参数在 AST 里是 { name, type } 而不是带 kind 的节点——于是按「有名字有类型」认它。
    符号们.push({ kind: "param", name: 节点.name, line: 行, detail: "参数（在 " + (上下文 && 上下文.在 ? 上下文.在 : "?") + " 里）" });
    走(节点.type, 上下文);
    return;
  }
  if ((种类 === "Let" || 种类 === "Var" || 种类 === "Assign") && 节点.name) {
    符号们.push({ kind: 种类 === "Var" ? "var" : 种类 === "Let" ? "let" : "assign", name: 节点.name, line: 行, detail: 种类 === "Assign" ? "赋值" : "局部变量" });
    return;
  }
  if (种类 === "TypeRef" && 节点.name) {
    符号们.push({ kind: "type", name: 节点.name, line: 行, detail: "类型名" });
    return;
  }

  // 其余节点：继续往下走，而不猜它的字段
  for (const v of Object.values(节点)) 走(v, 上下文);
};
走(ast.decls, {});

// 二、按行输出，还是整个符号表
const 行参 = 参.indexOf("--行");
if (行参 >= 0) {
  const 行号 = Number(参[行参 + 1]);
  const 在这一行 = 符号们.filter((s) => s.line === 行号);
  console.log("  第 " + 行号 + " 行有 " + 在这一行.length + " 个符号：");
  for (const s of 在这一行) console.log("    " + s.kind.padEnd(6) + s.name.padEnd(20) + s.detail);
} else {
  console.log(JSON.stringify({ file: 文件, symbols: 符号们 }, null, 2));
}
