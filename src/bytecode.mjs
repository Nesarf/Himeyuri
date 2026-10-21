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

export class 编译错 extends Error {}

// 一个函数编译出来的东西：指令、槽数、名字、参数个数、声明效果。
const 编译函数 = (decl) => {
  const 码 = [];
  // 作用域栈：每层是 name -> { 槽, 可写 }
  let 层们 = [new Map()];
  let 槽数 = 0;
  const 分配 = (名, 可写) => {
    const 槽 = 槽数++;
    层们[层们.length - 1].set(名, { 槽, 可写 });
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
const 内置名 = new Set(["argv", "chr", "field_get", "field_has", "field_names", "file_exists", "is_letter", "is_mark",
  "len", "nfc", "ord", "print", "print_err", "read_text", "record_new", "slice", "str",
  "to_int", "to_lower", "to_upper"]);

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
export const 合并程序 = (几份) => {
  const 函数们 = new Map();
  const 全局们 = [];
  for (const 一份 of 几份) {
    for (const [名, 函] of 一份.函数们) if (!函数们.has(名)) 函数们.set(名, 函);
    全局们.push(...一份.全局们);
  }
  return { 函数们, 全局们 };
};
