// 字节码：把 self/ 那六份的 AST 变成一串指令。
//
// 这一份是 SELFRUN 第三层的第一格。它不改「谁能跑」，改的是「执行模型」——
// 从「递归地走一棵树」换成「一条扁平的指令序列加一个循环」。那是把执行器搬到自己
// 机器层上的前提：一个循环能做的事，一台机器也能做；一棵树不能。
//
// 认的范围与 design/BOOTSTRAP.txt 第九节那张表一致：十一种表达式、五种语句。
// 表外的东西在这里报错，而不是猜。
//
// 槽分配（这一层最要紧的设计）
//
//   HMYR 的作用域是块 + 函数。而 self/ 那六份里所有函数都是顶层声明，没有嵌套函数——
//   于是**没有闭包**，作用域只可能是「函数帧上的槽」。这让分配变得简单：
//
//     参数占 0 到 n-1；每个 let/var 在它所在的块里分配一个新槽；
//     块结束之后那些槽不再被引用，但也不回收——一个函数帧的槽数取「同时活跃的最大值」。
//     遮蔽不特殊处理：内层的同名声明拿一个新槽，查找先看内层。
//
//   一个不许省的东西是「可变性」：let 声明的槽不可写、var 与参数里的 var 可写。
//   宿主那边这件事由作用域链在运行时判（R0150），这里同样在运行时判——编译期判会改变行为，
//   因为「改一个不可写的名字」是一条要报出来的错，而不是编译错误。
//
// 指令的形状
//
//   { op, a, b }：a 与 b 是可选的立即数。指令数组本身就是程序，跳转用绝对下标。
//   值都在一个操作数栈上。函数体各自是一段指令，函数名到入口下标的表在 program 里。
const 一元运算 = { "-": "NEG", "!": "NOT" };
const 二元运算 = {
  "+": "ADD", "-": "SUB", "*": "MUL", "/": "DIV", "%": "MOD",
  "==": "EQ", "!=": "NE", "<": "LT", "<=": "LE", ">": "GT", ">=": "GE",
};

// 编译器不认某个形状时抛这个。「这一份不认」是实现限制，不是程序错了 ——
// 所以它带的是内部那一条码（与「求值器遇到不认的节点种类」同一条），
// 而不是一个可以说「你写错了」的编号。露栈的样子比编号难读得多。
export class 编译错 extends Error {
  constructor(话, 码 = "HMYR-R0110") { super(话); this.code = 码; }
}

// ---- 返回类型：编译期核对 ----
//
// 为什么做在编译期而不是运行期：运行期要在每一帧的 RET 上多比一次，
// 而字节码里根本没有「返回类型」这个字段（函数表只记名字、参数量、槽数、效果、指令）。
// 把类型塞进文件格式是一次格式变更，而编译期检查不需要它 —— 声明就在 AST 上，
// 交回的值也在 AST 上，两边都是现成的。
//
// 能查的与查不了的，说清楚：
//   查得了   字面量、元组字面量、记录字面量、调用（查被调者的声明）、
//            算术与比较的结果、一元运算、正文字量
//   查不了   变量（let 推不出类型，而参数也没写进 AST 的形状里）、下标、字段
// 查不了的地方一律放过 —— 静态检查的价值在于「说了就一定对」，而不是「猜得多」。
const 数值类型名 = new Set(["Int", "Num", "Float", "Double", "Number", "UInt", "I64", "F64"]);

// 把类型节点化成一个好比较的形状。
const 类型形状 = (t) => {
  if (!t) return null;
  if (t.kind === "TupleType") return { k: "tuple", items: (t.items || []).map(类型形状) };
  // 记录类型：字段名与每个字段的形状。字段按名字对，不按顺序对 ——
  // 一个记录的意思不取决于字段写在前还是在后。
  if (t.kind === "RecordType") {
    return { k: "record", fields: (t.fields || []).map((f) => [f.name, 类型形状(f.type)]) };
  }
  if (t.kind === "FnType") return { k: "fn" };
  if (t.kind === "TypeRef") {
    if (数值类型名.has(t.name)) return { k: "num" };
    if (t.name === "String" || t.name === "Str") return { k: "str" };
    if (t.name === "Bool" || t.name === "Boolean") return { k: "bool" };
    if (t.name === "Unit" || t.name === "Void") return { k: "unit" };
    // 不认识的类型名：可能是一条 type 别名。不猜，放过。
    return { k: "?" };
  }
  return { k: "?" };
};

// 表达式的静态形状。查不了就是 { k: "?" }。
const 表达式形状 = (n) => {
  if (!n) return { k: "?" };
  switch (n.kind) {
    case "Literal":
      if (typeof n.value === "number") return { k: "num" };
      if (typeof n.value === "string") return { k: "str" };
      if (typeof n.value === "boolean") return { k: "bool" };
      if (n.value === null) return { k: "unit" };
      return { k: "?" };
    case "Tuple": return { k: "tuple", items: (n.items || []).map(表达式形状) };
    // 记录字面量：字段名与每个字段的形状。有了它，返回类型写成 {…} 时才能真的核对。
    case "Record": return { k: "record", fields: (n.fields || []).map((f) => [f.name, 表达式形状(f.value)]) };
    case "Binary": {
      const op = n.op;
      if (["==", "!=", "<", "<=", ">", ">=", "&&", "||"].includes(op)) return { k: "bool" };
      if (op === "+") {
        // 两边都是串才是串拼接；否则按数算。一边说不清就说不清。
        const l = 表达式形状(n.left), r = 表达式形状(n.right);
        if (l.k === "str" && r.k === "str") return { k: "str" };
        if (l.k === "num" && r.k === "num") return { k: "num" };
        return { k: "?" };
      }
      if (["-", "*", "/", "%"].includes(op)) return { k: "num" };
      return { k: "?" };
    }
    case "Unary": return n.op === "!" ? { k: "bool" } : { k: "num" };
    // 调用：形状由「被调者的声明」回答，而回答它的是外面的 形状带调用。
    // 这里交回「说不清」而不是 null —— null 会在 + 的两边当成值用，然后炸在那个地方，
    // 而一个好的检查器不该因为自己不认识的节点而炸。
    case "Call": return { k: "?" };
    default: return { k: "?" };
  }
};

const 形状名 = (s) => {
  if (!s) return "?";
  if (s.k === "tuple") return "(" + (s.items || []).map(形状名).join(", ") + ")";
  if (s.k === "record") return "{" + (s.fields || []).map(([n, t]) => n + ": " + 形状名(t)).join(", ") + "}";
  if (s.k === "num") return "Int";
  if (s.k === "str") return "String";
  if (s.k === "bool") return "Bool";
  if (s.k === "unit") return "Unit";
  if (s.k === "record") return "记录";
  if (s.k === "fn") return "fn";
  return "?";
};

// 一个形状合不合一个类型。交回 null 表示合，否则交回一句「不合在哪」。
const 核对 = (类型, 形, 深度 = 0) => {
  if (!类型 || !形 || 形.k === "?" || 类型.k === "?") return null;   // 说不清就放过
  if (类型.k !== 形.k) {
    return "交回的是 " + 形状名(形);
  }
  if (类型.k === "tuple") {
    const 甲 = 类型.items || [], 乙 = 形.items || [];
    if (甲.length !== 乙.length) {
      return "交回 " + 乙.length + " 个元素，声明的是 " + 甲.length + " 个";
    }
    for (let i = 0; i < 甲.length; i++) {
      const 内 = 核对(甲[i], 乙[i], 深度 + 1);
      if (内) return "第 " + (i + 1) + " 个元素：" + 内;
    }
  }
  if (类型.k === "record") {
    // 记录按字段名对：声明里有、交回的没有，或者反过来，都要说；
    // 名字都对上之后再看每个字段的形状。
    const 声 = new Map(类型.fields || []);
    const 交 = new Map(形.fields || []);
    for (const [名] of 声) if (!交.has(名)) return "交回的记录里没有字段 " + 名;
    for (const [名] of 交) if (!声.has(名)) return "交回的记录多出字段 " + 名;
    for (const [名, 子] of 声) {
      const 内 = 核对(子, 交.get(名), 深度 + 1);
      if (内) return "字段 " + 名 + "：" + 内;
    }
  }
  return null;
};

// 在函数体里找所有 return 语句（不进嵌套的函数声明 —— 这门语言也没有）。
const 收集返回 = (node, acc) => {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node)) { for (const x of node) 收集返回(x, acc); return acc; }
  if (node.kind === "Return") acc.push(node);
  for (const k of Object.keys(node)) {
    if (k === "line" || k === "column") continue;
    const v = node[k];
    if (v && typeof v === "object") 收集返回(v, acc);
  }
  return acc;
};

// 对一份声明表核对每个函数的返回类型。
// 交回问题列表（空的表示都对）。
export const 核对返回类型 = (声明们) => {
  const 声明表 = new Map();
  for (const d of 声明们) if (d.kind === "Fn") 声明表.set(d.name, d);
  const 问题们 = [];
  const 查调用形状 = (n) => {
    const 被 = 声明表.get(n.callee && n.callee.name);
    if (!被) return { k: "?" };
    return 类型形状(被.returns);
  };
  const 形状带调用 = (n) => {
    if (n && n.kind === "Call") return 查调用形状(n);
    // 表达式里套着调用时，只对最外层判断 —— 深一层不去追，免得把「说不清」说成「不合」。
    return 表达式形状(n);
  };
  for (const d of 声明们) {
    if (d.kind !== "Fn" || !d.returns || !d.body) continue;
    const 类型 = 类型形状(d.returns);
    if (!类型 || 类型.k === "?") continue;
    for (const 返 of 收集返回(d.body, [])) {
      const 形 = 形状带调用(返.value);
      const 不合 = 核对(类型, 形);
      if (不合) {
        问题们.push({
          名: d.name,
          行: 返.line,
          话: "函数 " + d.name + " 声明返回 " + 形状名(类型) + "，" + 不合,
        });      }
    }
  }
  return 问题们;
};

// 一个函数编译出来的东西：指令、槽数、名字、参数个数、声明效果。
const 编译函数 = (decl) => {
  const 码 = [];
  // 作用域栈：每层是 name -> { 槽, 可写 }
  let 层们 = [new Map()];
  let 槽数 = 0;
  const 分配 = (名, 可写) => {
    const 槽 = 槽数++;
    层们[层们.length - 1].set(名, { 槽, 可写 });
    // 槽号与名字的对照默认不留 —— 但查「R0150 的槽 38 是谁」时它是唯一的路。
    // 打开方式：HMYR_SLOTS=1，输出走 stderr，不碰产物。
    if (process.env.HMYR_SLOTS) {
      process.stderr.write("槽 " + 槽 + " ← " + 名 + (可写 ? "（var）" : "（let）") + " · " + (decl.name || "?") + "\n");
    }
    return 槽;
  };
  const 查 = (名) => {
    for (let i = 层们.length - 1; i >= 0; i--) {
      const 有 = 层们[i].get(名);
      if (有) return 有;
    }
    return null;
  };
  const 进层 = () => 层们.push(new Map());
  const 出层 = () => 层们.pop();
  const 发 = (op, a, b) => { 码.push({ op, a, b }); return 码.length - 1; };

  for (const p of decl.params || []) 分配(p.name, true);   // 参数在宿主那边也是可写的槽

  // ---- 表达式：结果留在栈顶 ----
  const 表达 = (n) => {
    switch (n.kind) {
      case "Literal": 发("CONST", n.value); return;
      case "Ident": {
        const 有 = 查(n.name);
        if (!有) 发("GLOBAL", n.name);          // 顶层常量之类，交给运行时的全局表
        else 发("LOAD", 有.槽);
        return;
      }
      case "Unary":
        表达(n.operand);
        发(一元运算[n.op] || (() => { throw new 编译错("不认的一元运算：" + n.op); })());
        return;
      case "Binary": {
        // 短路：&& 与 || 要跳，不能先算右边。
        if (n.op === "&&" || n.op === "||") {
          表达(n.left);
          const 跳 = 发(n.op === "&&" ? "JMPF_KEEP" : "JMPT_KEEP", -1);
          表达(n.right);
          发("BOOL");
          const 完 = 发("JMP", -1);
          码[跳].a = 码.length;
          发("BOOL");
          码[完].a = 码.length;
          return;
        }
        表达(n.left);
        表达(n.right);
        发(二元运算[n.op] || (() => { throw new 编译错("不认的二元运算：" + n.op); })());
        return;
      }
      case "Tuple": {
        for (const 项 of n.items) 表达(项);
        发("TUPLE", n.items.length);
        return;
      }
      case "Record": {
        for (const f of n.fields) { 表达(f.value); }
        发("RECORD", n.fields.map((f) => f.name));
        return;
      }
      case "Field": 表达(n.target); 发("FIELD", n.name); return;
      case "Index": 表达(n.target); 表达(n.index); 发("INDEX"); return;
      case "Call": {
        if (n.callee.kind !== "Ident") throw new 编译错("只认按名字调用：self/ 里没有别的写法");
        for (const a of n.args) 表达(a);
        if (内置名.has(n.callee.name)) 发("CALLB", n.callee.name, n.args.length);
        else 发("CALLF", n.callee.name, n.args.length);
        return;
      }
      case "If": {
        // 形状：条件 → JMPF 假 → then 的值 → JMP 完 → 假: otherwise 的值 → 完:
        // 「没有 otherwise」时把 CONST null 放在假分支上，而不是放在 then 之后——
        // 放在 then 之后会让两个分支各留一个值，栈就错位了。
        表达(n.condition);
        const 假 = 发("JMPF", -1);
        if (n.then) { 进层(); 语句们(n.then.statements, true); 出层(); } else 发("CONST", null);
        const 完 = 发("JMP", -1);
        码[假].a = 码.length;
        if (n.otherwise) {
          if (n.otherwise.kind === "Block") { 进层(); 语句们(n.otherwise.statements, true); 出层(); }
          else 表达(n.otherwise);
        } else {
          发("CONST", null);
        }
        码[完].a = 码.length;
        return;
      }
      case "While": {
        const 头 = 码.length;
        表达(n.condition);
        const 出 = 发("JMPF", -1);
        if (n.body) { 进层(); 语句们(n.body.statements, false); 出层(); }
        发("JMP", 头);
        码[出].a = 码.length;
        发("CONST", null);        // while 的值是 null，与宿主一致
        return;
      }
      default:
        throw new 编译错("这一份不认这种表达式：" + n.kind);
    }
  };

  // ---- 语句：默认不往栈上留东西；留值 = true 时，最后一条表达式语句的值留在栈上 ----
  //
  // 「块作为表达式」是这门语言的一个真实形状：if 与 while 有值，于是它们的分支块
  // 也得交出一个值。而块的值就是它最后一条语句的值——宿主那边由 execBlock 返回 last，
  // 这里靠「最后一条表达式语句不 POP」来表示。
  const 语句 = (s, 留值) => {
    switch (s.kind) {
      case "Let": case "Var": {
        表达(s.value);
        const 槽 = 分配(s.name, s.kind === "Var");
        // 可变性放在指令上：执行时 STORE 把它记进槽，ASSIGN 读它。
        // 宿主那边这件事由作用域链在运行时判（R0150），这里同样在运行时判。
        发("STORE", 槽, s.kind === "Var");
        return;
      }
      case "Assign": {
        const 有 = 查(s.name);
        if (!有) throw new 编译错("赋给一个不在作用域里的名字：" + s.name);
        表达(s.value);
        发("ASSIGN", 有.槽);
        return;
      }
      case "Return": {
        if (s.value) 表达(s.value); else 发("CONST", null);
        发("RET");
        return;
      }
      case "ExprStmt":
        表达(s.expr);
        if (!留值) 发("POP");
        return;
      default:
        throw new 编译错("这一份不认这种语句：" + s.kind);
    }
  };
  const 语句们 = (列, 留值) => {
    for (let i = 0; i < 列.length; i++) 语句(列[i], !!留值 && i === 列.length - 1);
  };

  语句们((decl.body && decl.body.statements) || []);
  发("CONST", null);
  发("RET");
  return { 名: decl.name, 码, 槽数, 参数量: (decl.params || []).length, 效果: decl.effects || [] };
};

// 内置的名字：编译期就要知道「这是内置还是用户函数」。
// 这一份表与 src/minimal-eval.mjs 里那张一致——两张表不一致时，行为会分叉。
// 分叉的样子是 R0104「没有这个内置」：名字在表里缺一个，编译器就把它当用户函数去查，
// 而用户函数表里也没有它。加内置时要四处一起加：最小求值器、字节码内置表、这一张、
// 还有自举层 self/eval.hmyr 的调用分派。
const 内置名 = new Set(["abs", "arena", "argv", "chdir", "chr", "console_codepage", "cwd", "field_get", "field_has",
  "field_names", "file_exists", "floor", "home_dir", "int", "is_dir", "is_letter", "is_mark", "key_available", "key_push",
  "key_read", "key_start", "len", "locale_current", "locale_env", "locale_set", "max", "min", "nfc", "now_ms",
  "ord", "print", "print_err", "python_path", "read_bytes", "read_dir", "read_stdin_bytes", "read_stdin_line", "read_text",
  "record_new", "repo_path", "run_program", "slice", "sleep_ms", "split", "str", "temp_path", "term_clear",
  "term_color", "term_escape", "term_hide", "term_show", "term_size", "thr_cancel", "thr_count", "thr_join",
  "thr_spawn", "to_int", "to_lower", "to_upper", "write_text", "write_bytes", "bytes_to_text", "f64_bytes",
  "index_new", "index_set", "index_get", "index_has", "index_len", "index_keys",
  "pack_value", "read_line", "read_lines", "校验和", "数组", "设", "位与", "位或", "位异或", "位非", "位右移", "位加", "位循环右移", "位循环左移"]);

// 模块 → 一个程序：函数表 + 全局常量表 + 顶层指令（用来登记常量）。
export const 编译模块 = (ast) => {
  const 函数们 = new Map();   // 名 -> 编译结果
  const 全局们 = [];          // 常量声明（Const）
  for (const decl of ast.decls) {
    if (decl.kind === "Fn") 函数们.set(decl.name, 编译函数(decl));
    else if (decl.kind === "Const") 全局们.push(decl);
    else throw new 编译错("这一份只认 fn 与 const 声明：" + decl.kind);
  }
  // 多份模块合成一个程序时，一个名字只能有一段代码——重名在加载器那边已经警告过，
  // 这里不覆盖：先到的那一份赢，与「后到的覆盖」相反，所以要说清。
  return { 函数们, 全局们 };
};

// 把几份模块合起来：函数表并集，全局常量并集。重名保留先到的。
//
// 第二个参数是「入口那一份」：给了它，它自己的 main 覆盖别人那一份。
// 为什么这条规矩放在这一层而不是让每个调用者各抄一遍：import 的顺序是依赖在前，
// 于是 self/lex.hmyr 的自测 main 会先到，而「先到者赢」会让入口的 main 输掉。
// 症状是「跑起来没输出、退出码是某个自测数出来的值」—— 那种错最难猜。
export const 合并程序 = (几份, 入口) => {
  const 函数们 = new Map();
  const 全局们 = [];
  for (const 一份 of 几份) {
    for (const [名, 函] of 一份.函数们) if (!函数们.has(名)) 函数们.set(名, 函);
    全局们.push(...一份.全局们);
  }
  if (入口) {
    const 入口函 = 入口.函数们.get("main");
    if (入口函) 函数们.set("main", 入口函);
  }
  return { 函数们, 全局们 };
};
