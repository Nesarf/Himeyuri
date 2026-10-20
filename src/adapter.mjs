// 适配：把宿主解析出来的树，转成自举那一层认的形状。
//
// 为什么需要它：两边的树说的是同一件事，而用的是两套名字。
//
//   宿主（src/parser.mjs）      自举（self/eval.hmyr）
//     {kind:"Literal", type, value}   {kind:"int"|"str", text}
//     {kind:"Ident", name}            {kind:"name", text}
//     {kind:"Binary", op, left, right} {kind:"bin", op, left, right}
//     {kind:"Unary", op, operand}     {kind:"unary", op, operand}
//     Call / Index / Field / Tuple / Record  → 同名小写
//
// 这一份只做**表达式**。语句那一层（let / var / return / assign / if / while / block）
// 还没做，而那不是遗漏——是两个不同大小的东西，先做小的那个，把它验绿了再谈大的。
//
// 一条要守的规矩：转不了的东西交回 {kind:"err"}，并说清为什么。
// 猜一个形状比交回错误更坏——因为猜出来的东西会被求值，而错误会被看见。
import { lex } from "./lexer.mjs";
import { parse } from "./parser.mjs";

// 一个字面量转成自举认的那两种之一。
const 字面量 = (节点) => {
  if (节点.type === "int" || typeof 节点.value === "number") {
    return { kind: "int", text: String(节点.raw !== undefined ? 节点.raw : 节点.value) };
  }
  // 宿主用的类型名是 "string"，而自举认的是 "str" —— 这个译名差一点就让「字符串」
  // 变成一句「转不了」。而它说出了原因，于是那处错立刻可见，而不是静默地算错。
  if (节点.type === "str" || 节点.type === "string") return { kind: "str", text: String(节点.value) };
  return { kind: "err", text: "这一版只转整数与字符串字面量，而这里是 " + String(节点.type) };
};

const 转 = (节点) => {
  if (!节点 || typeof 节点 !== "object") return { kind: "err", text: "空节点" };

  switch (节点.kind) {
    case "Literal":
      return 字面量(节点);

    case "Ident":
      return { kind: "name", text: String(节点.name) };

    case "Binary":
      return { kind: "bin", op: String(节点.op), left: 转(节点.left), right: 转(节点.right) };

    case "Unary":
      return { kind: "unary", op: String(节点.op), operand: 转(节点.operand) };

    case "Call":
      return { kind: "call", callee: 转(节点.callee), args: (节点.args || []).map(转) };

    case "Index":
      return { kind: "index", target: 转(节点.target), index: 转(节点.index) };

    case "Field":
      return { kind: "field", target: 转(节点.target), name: String(节点.name) };

    case "Tuple":
      return { kind: "tuple", items: (节点.items || []).map(转) };

    case "Record":
      // 记录在宿主里是 { fields: [{name, value}] }，而自举认的是同样的形状。
      return { kind: "record", fields: (节点.fields || []).map((f) => ({ name: String(f.name), value: 转(f.value) })) };

    default:
      // 语句与别的种类：如实说不转，而不是硬塞一个形状进去。
      return { kind: "err", text: "这一版不转 " + String(节点.kind) };
  }
};

// 从源码直接得到一棵自举认的表达式树。给测试与桥用。
export const expression = (源码) => {
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(源码, { diagnostics: d }).tokens, { diagnostics: d });
  const 语句 = ast.decls && ast.decls[0] && ast.decls[0].body && ast.decls[0].body.statements;
  // 取第一个 return 的表达式——这一版只转表达式，于是不必假装能跑整个文件。
  const 找 = (列表) => {
    for (const s of 列表 || []) {
      if (s.kind === "Return" && s.value) return s.value;
    }
    return null;
  };
  const 目 = 找(语句);
  if (!目) return { kind: "err", text: "这份源码里没有可转的 return 表达式" };
  return 转(目);
};

// ---- 二、语句 ----
//
// 语句与表达式的差别不是大小，而是它们**碰环境**：let 把名字绑进去、return 中断执行、
// if 挑一个块跑。于是这一层的验收也不同——不是「两边算出同一个数」，
// 而是「两边跑完同一段程序，最后得同一个数」。
//
// 自举那边认六种：let · var · assign · expr · return · if。
// 而宿主是 Let · Var · Assign · ExprStmt · Return · If —— 逐一对上，只是名字与形状小有出入：
//
//   ExprStmt 在自举那边多包一层：{kind:"expr", value} 而不是 {kind:"expr", expr}
//   If 的 else 在自举那边叫 otherwise，而两边装的都是语句序列
//   Return 无值时，自举那边要 {kind:"nil"} 而不是 null
//
// 函数声明不在这一层：那要一张函数表，是另一件事。于是它交回 err，而不是假装能转。

const 块 = (节点) => {
  if (!节点) return [];
  if (节点.kind === "Block") return (节点.statements || []).map(语句).filter(Boolean);
  if (Array.isArray(节点)) return 节点.map(语句).filter(Boolean);
  return [语句(节点)].filter(Boolean);
};

const 语句 = (节点) => {
  if (!节点 || typeof 节点 !== "object") return { kind: "err", text: "空语句" };

  switch (节点.kind) {
    case "Let":
    case "Var":
      return { kind: 节点.kind === "Var" ? "var" : "let", name: String(节点.name), value: 转(节点.value) };

    case "Assign":
      return { kind: "assign", name: String(节点.name), value: 转(节点.value) };

    case "ExprStmt":
      // 宿主把 if 解成了表达式语句——于是这里的 expr 可能就是 If。
      // 那是一个「语句装成表达式」的怪形状：它在宿主那边是自洽的（if 后面还能接东西），
      // 而自举那边 If 就是语句。于是这里把它剥出来，而不是包进 expr 里。
      //
      // 这个差别不是错，是两种理解；而把它在这里说清，比在求值时才炸开好。
      if (节点.expr && (节点.expr.kind === "If" || 节点.expr.kind === "While")) return 语句(节点.expr);
      return { kind: "expr", value: 转(节点.expr) };

    case "Return":
      // 无值的 return 在自举那边是 {kind:"nil"} 而不是 null——
      // 一个空的元组是值，而「没有值」不是一个值。那条规矩在那边守着，于是这里也守。
      return { kind: "return", value: 节点.value ? 转(节点.value) : { kind: "nil" } };

    case "If":
      // 宿主的字段叫 condition 而不是 cond，而 otherwise 又恰好同名——
      // 猜对一半的代价是：猜对的那一半不会告诉你猜错的那一半。
      return { kind: "if", cond: 转(节点.condition), then: 块(节点.then), otherwise: 块(节点.otherwise) };

    case "While":
      // 与 If 一样，条件在 condition 里（而 If 我一开始猜成 cond，踩过一次）。
      // 体在 body 里，是 Block；而 If 那边叫 then。
      return { kind: "while", cond: 转(节点.condition), body: 块(节点.body) };

    case "Block":
      // 裸的块：它的语句就是这一条「语句」，于是上面用 块() 展开它。
      return { kind: "err", text: "裸块不该单独出现" };

    case "DeclStmt":
    case "Fn":
      // 函数声明要一张函数表，而那是另一件事。说清，而不是塞一个假形状进去。
      return { kind: "err", text: "函数声明不在这一层：那要一张函数表" };

    default:
      return { kind: "err", text: "这一版不转这种语句：" + String(节点.kind) };
  }
};

// 从源码得到一段自举认的语句序列（某个函数体）。
export const statements = (源码) => {
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(源码, { diagnostics: d }).tokens, { diagnostics: d });
  const fn = (ast.decls || []).find((x) => x.kind === "Fn" && x.name === "main");
  if (!fn) return { 语句们: null, 错: "没有 main" };
  return { 语句们: 块(fn.body), 错: null };
};

// ---- 三、函数表 ----
//
// 自举那边的函数表是一串三元元组 (("名字", 参数名们, 语句们), ...)，由 装函数从 装进环境，
// 而 求调用 用 "fn:" + 名字 去查。
//
// 一条要写明的边界：自举那边执行函数体时**不把参数绑进环境**
// （见 self/eval.hmyr 的 求调用）。于是它现在只跑得了无参函数。
// 那不是这一层的缺口——这一层只负责造表；而把参数绑进去是求值器自己的事。
// 说在这里，是因为读的人会以为「表造对了就能带参数」。

export const functions = (源码) => {
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(源码, { diagnostics: d }).tokens, { diagnostics: d });
  const 表 = [];
  const 错们 = [];
  for (const 声 of ast.decls || []) {
    if (声.kind !== "Fn") continue;
    const 体 = 块(声.body);
    const 坏的 = 体.find((s) => s && s.kind === "err");
    if (坏的) { 错们.push(声.name + "：" + 坏的.text); continue; }
    // 三件：名字、参数名们、语句们。自举那边要用参数名去绑环境。
    表.push([String(声.name), (声.params || []).map((p) => String(p.name)), 体]);
  }
  return { 表, 错们 };
};

export { 转, 语句 };
