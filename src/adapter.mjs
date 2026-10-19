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

export { 转 };
