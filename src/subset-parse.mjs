// 子集 parser：Stage 0 的第二层。token 进，树出。
//
// 现状：第一格（2026-10-20）。它认的是 self/ 那六份源码用到的构造，别的都报错。
//
// 那六份用到的（数出来的，不是照着语法书抄的）：
//   声明   只有 fn，123 个；没有 type / const / effect / pub，没有类型参数，没有 requires/ensures
//   参数   258 个，全部带类型，没有默认值，没有 own/borrow
//   类型   只有三种：Int 189、String 65、Bool 4——全是单名，没有元组、没有 fn 类型、没有可空
//   语句   六种：let / var / assign / return / ExprStmt / Block
//   表达式 十一种：Literal · Ident · Binary · Unary · Call · Index · Field · Tuple · Record · If · While
//   运算符 十四种，五档优先级（与 src/parser.mjs 的 PRECEDENCE 同一张表）
//
// 它的立场是「认得窄而说清」：遇到不认的构造就抛错，说清是哪一行哪一列，
// 而不是猜一个树出来。一个猜出来的树会在后面某一层变成算错的数，而那时已经看不出源头。
//
// 它的产物形状与 src/parser.mjs 相同（同样的 kind 名、同样的字段名），
// 于是「两棵树一样」可以直接深比较，不需要一层适配。
//
// 位置也对齐了：六份共 6285 个节点，逐个相同。过程里只查出一种取法要照抄——
// Field 记的是「字段名之后那个 token」的位子。宿主如此，这里照办。
//
// Block 只带 line 不带 column，这一处也照抄：缺一个字段与有一个错的字段不是一回事，
// 而「两棵树一样」这句话要经得起逐节点核。
const 优先级 = [
  ["||"],
  ["&&"],
  ["==", "!=", "<", "<=", ">", ">="],
  ["+", "-"],
  ["*", "/", "%"],
];

const 尾 = { type: "eof", value: "", line: 0, column: 0 };

export const 子集解 = (tokens) => {
  let i = 0;
  // 子集切词器不产 eof token，而 parser 需要一个「这里没有 token 了」的东西。
  // 它的位置写成 0——一个不存在的位子不编一个数出来。
  const 看 = (n = 0) => tokens[i + n] || 尾;
  const 是 = (type, value) => { const t = 看(); return t.type === type && (value === undefined || t.value === value); };
  const 是标 = (v) => 是("punct", v);
  const 进 = () => tokens[i++];
  const 说明 = (t) => t.type === "eof" ? "文件尾" : (t.type + " " + JSON.stringify(t.value));
  const 在哪 = (t) => "行 " + t.line + " 列 " + t.column;
  const 要标 = (v, 什么) => {
    if (是标(v)) return 进();
    throw new Error("期望 " + JSON.stringify(v) + (什么 ? "（" + 什么 + "）" : "") + "，见到 " + 说明(看()) + "（" + 在哪(看()) + "）");
  };
  const 要 = (type, 什么) => {
    if (是(type)) return 进();
    throw new Error("期望 " + (什么 || type) + "，见到 " + 说明(看()) + "（" + 在哪(看()) + "）");
  };
  // 换行只在语句边界有意义，表达式里一律跳过。
  const 过空行 = () => { while (是("newline")) 进(); };
  const 收句 = () => {
    if (是("newline")) { 过空行(); return; }
    if (是标("}") || 是("eof")) return;
    throw new Error("期望语句结束，见到 " + 说明(看()) + "（" + 在哪(看()) + "）");
  };

  function 解析模块() {
    const imports = [], decls = [];
    过空行();
    while (是("keyword", "import")) imports.push(解析导入());
    过空行();
    while (!是("eof")) {
      decls.push(解析声明());
      过空行();
    }
    return { kind: "Module", imports, decls };
  }

  function 解析导入() {
    const kw = 进();
    const 路 = 要("string", "模块路径");
    let alias = null;
    if (是("keyword", "as")) { 进(); alias = 要("ident", "别名"); }
    收句();
    return { kind: "Import", path: 路.value, alias: alias ? alias.value : null, line: kw.line, column: kw.column };
  }

  function 解析声明() {
    if (是("keyword", "fn")) return 解析函数();
    throw new Error("子集只认 fn 声明，见到 " + 说明(看()) + "（" + 在哪(看()) + "）");
  }

  function 解析函数() {
    const kw = 进();
    const 名 = 要("ident", "函数名");
    if (是标("<")) throw new Error("子集不含类型参数（" + 在哪(看()) + "）");
    要标("(", "开参数表");
    const params = 是标(")") ? [] : 解析参数们();
    要标(")", "关参数表");
    let returns = null;
    if (是标("->")) { 进(); returns = 解析类型(); }
    let effects = null;
    if (是("keyword", "effects")) effects = 解析效果们();
    const body = 是标("{") ? 解析块() : null;
    if (!body) throw new Error("子集的函数必须有函数体：" + 名.value + "（" + 在哪(kw) + "）");
    return { kind: "Fn", name: 名.value, typeParams: [], params, returns, effects, contracts: { requires: [], ensures: [] }, body, pub: false, line: kw.line, column: kw.column };
  }

  function 解析参数们() {
    const list = [];
    while (!是标(")") && !是("eof")) {
      if (是("keyword", "own") || 是("keyword", "borrow")) throw new Error("子集不含 own/borrow 参数（" + 在哪(看()) + "）");
      const 名 = 要("ident", "参数名");
      要标(":", "参数名之后");
      const type = 解析类型();
      if (是标("=")) throw new Error("子集不含参数默认值（" + 在哪(看()) + "）");
      list.push({ name: 名.value, type, passing: null, fallback: null, line: 名.line, column: 名.column });
      if (是标(",")) 进(); else break;
    }
    return list;
  }

  function 解析效果们() {
    进();
    要标("(", "开效果表");
    const list = [];
    while (!是标(")") && !是("eof")) {
      if (是("ident") || 是("keyword")) list.push(进().value);
      else throw new Error("效果名不对：" + 说明(看()) + "（" + 在哪(看()) + "）");
      if (是标("(")) throw new Error("子集不含带参数的效果（" + 在哪(看()) + "）");
      if (是标(",")) 进(); else break;
    }
    要标(")", "关效果表");
    return list;
  }

  // 六份里只用过单名的 TypeRef。别的一律报错，因为报错比猜错有用。
  function 解析类型() {
    const t = 看();
    if (是标("(") || 是("keyword", "fn")) throw new Error("子集只认单名类型，见到 " + 说明(t) + "（" + 在哪(t) + "）");
    const 名 = 要("ident", "类型名");
    if (是标("<")) throw new Error("子集不含泛型类型（" + 在哪(看()) + "）");
    if (是标("?")) throw new Error("子集不含可空类型（" + 在哪(看()) + "）");
    return { kind: "TypeRef", name: 名.value, args: [], nullable: false, line: t.line, column: t.column };
  }

  function 解析块() {
    const 开 = 要标("{", "开块");
    const statements = [];
    过空行();
    while (!是标("}") && !是("eof")) {
      statements.push(解析语句());
      过空行();
    }
    要标("}", "关块");
    return { kind: "Block", statements, line: 开.line };
  }

  function 解析语句() {
    const t = 看();
    // 赋值：左边只能是一个名字。这一条在语法里就是唯一的改变途径。
    if (t.type === "ident" && 看(1).type === "punct" && 看(1).value === "=") {
      const 名 = 进();
      进();
      const value = 解析表达式();
      收句();
      return { kind: "Assign", name: 名.value, value, line: 名.line, column: 名.column };
    }
    if (是("keyword", "let") || 是("keyword", "var")) {
      const kw = 进();
      const 名 = 要("ident", "名字");
      if (是标(":")) throw new Error("子集不含带类型的 let/var（" + 在哪(看()) + "）");
      要标("=", "赋值号");
      const value = 解析表达式();
      收句();
      return { kind: kw.value === "let" ? "Let" : "Var", name: 名.value, type: null, value, line: kw.line, column: kw.column };
    }
    if (是("keyword", "return")) {
      const kw = 进();
      const value = (是("newline") || 是标("}") || 是("eof")) ? null : 解析表达式();
      收句();
      return { kind: "Return", value, line: kw.line, column: kw.column };
    }
    const expr = 解析表达式();
    收句();
    return { kind: "ExprStmt", expr, line: t.line, column: t.column };
  }

  const 解析表达式 = () => 解析二元(0);

  function 解析二元(档) {
    if (档 >= 优先级.length) return 解析一元();
    let left = 解析二元(档 + 1);
    while (是("punct") && 优先级[档].includes(看().value)) {
      const op = 进();
      const right = 解析二元(档 + 1);
      left = { kind: "Binary", op: op.value, left, right, line: op.line, column: op.column };
    }
    return left;
  }

  function 解析一元() {
    if (是标("!") || 是标("-")) {
      const op = 进();
      return { kind: "Unary", op: op.value, operand: 解析一元(), line: op.line, column: op.column };
    }
    return 解析后缀();
  }

  function 解析后缀() {
    let expr = 解析首项();
    for (;;) {
      if (是标("(")) {
        const 开 = 进();
        const args = [];
        while (!是标(")") && !是("eof")) {
          if (是("newline")) { 过空行(); continue; }
          args.push(解析表达式());
          if (是标(",")) 进(); else break;
        }
        要标(")", "关实参表");
        expr = { kind: "Call", callee: expr, args, line: 开.line, column: 开.column };
        continue;
      }
      if (是标(".")) {
        进();
        const 名 = (是("ident") || 是("keyword")) ? 进() : 要("ident", "字段名");
        // 位置上的一处怪处，照抄而不是改对：宿主给 Field 记的是字段名**之后**那个 token 的位子。
        // 照抄的理由是「两棵树一样」这句话要经得起逐节点核，而改对一处就等于把两棵树拆开。
        // 哪天要改，两边一起改，并且那一笔要写明它在改位置的含义。
        const 后 = 看();
        expr = { kind: "Field", target: expr, name: 名.value, line: 后.line, column: 后.column };
        continue;
      }
      if (是标("[")) {
        const 开 = 进();
        const index = 解析表达式();
        要标("]", "关下标");
        expr = { kind: "Index", target: expr, index, line: 开.line, column: 开.column };
        continue;
      }
      break;
    }
    return expr;
  }

  function 解析首项() {
    const t = 看();
    if (t.type === "int") { 进(); return { kind: "Literal", type: "int", value: Number(t.value), raw: t.value, line: t.line, column: t.column }; }
    if (t.type === "string") { 进(); return { kind: "Literal", type: "string", value: t.value, raw: false, line: t.line, column: t.column }; }
    if (是("keyword", "true") || 是("keyword", "false")) { 进(); return { kind: "Literal", type: "bool", value: t.value === "true", line: t.line, column: t.column }; }
    if (是("keyword", "nil")) { 进(); return { kind: "Literal", type: "nil", value: null, line: t.line, column: t.column }; }

    // If 与 While 在这一门语言里也是表达式（if 有值），于是它们出现在这里而不是语句那一层。
    if (是("keyword", "while")) {
      进();
      const condition = 解析表达式();
      const body = 是标("{") ? 解析块() : null;
      if (!body) throw new Error("子集的 while 必须有块（" + 在哪(t) + "）");
      return { kind: "While", condition, body, line: t.line, column: t.column };
    }
    if (是("keyword", "if")) {
      进();
      const condition = 解析表达式();
      const then = 是标("{") ? 解析块() : null;
      if (!then) throw new Error("子集的 if 必须有块（" + 在哪(t) + "）");
      let otherwise = null;
      if (是("keyword", "else")) {
        进();
        otherwise = 是("keyword", "if") ? 解析首项() : 解析块();
      }
      return { kind: "If", condition, then, otherwise, line: t.line, column: t.column };
    }
    if (是("keyword", "match")) throw new Error("子集不含 match（" + 在哪(t) + "）");

    // 记录与块都以 { 开头。分开它们的规则：字段是「名字 冒号」。
    if (是标("{") && ((看(1).type === "ident" || 看(1).type === "keyword") && 看(2).type === "punct" && 看(2).value === ":") ||
      (看(1).type === "newline" && 看(2).type === "ident" && 看(3).type === "punct" && 看(3).value === ":")) {
      const 开 = 进();
      const fields = [];
      过空行();
      while (!是标("}") && !是("eof")) {
        const 名 = (是("ident") || 是("keyword")) ? 进() : 要("ident", "字段名");
        要标(":", "字段名之后");
        const value = 解析表达式();
        fields.push({ name: 名.value, value });
        过空行();
        if (是标(",")) { 进(); 过空行(); } else break;
      }
      过空行();
      要标("}", "关记录");
      return { kind: "Record", fields, line: 开.line, column: 开.column };
    }
    if (是标("{")) return 解析块();

    if (是标("(")) {
      进();
      const items = [];
      let 尾逗号 = false;
      while (!是标(")") && !是("eof")) {
        items.push(解析表达式());
        if (是标(",")) { 进(); 尾逗号 = 是标(")"); } else break;
      }
      要标(")", "关括号");
      // (x) 是分组，(x,) 是一元组。少了后者，描述里放不进一串元组。
      return (items.length === 1 && !尾逗号) ? items[0] : { kind: "Tuple", items, line: t.line, column: t.column };
    }

    if (t.type === "ident") { 进(); return { kind: "Ident", name: t.value, line: t.line, column: t.column }; }

    throw new Error("期望一个表达式，见到 " + 说明(t) + "（" + 在哪(t) + "）");
  }

  const ast = 解析模块();
  return { ast };
};
