// 子集 parser：Stage 0 的第二层。token 进，树出。
//
// 现状：两件事都对上了（2026-10-20）——树，六份共 9379 个节点，逐个相同（形状与位置）；
// 以及错误路径上的话（与宿主同一批码、同一个位置）。
//
// 它的立场是认得窄而说清：遇到不认的构造就报出来，而不是猜一个树。
// 一个猜出来的树会在后面某一层变成算错的数，而那时已经看不出源头。
//
// 它认的是 self/ 那六份源码用到的构造，别的都报错。那份普查是数出来的，不是照语法书抄的：
//   声明   只有 fn，151 个；没有 type / const / effect / pub，没有类型参数，没有 requires/ensures
//   参数   321 个，全部带类型，没有默认值，没有 own/borrow
//   类型   只有三种：Int 238、String 79、Bool 4，全是单名
//   语句   六种：let / var / assign / return / ExprStmt / Block
//   表达式 十一种：Literal · Ident · Binary · Unary · Call · Index · Field · Tuple · Record · If · While
//   运算符 十四种，五档优先级（与 src/parser.mjs 的 PRECEDENCE 同一张表）
//
// 错误分两种，而它们该被分开对待：
//
//   语法错      宿主也会报的。这里报同一批码（E0101 到 E0105），位置也照宿主的取法，
//               并且照宿主的办法恢复：报一次，然后跳到下一个能开始语句的地方。
//               恢复是必要的——没有它，一个错会变成一串连锁的错误，而读的人找不到第一个。
//   本子集不认  宿主读得动、而这一份还不认的构造（type / const / effect / pub / match /
//               泛型 / 可空 / 参数默认值 / own / 带参数的效果 / 无体函数）。
//               这一类**抛**，不是记诊断：它是这一份的边界，而边界要大声说，不然会被当成语法错。
//
// options.strict 为真时，连语法错也抛。那是给「只想问一句这棵树对不对」的调用方用的，
// 而套件用它来钉住「不认的构造一定抛」这件事。
//
// 消息用中文，码用与宿主相同的英文编号。两样都写清：读码的人与读消息的人不是同一个人。
// 验收只比码与位置，不比消息文本——措辞可以不同，而码是给人查的。
const 优先级 = [
  ["||"],
  ["&&"],
  ["==", "!=", "<", "<=", ">", ">="],
  ["+", "-"],
  ["*", "/", "%"],
];

// 切词器在末尾产一个 eof token，于是「没有 token 了」这件事有位置可指。
// 万一调用方递进来的 token 表里没有它（手工拼的表，或别的切词器），退回一个不带位置的尾——
// 少了位置比编一个位置好。
const 尾 = (tokens) => (tokens.length && tokens[tokens.length - 1].type === "eof"
  ? tokens[tokens.length - 1]
  : { type: "eof", value: "", line: 0, column: 0 });

// 与 src/lexer.mjs 的 Diagnostics 同构的一小份：调用方可以把宿主的那个递进来，也可以不递。
const 新诊断 = () => ({
  items: [], errors: [], warnings: [],
  add(severity, code, message, line, column) {
    const one = { severity, code, message, line, column };
    this.items.push(one);
    if (severity === "error") this.errors.push(one);
    if (severity === "warning") this.warnings.push(one);
  },
  error(code, message, line, column) { this.add("error", code, message, line, column); },
  warn(code, message, line, column) { this.add("warning", code, message, line, column); },
});

export const 子集解 = (tokens, options = {}) => {
  const diagnostics = options.diagnostics || 新诊断();
  const 严 = options.strict === true;
  let i = 0;
  // 一个不前进的 parser 是它自己的错，不是输入的错。与其转到内存耗尽，不如数步数并说出来。
  let steps = 0;
  const 步限 = 200000;

  const 文件尾 = 尾(tokens);
  // 子集切词器不产 eof 之外的虚拟 token；越界就交回文件尾那个。
  const 看 = (n = 0) => tokens[i + n] || 文件尾;
  const 是 = (type, value) => { const t = 看(); return t.type === type && (value === undefined || t.value === value); };
  const 是标 = (v) => 是("punct", v);
  const 进 = () => tokens[i++];
  const 说明 = (t) => t.type === "eof" ? "文件尾" : (t.type + " " + JSON.stringify(t.value));
  const 在哪 = (t) => "行 " + t.line + " 列 " + t.column;

  // 报一个语法错。位置取当前 token 的——宿主也一样（它的 error 就是这么取的）。
  const 报 = (code, 话, at) => {
    const t = at || 看();
    if (严) throw new Error(code + " " + 话 + "（" + 在哪(t) + "）");
    diagnostics.error(code, 话, t.line, t.column);
  };
  // 报一条「本子集不认」的错。这一类总是抛：它是边界，不是语法错。
  const 不认 = (话, at) => {
    const t = at || 看();
    throw new Error(话 + "（" + 在哪(t) + "）");
  };

  // 照宿主的 recover：报一次，然后从能开始一个语句的地方继续。
  // 「停在 } 上就返回」是错的——那会让调用方停在同一个 token 上，一个多余的括号能生出成百条同样的错。
  const 恢复 = () => {
    while (!是("eof")) {
      if (是("newline")) { 过空行(); return; }
      if (是标("}")) { 进(); return; }
      进();
    }
  };

  const 要标 = (v, 什么) => {
    if (是标(v)) return 进();
    报("HMYR-E0101", "期望 " + JSON.stringify(v) + (什么 ? "（" + 什么 + "）" : "") + "，见到 " + 说明(看()));
    return null;
  };
  const 要 = (type, 什么) => {
    if (是(type)) return 进();
    报("HMYR-E0101", "期望 " + (什么 || type) + "，见到 " + 说明(看()));
    return null;
  };
  // 换行只在语句边界有意义，表达式里一律跳过。
  const 过空行 = () => { while (是("newline")) 进(); };
  const 收句 = () => {
    if (是("newline")) { 过空行(); return; }
    if (是标("}") || 是("eof")) return;
    报("HMYR-E0102", "期望语句结束，见到 " + 说明(看()));
    恢复();
  };

  function 解析模块() {
    const imports = [], decls = [];
    过空行();
    // rev N 写在模块顶上：这个模块提供的接口是第 N 版。
    // 它只影响协商，不影响这个模块自己能做什么 —— 与 src/parser.mjs 同一条规矩。
    let rev = null;
    if (是("ident", "rev")) {
      进();
      const n = 要版本号();
      rev = n ? Number(n.value) : null;
      收句();
      过空行();
    }
    while (是("keyword", "import")) imports.push(解析导入());
    过空行();
    while (!是("eof")) {
      if (++steps > 步限) { 报("HMYR-E0105", "parser 在这一步停住了：" + 说明(看())); break; }
      const 先 = i;
      const decl = 解析声明();
      if (decl) decls.push(decl);
      if (i === 先) 恢复();
      过空行();
    }
    return { kind: "Module", imports, decls, rev };
  }

  // 版本号只认整数：int 就是它。写成 2.5 之类的不该被当成一个版本。
  function 要版本号() {
    if (是("int")) return 进();
    return 要("int", "版本号");
  }

  function 解析导入() {
    const kw = 进();
    const 路 = 要("string", "模块路径");
    let alias = null;
    if (是("keyword", "as")) { 进(); alias = 要("ident", "别名"); }
    // rev N：调用方要这个模块的第 N 版接口。不写就是不提要求。
    let rev = null;
    if (是("ident", "rev")) {
      进();
      const n = 要版本号();
      rev = n ? Number(n.value) : null;
    }
    收句();
    return { kind: "Import", path: 路 ? 路.value : "", alias: alias ? alias.value : null, rev, line: kw.line, column: kw.column };
  }

  function 解析声明() {
    if (是("keyword", "fn")) return 解析函数();
    // 这几样宿主读得动，而这一份还不认——边界，抛。
    if (是("keyword", "type") || 是("keyword", "const") || 是("keyword", "effect") || 是("keyword", "pub")) {
      不认("子集只认 fn 声明，见到 " + 说明(看()));
    }
    // 而这些宿主也报「不能以它开始一个声明」，于是报同一个码。
    报("HMYR-E0103", "不能以 " + 说明(看()) + " 开始一个声明");
    恢复();
    return null;
  }

  function 解析函数() {
    const kw = 进();
    const 名 = 要("ident", "函数名");
    if (是标("<")) 不认("子集不含类型参数");
    要标("(", "开参数表");
    const params = 是标(")") ? [] : 解析参数们();
    要标(")", "关参数表");
    let returns = null;
    if (是标("->")) { 进(); returns = 解析类型(); }
    let effects = null;
    if (是("keyword", "effects")) effects = 解析效果们();
    if (!是标("{")) 不认("子集的函数必须有函数体：" + (名 ? 名.value : "?"));
    const body = 解析块();
    return { kind: "Fn", name: 名 ? 名.value : "<error>", typeParams: [], params, returns, effects, contracts: { requires: [], ensures: [] }, body, pub: false, line: kw.line, column: kw.column };
  }

  function 解析参数们() {
    const list = [];
    while (!是标(")") && !是("eof")) {
      if (是("keyword", "own") || 是("keyword", "borrow")) 不认("子集不含 own/borrow 参数");
      const 名 = 要("ident", "参数名");
      要标(":", "参数名之后");
      const type = 解析类型();
      if (是标("=")) 不认("子集不含参数默认值");
      if (名) list.push({ name: 名.value, type, passing: null, fallback: null, line: 名.line, column: 名.column });
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
      else { 报("HMYR-E0101", "期望效果名，见到 " + 说明(看())); break; }
      // 检查点要在这儿：名字之后紧跟括号就是带参数的效果，而那种形式这一份还不认。
      if (是标("(")) 不认("子集不含带参数的效果");
      if (是标(",")) 进(); else break;
    }
    要标(")", "关效果表");
    return list;
  }

  // 六份里只用过单名的 TypeRef —— 后来多了元组类型，因为「声明几个元素、交回几个元素」
  // 这件事要能写下来（design/LIB.txt 把它记成变长元组那条缺口）。
  // 一个元素的括号仍是分组，不是一元组 —— 与 chain.hmyr 那条一样的规矩。
  function 解析类型() {
    const t = 看();
    // 记录类型：{字段: 类型, …}。有了它，那些「返回一个记录」的函数才写得下返回类型 ——
    // 而这件事正是 design/LIB.txt 记的「变长元组与类型检查」两条的共同缺口。
    if (是标("{")) {
      进();
      const fields = [];
      while (!是标("}") && !是("eof")) {
        const 名 = 要("ident", "字段名");
        要标(":", "字段名之后");
        fields.push({ name: 名 ? 名.value : "<error>", type: 解析类型() });
        过空行();
        if (是标(",")) { 进(); 过空行(); } else break;
      }
      要标("}", "关记录类型");
      return { kind: "RecordType", fields, line: t.line, column: t.column };
    }
    if (是标("(")) {
      进();
      const items = [];
      while (!是标(")") && !是("eof")) {
        items.push(解析类型());
        if (是标(",")) 进(); else break;
      }
      要标(")", "关元组类型");
      return items.length === 1 ? items[0] : { kind: "TupleType", items, line: t.line, column: t.column };
    }
    if (是("keyword", "fn")) 不认("子集不含函数类型");
    const 名 = 要("ident", "类型名");
    if (是标("<")) 不认("子集不含泛型类型");
    if (是标("?")) 不认("子集不含可空类型");
    return { kind: "TypeRef", name: 名 ? 名.value : "<error>", args: [], nullable: false, line: t.line, column: t.column };
  }

  function 解析块() {
    const 开 = 要标("{", "开块");
    const statements = [];
    过空行();
    while (!是标("}") && !是("eof")) {
      if (++steps > 步限) { 报("HMYR-E0105", "parser 在这一步停住了：" + 说明(看())); break; }
      const 先 = i;
      const stmt = 解析语句();
      if (stmt) statements.push(stmt);
      if (i === 先) 恢复();
      过空行();
    }
    要标("}", "关块");
    return { kind: "Block", statements, line: 开 ? 开.line : 看().line };
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
      if (是标(":")) 不认("子集不含带类型的 let/var");
      要标("=", "赋值号");
      const value = 解析表达式();
      收句();
      return { kind: kw.value === "let" ? "Let" : "Var", name: 名 ? 名.value : "<error>", type: null, value, line: kw.line, column: kw.column };
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
        // 位置上的一处怪处，照抄而不是改对：宿主给 Field 记的是字段名之后那个 token 的位子。
        // 照抄的理由是「两棵树一样」这句话要经得起逐节点核，而改对一处就等于把两棵树拆开。
        const 后 = 看();
        expr = { kind: "Field", target: expr, name: 名 ? 名.value : "<error>", line: 后.line, column: 后.column };
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
    if (t.type === "int" || t.type === "float") { 进(); return { kind: "Literal", type: t.type, value: t.numeric !== undefined ? t.numeric : t.value, raw: t.value, line: t.line, column: t.column }; }
    if (t.type === "string") { 进(); return { kind: "Literal", type: "string", value: t.value, raw: false, line: t.line, column: t.column }; }
    if (是("keyword", "true") || 是("keyword", "false")) { 进(); return { kind: "Literal", type: "bool", value: t.value === "true", line: t.line, column: t.column }; }
    if (是("keyword", "nil")) { 进(); return { kind: "Literal", type: "nil", value: null, line: t.line, column: t.column }; }

    // If 与 While 在这一门语言里也是表达式（if 有值），于是它们出现在这里而不是语句那一层。
    if (是("keyword", "while")) {
      进();
      const condition = 解析表达式();
      if (!是标("{")) 不认("子集的 while 必须有块", t);
      const body = 解析块();
      return { kind: "While", condition, body, line: t.line, column: t.column };
    }
    if (是("keyword", "if")) {
      进();
      const condition = 解析表达式();
      if (!是标("{")) 不认("子集的 if 必须有块", t);
      const then = 解析块();
      let otherwise = null;
      if (是("keyword", "else")) {
        进();
        otherwise = 是("keyword", "if") ? 解析首项() : 解析块();
      }
      return { kind: "If", condition, then, otherwise, line: t.line, column: t.column };
    }
    if (是("keyword", "match")) 不认("子集不含 match", t);

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
        if (名) fields.push({ name: 名.value, value });
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

    报("HMYR-E0104", "期望一个表达式，见到 " + 说明(t), t);
    // 恢复：照宿主——吃掉这个 token，再跳到下一个能开始语句的地方。少这一步，一个缺表达式
    // 会引出第二条（收句）、第三条（外层），而那正是恢复要防的连锁。
    进();
    while (!是("eof") && !是("newline") && !是标("}") && !是标(")") && !是标(",")) 进();
    return { kind: "Error", line: t.line, column: t.column };
  }

  const ast = 解析模块();
  return { ast, diagnostics };
};
