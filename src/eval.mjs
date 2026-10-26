// Himeyuri evaluator - milestone M2, third piece. A tree-walking interpreter, so the language can
// actually run and the specification's M2 acceptance ("twenty example programs run") has somewhere to
// land.
//
// What is implemented here is what the grammar and the specification already fix: literals, arithmetic
// and comparison, let and var, blocks, if and match as expressions, functions with parameters and
// defaults, recursion, return, and a small set of builtins.
//
// Two things are deliberately NOT claimed:
//   - the zone model of design/MEMORY.txt is not implemented. arena() is a host stub that allocates
//     from a list and frees it on close, so the specification's own example runs. A stub is marked as
//     one rather than presented as the model.
//   - assignment is not in the grammar yet, so a var cannot be reassigned. Recorded as [议] in the
//     spec, not hidden here.
//
// Effect checking follows SPEC 2.4: a function may only call what its own declared effects allow.
// Runtime diagnostics use an R range, which the spec does not yet define - marked [议] as well.
import { 本机能力 } from "./capabilities.mjs";
import { 藏路径, 在用脱敏 } from "./redact.mjs";
import { lex } from "./lexer.mjs";
import { parse } from "./parser.mjs";
import {
  有序, 下整,
  加 as 数加, 减 as 数减, 乘 as 数乘, 除 as 数除, 余 as 数余, 比 as 数比, 是零 as 数零,
} from "./numbers.mjs";
import { 展开模块 } from "./expand.mjs";

// 尾调用的标记：函数体最后一件事是调用另一个函数时，抛它而不是真的压栈。
//
// 为什么要它：一层函数调用在宿主那边要过好几帧栈，于是递归只能到九百多层。
// 而尾递归（f(n, acc) = f(n-1, ...) 这种）本来不需要保留任何东西——
// 于是那种形状可以跑到任意深，而不必换掉整个求值器。
// 这里故意不继承 Error：尾调用是被当作控制流用的，一秒能发生几十万次，
// 而 new Error 的代价几乎全在抓栈上（实测 codeseval 那一套 148 秒里有 104 秒
// 花在这个构造函数里）。instanceof 判断照旧有效，栈本来也没人看。
class TailCall {
  // 带着抛出处的效果集：效果检查是「被调者不能比调用者多」，
  // 而换函数之后「调用者」就变了——那个集合必须跟着换，否则尾调用会变成一条绕过检查的路。
  constructor(decl, args, fromEffects) { this.decl = decl; this.args = args; this.fromEffects = fromEffects; }
}

class Return extends Error { constructor(value) { super("return"); this.value = value; } }

// Stage 0 只要求这么多：跑 self/ 那六份时真正被走到的节点与内置。
// 这张表是量出来的（test/stage0-eval.test.mjs 跑六条真实路径统计），不是设计出来的。
//
// 它拦的不是「用户程序的错」，而是「这一份求值器被要求做超出契约的事」——
// 所以拦下来是抛普通错误，不是记诊断：一个用户写错程序，该拿到带编号的诊断；
// 而一个不该出现的节点跑进来，说明契约与实现有一边错了，那时要的是栈，不是一条诊断。
// 一个名字算不算内置。
//
// 它存在的理由是有一处行为需要被说清：evalCall 先查内置，于是同名的用户函数调用不到。
// self/run.hmyr 里自己定义了 slice，而真正执行的是宿主那个内置——那看起来像 bug，
// 其实是一条刻意的规矩（内置优先，于是 print 这类名字不会被变量遮蔽）。
// 想让「谁被调到了」可问，就得有一个能回答「这个名字算不算内置」的地方。
//
// 只卖一个布尔，不卖整张表：表是实现的细节，而「这个名字算不算内置」是可问的事实。
export const isBuiltin = (name) => Object.prototype.hasOwnProperty.call(BUILTINS, name);

const STAGE0_EXPR = new Set(["Binary", "Call", "Field", "Ident", "If", "Index", "Literal", "Record", "Tuple", "Unary", "While"]);
const STAGE0_STMT = new Set(["Assign", "ExprStmt", "Let", "Return", "Var"]);
// 跑 self/ 那六份真正需要的内置。stage0 模式下只放这几个过去。
// field_names 不在这一张里：自举层现在还不用它，而这张表的意思是「已经量过的必须项」，
// 多写一个就把闸门放宽了一格。
//
// index 那四个是 2026-10-27 量出来的：区的记账要用可变容器，而记录不可变，
// 所以 self/eval 的区用索引表示（index_new / set / get / has —— 只用得到这四个，
// index_len 与 index_keys 自举层没有用，所以不进这张表）。
const STAGE0_BUILTIN = new Set(["argv", "chr", "field_get", "field_has", "file_exists", "f64_bytes", "index_get", "index_has", "index_new", "index_set", "is_dir", "is_letter", "is_mark", "len", "nfc", "ord", "pack_value", "print", "print_err", "read_dir", "read_line", "read_lines", "read_text", "record_new", "slice", "str", "to_int", "write_bytes"]);

export class Runtime {
  constructor(options = {}) {
    this.functions = new Map();
    this.globals = new Map();
    this.output = [];
    this.write = options.write || ((line) => this.output.push(line));
    this.steps = 0;
    this.depth = 0;
    // stage0：只允许上面那三张表里的东西。它存在的理由是让「需求表」可执行——
    // 一份写着「只需要这些」的文档只能被人读完点头，而一个会拦下来的求值器能证明它。
    this.stage0 = options.stage0 === true;
    // Each Himeyuri call costs several host frames (evalExpr, evalCall, callFunction, execBlock,
    // execStatement...), so the language's depth limit has to sit below what the host can take,
    // otherwise the host stack goes first and the user sees a host crash instead of a diagnostic.
    this.maxDepth = options.maxDepth || 500;
    this.stepLimit = options.stepLimit || 5_000_000;
    this.errors = [];
    // 能力内核：文件、进程、时间这些「借世界」的事都从这里走，而这一层之外不自己 import 它们。
    // 默认给本机那一份；套件可以换一份记账的，于是「这一趟借了什么」变成一份能打印的清单。
    // 内部资源（编码表、worker 脚本）不走这里——那是程序自己的数据，不是世界的接口。
    this.cap = options.capabilities || 本机能力();
  }

  fail(code, message) {
    const e = new Error(message);
    e.code = code;
    throw e;
  }

  // Register what a module declares, without demanding an entry point. A library file has no main, and
  // pretending it must have one made the loader fail on its own fixtures.
  registerModule(ast) {
    for (const decl of ast.decls) {
      if (decl.kind === "Fn") this.functions.set(decl.name, decl);
      else if (decl.kind === "Const") this.globals.set(decl.name, this.evalExpr(decl.value, new Scope(null)));
    }
  }

  run(ast) {
    for (const decl of ast.decls) {
      if (decl.kind === "Fn") this.functions.set(decl.name, decl);
      else if (decl.kind === "Const") this.globals.set(decl.name, this.evalExpr(decl.value, new Scope(null)));
    }
    const main = this.functions.get("main");
    if (!main) this.fail("HMYR-R0100", "no main function to run");
    // The entry point declares nothing, which means it may do nothing effectful (SPEC 2.4: no
    // hidden network). Passing a label here instead of a set was a bug: the check then read the
    // label as a set of permitted effects.
    // The entry point is the boundary, not a caller: there is no enclosing declaration for it to
    // exceed, so nothing is checked against it. What main itself declares is granted by the host.
    // (A function whose body does not declare an effect is a different matter: see allowed().)
    return this.callFunction(main, [], null);
  }

  // ---- effects: a callee may not do more than the caller declared ----
  // An undeclared function is not an unchecked one: it declares nothing, so it may call nothing that
  // declares an effect. That is what makes "no hidden network" true rather than aspirational.
  allowed(effects) {
    return new Set(effects || []);
  }

  callFunction(decl, args, fromEffects) {
    // Recursion without a base case would otherwise exhaust the host stack and surface as a host
    // crash rather than a diagnostic. The depth belongs to the language.
    if (++this.depth > this.maxDepth) this.fail("HMYR-R0108", "call depth exceeded (" + this.maxDepth + ")");
    // 一个循环而不是一次调用：尾调用不新压一帧，于是尾递归的深度不吃宿主栈。
    // 这一层只算一次深度——换函数不算离开这一层，那正是尾调用的意思。
    try {
      let 当前 = decl, 当前实参 = args, 当前效果 = fromEffects;
      while (true) {
        try { return this.callFunctionInner(当前, 当前实参, 当前效果); }
        catch (e) {
          if (e instanceof TailCall) {
            // 每换一次函数计一步。
            //
            // 为什么必须有这一行：纯尾递归（return f() 而没有实参）在每一层
            // 一次求值都不做，于是它既不吃栈也不吃步数——那会变成一个真正停不下来的循环。
            // 三步数本来就是「这件事还要做多久」的账，而换一次函数也是一件事。
            if (++this.steps > this.stepLimit) this.fail("HMYR-R0102", "the program ran for too long without finishing");
            当前 = e.decl; 当前实参 = e.args; 当前效果 = e.fromEffects; continue;
          }
          throw e;
        }
      }
    } finally { this.depth--; }
  }

  callFunctionInner(decl, args, fromEffects) {
    if (fromEffects) {
      for (const effect of decl.effects || []) {
        if (!fromEffects.has(effect)) {
          this.fail("HMYR-R0201", "function '" + decl.name + "' uses effect '" + effect + "', which the caller did not declare");
        }
      }
    }
    const scope = new Scope(null);
    const values = [];
    for (let i = 0; i < decl.params.length; i++) {
      const p = decl.params[i];
      if (i < args.length) values.push(args[i]);
      else if (p.fallback) values.push(this.evalExpr(p.fallback, scope));
      else this.fail("HMYR-R0101", "function '" + decl.name + "' expects " + decl.params.length + " argument(s), got " + args.length);
      scope.set(p.name, values[i], false);
    }
    if (args.length > decl.params.length) {
      this.fail("HMYR-R0101", "function '" + decl.name + "' expects " + decl.params.length + " argument(s), got " + args.length);
    }
    const inner = this.allowed(decl.effects);
    try {
      return decl.body ? this.execBlock(decl.body, scope, inner) : null;
    } catch (e) {
      if (e instanceof Return) return e.value;
      throw e;
    }
  }

  execBlock(block, parentScope, effects) {
    const scope = new Scope(parentScope);
    let last = null;
    for (const stmt of block.statements) last = this.execStatement(stmt, scope, effects);
    return last;
  }

  execStatement(stmt, scope, effects) {
    if (this.stage0 && !STAGE0_STMT.has(stmt.kind)) {
      throw new Error("stage 0 does not need the statement kind '" + stmt.kind + "'");
    }
    switch (stmt.kind) {
      case "Let": case "Var": {
        const value = this.evalExpr(stmt.value, scope, effects);
        // let is immutable, var is not. The distinction is a rule with a code, not a convention.
        scope.set(stmt.name, value, stmt.kind === "Var");
        return value;
      }
      case "Assign": {
        const value = this.evalExpr(stmt.value, scope, effects);
        if (!scope.assign(stmt.name, value)) {
          this.fail("HMYR-R0150", "cannot assign to '" + stmt.name + "': it is not a variable declared with var, or it is not in scope");
        }
        return value;
      }
      case "Return": {
        // 尾位置：return f(...) 里的那个调用不必保留这一层。
        // 于是把它包成 TailCall 抛上去，由 callFunction 的循环接手。
        //
        // 只对「被调的是这门语言里的函数」成立：内置函数不经过这条环，
        // 而 return 一个内置调用的结果本来也不占栈。
        const v = stmt.value;
        if (v && v.kind === "Call" && v.callee.kind === "Ident" && this.functions.has(v.callee.name)) {
          const 实参 = v.args.map((a) => this.evalExpr(a, scope, effects));
          throw new TailCall(this.functions.get(v.callee.name), 实参, effects);
        }
        throw new Return(v ? this.evalExpr(v, scope, effects) : null);
      }
      case "ExprStmt": return this.evalExpr(stmt.expr, scope, effects);
      case "DeclStmt":
        if (stmt.decl.kind === "Fn") { this.functions.set(stmt.decl.name, stmt.decl); return null; }
        if (stmt.decl.kind === "Const") { const v = this.evalExpr(stmt.decl.value, scope, effects); scope.set(stmt.decl.name, v, false); return v; }
        return null;
      default:
        this.fail("HMYR-R0110", "cannot execute a statement of kind " + stmt.kind);
    }
  }

  evalExpr(node, scope, effects) {
    if (++this.steps > this.stepLimit) this.fail("HMYR-R0102", "the program ran for too long without finishing");
    if (!node || node.kind === "Error") this.fail("HMYR-R0103", "a syntax error reached the evaluator");
    if (this.stage0 && !STAGE0_EXPR.has(node.kind)) {
      throw new Error("stage 0 does not need the expression kind '" + node.kind + "'");
    }

    switch (node.kind) {
      case "Literal": return node.value;
      case "Ident": {
        if (scope.has(node.name)) return scope.get(node.name);
        if (this.globals.has(node.name)) return this.globals.get(node.name);
        this.fail("HMYR-R0104", "there is no name '" + node.name + "' in scope");
        break;
      }
      case "Unary": {
        const v = this.evalExpr(node.operand, scope, effects);
        return node.op === "-" ? -this.asNumber(v) : !this.truthy(v);
      }
      case "Binary": return this.evalBinary(node, scope, effects);
      case "While": {

        // 循环不是递归：这一层用宿主的循环，所以深度不随迭代次数增长。

        // 语言里有了循环之后，用这门语言写的东西也不必靠深递归硬撑（shell 的真会话就是例子）。

        let guard = 0;

        while (this.truthy(this.evalExpr(node.condition, scope, effects))) {

          if (node.body) this.execBlock(node.body, scope, effects);

          guard += 1;

          if (guard > 1000000) this.fail("HMYR-R0210", "a while loop ran past a million iterations without ending");

        }

        return null;

      }

      case "If": {
        const condition = this.evalExpr(node.condition, scope, effects);
        if (this.truthy(condition)) return node.then ? this.execBlock(node.then, scope, effects) : null;
        if (!node.otherwise) return null;
        return node.otherwise.kind === "Block" ? this.execBlock(node.otherwise, scope, effects) : this.evalExpr(node.otherwise, scope, effects);
      }
      case "Match": {
        const subject = this.evalExpr(node.subject, scope, effects);
        for (const arm of node.arms) {
          const wildcard = arm.pattern.kind === "Ident" && arm.pattern.name === "_";
          if (wildcard || this.equal(subject, this.evalExpr(arm.pattern, scope, effects))) {
            return this.evalExpr(arm.body, scope, effects);
          }
        }
        this.fail("HMYR-R0105", "no match arm accepted the value");
        break;
      }
      case "Block": return this.execBlock(node, scope, effects);
      case "Tuple": return node.items.map((n) => this.evalExpr(n, scope, effects));
      case "Record": {
        const record = {};
        for (const field of node.fields) record[field.name] = this.evalExpr(field.value, scope, effects);
        return record;
      }
      case "Field": {
        const target = this.evalExpr(node.target, scope, effects);
        if (target === null || typeof target !== "object" || !(node.name in target)) {
          this.fail("HMYR-R0106", "no field '" + node.name + "' on that value");
        }
        return typeof target[node.name] === "function" ? target[node.name].bind(target) : target[node.name];
      }
      case "Index": {
        const target = this.evalExpr(node.target, scope, effects);
        // 下标先取下整，与 slice 的起止、设()、chr() 同一条规矩。
        const index = 下整(this.asNumber(this.evalExpr(node.index, scope, effects)));
        if (typeof target !== "string" && !Array.isArray(target)) this.fail("HMYR-R0152", "cannot index " + describe(target));
        if (index < 0 || index >= target.length) this.fail("HMYR-R0151", "index " + index + " is outside a value of length " + target.length);
        return target[index];
      }
      case "Call": return this.evalCall(node, scope, effects);
      default:
        this.fail("HMYR-R0110", "cannot evaluate a node of kind " + node.kind);
    }
  }

  evalCall(node, scope, effects) {
    // a builtin first, so that names like print are not shadowed by a variable
    if (node.callee.kind === "Ident" && BUILTINS[node.callee.name]) {
      const name = node.callee.name;
      if (this.stage0 && !STAGE0_BUILTIN.has(name)) {
        throw new Error("stage 0 does not need the builtin '" + name + "'");
      }
      const need = BUILTIN_EFFECTS[name];
      if (need && !(effects instanceof Set && effects.has(need))) {
        this.fail("HMYR-R0201", "builtin '" + name + "' needs effect '" + need + "', which the caller did not declare");
      }
      const args = node.args.map((a) => this.evalExpr(a, scope, effects));
      const result = BUILTINS[node.callee.name](this, args);
      return result === undefined ? null : result;
    }
    const args = node.args.map((a) => this.evalExpr(a, scope, effects));
    if (node.callee.kind === "Ident") {
      const decl = this.functions.get(node.callee.name);
      if (decl) return this.callFunction(decl, args, effects);
    }
    // 方法调用：接收者要跟着传下去。少了 apply 这一步，块上的 存/取 就取不到
    // 自己是哪一块 —— 而那是它唯一的上下文。区的方法不需要它（它们是闭包），
    // 块的方法需要（一块内存的内容只属于那一块）。
    if (node.callee.kind === "Field") {
      const 主 = this.evalExpr(node.callee.target, scope, effects);
      const 法 = 主 === null || 主 === undefined ? undefined : 主[node.callee.name];
      if (typeof 法 === "function") return 法.apply(主, args);
      this.fail("HMYR-R0107", "that value is not callable");
    }
    const callee = this.evalExpr(node.callee, scope, effects);
    if (typeof callee === "function") return callee(...args);
    this.fail("HMYR-R0107", "that value is not callable");
  }

  evalBinary(node, scope, effects) {
    if (node.op === "&&") {
      const left = this.evalExpr(node.left, scope, effects);
      return this.truthy(left) ? this.truthy(this.evalExpr(node.right, scope, effects)) : false;
    }
    if (node.op === "||") {
      const left = this.evalExpr(node.left, scope, effects);
      return this.truthy(left) ? true : this.truthy(this.evalExpr(node.right, scope, effects));
    }
    const a = this.evalExpr(node.left, scope, effects);
    const b = this.evalExpr(node.right, scope, effects);
    switch (node.op) {
      case "+":
        // text concatenates, numbers add, and two tuples join into one. The third case is what lets a
        // description build a sequence recursively instead of listing every element by hand.
        if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
        if (typeof a === "string" || typeof b === "string") return this.asString(a) + this.asString(b);
        return 数加(this.asNumber(a), this.asNumber(b));
      // 算术与比较都走 src/numbers.mjs 那一处定义：换实现只有一个落点，
      // 也就没有「宿主的裸运算还留在某一条路上」这种事。
      case "-": return 数减(this.asNumber(a), this.asNumber(b));
      case "*": return 数乘(this.asNumber(a), this.asNumber(b));
      case "/":
        if (数零(this.asNumber(b))) this.fail("HMYR-R0120", "division by zero");
        return 数除(this.asNumber(a), this.asNumber(b));
      case "%":
        if (数零(this.asNumber(b))) this.fail("HMYR-R0120", "division by zero");
        return 数余(this.asNumber(a), this.asNumber(b));
      case "==": return this.equal(a, b);
      case "!=": return !this.equal(a, b);
      case "<": return this.compare(a, b) < 0;
      // <= 与 >= 要先问「能不能比」：compare 把不可比压成 0，那看起来像「等于」。
      // < 与 > 不必问，0 < 0 与 0 > 0 都是假。
      case "<=": return 有序(a, b) && this.compare(a, b) <= 0;
      case ">": return this.compare(a, b) > 0;
      case ">=": return 有序(a, b) && this.compare(a, b) >= 0;
      default: this.fail("HMYR-R0111", "no evaluation for operator " + node.op);
    }
  }

  asNumber(v) {
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    this.fail("HMYR-R0130", "expected a number, found " + describe(v));
  }
  asString(v) {
    if (typeof v === "string") return v;
    if (v === null) return "nil";
    if (Array.isArray(v)) return "[" + v.map((x) => this.asString(x)).join(", ") + "]";
    return String(v);
  }
  truthy(v) { return !(v === false || v === null || v === 0 || v === ""); }
  equal(a, b) { return typeof a === typeof b ? a === b : this.asString(a) === this.asString(b); }
  compare(a, b) {
    if (typeof a === "number" && typeof b === "number") return 数比(a, b);
    if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
    this.fail("HMYR-R0131", "cannot compare " + describe(a) + " with " + describe(b));
  }
}

export function describe(v) {
  if (v === null) return "nil";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return v[数组标] === true ? "array" : "tuple";
  if (typeof v === "object") return "a host object";
  return String(v);
}

class Scope {
  constructor(parent) { this.map = new Map(); this.parent = parent; }
  has(name) { return this.map.has(name) || (this.parent ? this.parent.has(name) : false); }
  get(name) { return this.map.has(name) ? this.map.get(name).value : this.parent.get(name); }
  set(name, value, mutable = false) { this.map.set(name, { value, mutable }); }
  // Assignment walks outward to the scope that owns the name, and refuses if that binding is not a var.
  assign(name, value) {
    if (this.map.has(name)) {
      const binding = this.map.get(name);
      if (!binding.mutable) return false;
      binding.value = value;
      return true;
    }
    return this.parent ? this.parent.assign(name, value) : false;
  }
}

// CRC32 的表：256 项，第一次用时生成。与 C 那台同一张表（多项式 0xEDB88320），
// 于是两边对同一串字节给出同一个值 —— 而「同一个值」是 ZIP 能互通的前提。
let 校验表缓存 = null;
const 取校验表 = () => {
  if (校验表缓存) return 校验表缓存;
  const 表 = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    表.push(c >>> 0);
  }
  校验表缓存 = 表;
  return 表;
};

// A builtin that touches the outside world is a capability, and it is checked at the call site against
// what the calling function declared. Without this, "effects" would only apply to functions we wrote.
// 内置碰哪一类世界。实时档位那一条静态检查（src/realtime-check.mjs）也要这张表 ——
// 它说「哪些内置是阻塞的」。所以这张表导出：一处定义，两处读。
export const BUILTIN_EFFECTS = { read_text: "file", read_bytes: "file", read_dir: "file", is_dir: "file", write_text: "file", run_program: "process", chdir: "process", argv: "process", file_exists: "file", print_err: "process", thr_spawn: "thread", thr_cancel: "thread" };

/** 编码表按需读入并缓存：表是「字符 -> 字节」，从本运行时的解码器推出来的。
 *
 * 读它也算读文件，于是走能力层——不是因为它「碰了世界」，而是因为这条路只有一条。
 * 一份表从哪儿来（本仓库的 deps）与「怎么读一个文件」是两件事，前者是常量，后者是能力。
 */
const ENCODING_TABLES = new Map();
function loadEncodingTable(rt, enc) {
  if (ENCODING_TABLES.has(enc)) return ENCODING_TABLES.get(enc);
  let table = null;
  try {
    table = JSON.parse(String(rt.cap.file.read(new URL("../deps/encodings/" + enc + ".json", import.meta.url))));
  } catch (err) { table = null; }
  ENCODING_TABLES.set(enc, table);
  return table;
}

/** 按名字解码；不认识的名字是一条带编号的失败，而不是一个猜。 */
// 写文件的唯一出口：写不进去就报编号，而不是抛宿主的原始异常。

// 契约里写着「拒绝时给哪个编号」，所以这一层不能漏。

function writeBytes(rt, file, buf) {

  try { rt.cap.file.write(file, buf); return true; }

  catch (err) { rt.fail("HMYR-R0212", "cannot write '" + file + "': " + String(err && err.message ? err.message : err)); }

}



function decodeBytes(rt, buf, enc) {
  if (buf === null || buf === undefined) return "";
  try { return new TextDecoder(enc).decode(buf); }
  catch (err) { rt.fail("HMYR-E0008", "this runtime does not know the encoding '" + enc + "'"); }
}
const trimEnd = (s) => String(s === null || s === undefined ? "" : s).replace(/\s+$/, "");

// 键输入用一个队列：真实终端与套件走同一条路，于是「按键就停」可以被自动验。
const KEY_QUEUE = [];

// 语言档案：宿主只记住「当前选中的是哪一套」，以及「环境说该是哪一套」。
// 档案里有什么，那是语言侧的数据（locale.hmyr），宿主不知道也不该知道。
const LOCALE_NAMES = ["zh-CN.gbk", "zh-CN.utf8", "ja-JP.shift_jis", "en-US.utf8"];
let currentLocale = null;

// 线程：worker 在另一个核上跑，结果经共享内存回来，所以主线程可以同步等。
// 这一点与子进程那条路不同——那一头的完成事件要经过主线程的事件循环，同步等会死锁。
// 而 Worker 与 Atomics 本身在能力层那一组里（src/capabilities.mjs 的 thread），
// 于是这一份文件不再直接 import 它。
const THREADS = new Map();
let nextThreadId = 1;

// 仓库根：语言文件用的相对路径都以它为基准。
const ROOT = import.meta.dirname.replace(/[\\/][^\\/]*$/, "");

// 32 位位运算：SHA-256 那类东西在语言里算不动，因为一次 与 要三十二轮循环。
// 落到宿主的位上，一次就是一次。
const 位 = (v) => Math.floor(v) >>> 0;

// 可变数组：JS 侧就是一个打了标记的 Array。
// 元组的不可变靠「+ 复制」，而 设 是原地改 —— 标记让 设 拒绝元组，
// 免得「不可变」这条被悄悄破掉。
const 数组标 = "__hmyr_array";
const 是数组 = (v) => Array.isArray(v) && v[数组标] === true;
const 造数组 = (t) => {
  const a = [...t];
  a[数组标] = true;
  return a;
};

// ---- 区的记账（design/MEMORY.txt 的三区模型，桩这一层能做到的那一半） ----
// 「谁拥有这一块」不写进块里：记录是语言看得见的东西，而拥有关系是运行时的事。
// WeakMap 让这条关系随块被回收自己消失，不会拖住一块内存。
const 区拥有者 = new WeakMap();
const 区活着 = new Set();
let 区序号 = 0;

const BUILTINS = {
  // ---- 〇、位运算（32 位无符号）：给 SHA-256 那类算法一条不用逐位循环的路 ----
  位与: (rt, args) => 位(rt.asNumber(args[0])) & 位(rt.asNumber(args[1])),
  位或: (rt, args) => (位(rt.asNumber(args[0])) | 位(rt.asNumber(args[1]))) >>> 0,
  位异或: (rt, args) => (位(rt.asNumber(args[0])) ^ 位(rt.asNumber(args[1]))) >>> 0,
  位非: (rt, args) => (~位(rt.asNumber(args[0]))) >>> 0,
  位右移: (rt, args) => (位(rt.asNumber(args[0])) >>> (位(rt.asNumber(args[1])) & 31)) >>> 0,
  位加: (rt, args) => (位(rt.asNumber(args[0])) + 位(rt.asNumber(args[1]))) >>> 0,
  位循环右移: (rt, args) => {
    const a = 位(rt.asNumber(args[0]));
    const n = 位(rt.asNumber(args[1])) & 31;
    return n === 0 ? a : ((a >>> n) | (a << (32 - n))) >>> 0;
  },
  位循环左移: (rt, args) => {
    const a = 位(rt.asNumber(args[0]));
    const n = 位(rt.asNumber(args[1])) & 31;
    return n === 0 ? a : ((a << n) | (a >>> (32 - n))) >>> 0;
  },
  // ---- 一、文本（纯函数）：只从输入算出输出，不读也不写外部状态 ----
  slice: (rt, args) => {
    const s = rt.asString(args[0]);
    const a = args[1] === undefined || args[1] === null ? 0 : Math.max(0, Math.floor(rt.asNumber(args[1])));
    const b = args[2] === undefined || args[2] === null ? s.length : Math.min(s.length, Math.floor(rt.asNumber(args[2])));
    return a >= b ? "" : s.slice(a, b);
  },
  ord: (rt, args) => {
    const s = rt.asString(args[0]);
    if (s.length === 0) rt.fail("HMYR-R0206", "ord of an empty string: there is no first character to read");
    return s.codePointAt(0);
  },
  chr: (rt, args) => {
    const cp = Math.floor(rt.asNumber(args[0]));
    if (cp < 0 || cp > 0x10ffff) rt.fail("HMYR-R0207", "not a code point: " + cp);
    return String.fromCodePoint(cp);
  },
  to_upper: (rt, args) => rt.asString(args[0]).toUpperCase(),
  to_lower: (rt, args) => rt.asString(args[0]).toLowerCase(),
  to_int: (rt, args) => {
    const s = rt.asString(args[0]).trim();
    if (!/^-?[0-9]+$/.test(s)) rt.fail("HMYR-R0208", "not an integer literal: '" + s + "'");
    return Number(s);
  },
  // 目录：cwd 只读，chdir 会改变进程状态——所以后者要 process 效果（见 BUILTIN_EFFECTS）。
  // 可变数组：从元组复制一个，之后可以原地改。
  数组: (rt, args) => {
    const t = args[0];
    if (!Array.isArray(t)) rt.fail("HMYR-R0150", "数组() 要一个元组，拿到的是 " + describe(t));
    return 造数组(t);
  },
  设: (rt, args) => {
    const a = args[0];
    if (!是数组(a)) rt.fail("HMYR-R0151", "设() 的第一个参数必须是 数组() 造出来的可变数组");
    const i = Math.floor(rt.asNumber(args[1]));
    if (!Number.isFinite(i) || i < 0 || i >= a.length) {
      rt.fail("HMYR-R0152", "下标越出数组：" + i + "（长度 " + a.length + "）");
    }
    a[i] = args[2];
    return a;
  },
  len: (rt, args) => {
    const v = args[0];
    if (typeof v === "string" || Array.isArray(v)) return v.length;
    rt.fail("HMYR-R0140", "len() wants a string or a tuple");
  },
  str: (rt, args) => rt.asString(args[0]),
  int: (rt, args) => {
    const n = Number(args[0]);
    if (Number.isNaN(n)) rt.fail("HMYR-R0141", "int() cannot read " + describe(args[0]));
    return Math.trunc(n);
  },
  abs: (rt, args) => Math.abs(rt.asNumber(args[0])),
  min: (rt, args) => Math.min(...args.map((a) => rt.asNumber(a))),
  max: (rt, args) => Math.max(...args.map((a) => rt.asNumber(a))),
  // A host stub, not the zone model: it holds its allocations so that close() has something to free.
  // design/MEMORY.txt describes what this should become.
  nfc: (rt, args) => String(args[0]).normalize("NFC"),
  is_letter: (rt, args) => /\p{L}/u.test(String(args[0])),
  is_mark: (rt, args) => /\p{M}/u.test(String(args[0])),
  // 读文件：编码要么显式写明，要么按 BOM 判——BOM 是事实，代码页是猜测，所以只认前者。
  split: (rt, args) => String(rt.asString(args[0])).split(String(rt.asString(args[1]))),
  // A platform language's first job is driving other programs. What comes back is data - exit code,
  // output, whether it had to be stopped - rather than an exception, because a program that will not
  // start is a fact about the world and not a fault in the script. The timeout is not optional in
  // spirit: a child that never ends would otherwise hang its host.
  // 从键值对造记录。JSON 与自举那边都需要「用字符串当字段名」这一手，
  // 而记录不是哈希表：字段名必须是标识符能写的形状，否则拒绝（R0214）。
  record_new: (rt, args) => {
    const pairs = args[0];
    if (!Array.isArray(pairs)) rt.fail("HMYR-R0214", "record_of wants a tuple of (name, value) pairs");
    const out = {};
    for (const p of pairs) {
      if (!Array.isArray(p) || p.length !== 2) rt.fail("HMYR-R0214", "every item must be a (name, value) pair");
      const k = rt.asString(p[0]);
      if (!/^[\p{L}_][\p{L}\p{N}\p{M}_]*$/u.test(k)) rt.fail("HMYR-R0214", "not a name a record could hold: " + JSON.stringify(k));
      out[k] = p[1];
    }
    return out;
  },
  // 按名字取字段。为什么需要它：下标只收数字，而「字段名是个变量」这种情形
  // 用 .名字 写不出来——自举的求值器正是这种情形。
  field_get: (rt, args) => {
    const rec = args[0];
    const name = rt.asString(args[1]);
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
      rt.fail("HMYR-R0215", "field_get wants a record, found " + describe(rec));
    }
    if (!Object.prototype.hasOwnProperty.call(rec, name)) {
      rt.fail("HMYR-R0216", "no field '" + name + "' on that record");
    }
    return rec[name];
  },
  // 有没有这个字段。它是纯函数、不需要编号——问一句「有没有」，不是失败。
  // 有了它，调用方可以先问再取，于是不会撞上「按名字取不到就抛」那一下。
  field_has: (rt, args) => {
    const rec = args[0];
    const name = rt.asString(args[1]);
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) return false;
    return Object.prototype.hasOwnProperty.call(rec, name);
  },
  // 字段名的列表，按造记录时的顺序。
  //
  // 为什么需要它：没有枚举，就写不出「把一条记录摊开」这一类东西 ——
  // 而记录当字典的第一步正是「知道有哪些键」。标准库的 tables 那一份就卡在这里：
  // 不能列出字段，就无法做通用的置入、删除与合并。
  //
  // 非记录给 R0217：没有字段可列，也就没有名字可交回 —— 交回空表会把
  // 「这不是记录」说成「这是一条空记录」。
  field_names: (rt, args) => {
    const rec = args[0];
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
      rt.fail("HMYR-R0217", "field_names wants a record, found " + describe(rec));
    }
    return Object.keys(rec);
  },
  // ---- 九半、索引 ----
  //
  // 一个按键查的东西。为什么不用记录凑：记录只能一次建好，而且键必须「像名字」，
  // 码点键 "0041" 会被拒。为什么不用元组收集：拼接是 O(n²)，八千个键就撞步数上限
  // （design/INDEX.txt 里有那张表）。
  //
  // 键是任意字符串；交回的是同一个索引，于是可以写 表 = index_set(表, k, v)。
  index_new: () => new Map(),
  index_set: (rt, args) => {
    const m = args[0];
    if (!(m instanceof Map)) rt.fail("HMYR-R0219", "index_set wants an index, found " + describe(m));
    m.set(rt.asString(args[1]), args[2]);
    return m;
  },
  index_get: (rt, args) => {
    const m = args[0];
    if (!(m instanceof Map)) rt.fail("HMYR-R0219", "index_get wants an index, found " + describe(m));
    const k = rt.asString(args[1]);
    if (!m.has(k)) rt.fail("HMYR-R0218", "no key " + JSON.stringify(k) + " in that index");
    return m.get(k);
  },
  index_has: (rt, args) => {
    const m = args[0];
    if (!(m instanceof Map)) return false;
    return m.has(rt.asString(args[1]));
  },
  index_len: (rt, args) => {
    const m = args[0];
    if (!(m instanceof Map)) rt.fail("HMYR-R0219", "index_len wants an index, found " + describe(m));
    return m.size;
  },
  index_keys: (rt, args) => {
    const m = args[0];
    if (!(m instanceof Map)) rt.fail("HMYR-R0219", "index_keys wants an index, found " + describe(m));
    return [...m.keys()];
  },
  // ---- 十、线程 ----
  // thr_spawn 起一个 worker；thr_join 同步等它；thr_cancel 叫停；thr_count 数活着的。
  // 起与停要 thread 效果；等与数是读。
  thr_spawn: (rt, args) => {
    const source = rt.asString(args[0]);
    const entry = rt.asString(args[1]);
    const id = nextThreadId++;
    const outPath = rt.cap.path.join(rt.cap.env.temp(), "hmyr-thread-" + process.pid + "-" + id + ".json");
    const flag = rt.cap.thread.signal();
    const handle = { id, flag, outPath, done: false, worker: null };
    handle.worker = rt.cap.thread.spawn(new URL("./thr-worker.mjs", import.meta.url), { source, entry, outPath, flag });
    if (!handle.worker) {
      // 起不来就交回 -1（一个无效句柄）。不用编号：那不是「拒绝」，是这个线程压根没出生，
      // 而调用方拿到 -1 之后 join 会得到 R0221——一条路，不是两条。
      return -1;
    }
    // 顺手把错误也记下来：不让一个起不来的线程把主线程一直挂着。
    handle.worker.on("error", () => rt.cap.thread.store(handle.flag, 9));
    // 不让一个还活着的线程拖住整个进程：宿主该退就退。
    if (typeof handle.worker.unref === "function") handle.worker.unref();
    handle.worker.on("exit", (code) => { if (rt.cap.thread.load(handle.flag) === 0) rt.cap.thread.store(handle.flag, code === 0 ? 1 : 9); });
    THREADS.set(id, handle);
    return id;
  },
  thr_join: (rt, args) => {
    const id = Math.floor(rt.asNumber(args[0]));
    const h = THREADS.get(id);
    if (!h) rt.fail("HMYR-R0221", "no such thread handle: " + id);
    const timeout = args[1] === undefined || args[1] === null ? 30000 : Math.floor(rt.asNumber(args[1]));
    const 到 = Date.now() + timeout;
    while (rt.cap.thread.load(h.flag) === 0) {
      const 剩 = 到 - Date.now();
      if (剩 <= 0) rt.fail("HMYR-R0222", "thread " + id + " did not finish within " + timeout + "ms");
      rt.cap.thread.wait(h.flag, Math.min(剩, 50));
    }
    let 结果 = null;
    try { 结果 = JSON.parse(rt.cap.file.read(h.outPath).toString("utf8")); } catch (err) { 结果 = null; }
    rt.cap.file.remove(h.outPath);
    THREADS.delete(id);
    if (!结果) return "";
    return 结果.ok ? String(结果.text) : "";
  },
  thr_cancel: (rt, args) => {
    const id = Math.floor(rt.asNumber(args[0]));
    const h = THREADS.get(id);
    if (!h) rt.fail("HMYR-R0221", "no such thread handle: " + id);
    try { if (h.worker) h.worker.terminate(); } catch (err) { /* 已经没了就算停住 */ }
    rt.cap.file.remove(h.outPath);
    THREADS.delete(id);
    return id;
  },
  thr_count: (rt) => Array.from(THREADS.values()).filter((h) => rt.cap.thread.load(h.flag) === 0).length,
  // ---- 五、环境（只读，不需要效果） ----
  // 仓库根：语言文件里不该写死绝对路径，否则换一台机器就坏。
  // 这一对内置把「仓库在哪」与「解释器在哪」收成两处，而不是散在各文件里。
  repo_path: (rt, args) => {
    const rel = rt.asString(args[0]);
    return rt.cap.path.resolve(ROOT, rel);
  },
  // 临时文件放哪儿：只有这一处说。缺省是系统临时目录，
  // 而 HMYR_TMP 可以把它指到别处——本机就把它指到 E: 上的缓存目录，以守那条磁盘纪律。
  temp_path: (rt, args) => {
    const 名 = rt.asString(args[0]);
    const 目录 = rt.cap.env.get("HMYR_TMP") || rt.cap.env.temp();
    rt.cap.file.ensureDir(目录);
    return rt.cap.path.join(目录, "hmyr-" + 名);
  },
  python_path: (rt) => {
    // 先看环境变量（于是别的机器可以指自己的），再看这台机器上那个托管解释器，最后退回 PATH。
    const 指 = rt.cap.env.get("HMYR_PYTHON");
    if (指) return 指;
    const 托管 = "E:/DaShaoHuo/Python-managed/bin/python.exe";
    if (rt.cap.file.exists(托管)) return 托管;
    return "python";
  },
  // ---- 二、输出：写到一个可替换的出口 ----
  // 另一条通道：诊断与用法走这里，答案走 print。
  // 分开是有用的——「把答案重定向出去」不该顺手把用法也塞进那个文件。
  print_err: (rt, args) => {
    const 文 = args.map((a) => rt.asString(a)).join("");
    if (rt.writeErr) rt.writeErr(文);
    else if (rt.write) rt.write(文);
    return undefined;
  },
  print: (rt, args) => { rt.write(args.map((a) => rt.asString(a)).join("")); return null; },
  // ---- 三、文件（需要 file 效果） ----
  read_text: (rt, args) => {
    const 路径 = String(args[0]);
    let buf;
    try { buf = rt.cap.file.read(路径); }
    // 消息里的路径可以被藏起来（--redact 或 HMYR_REDACT）。编号不动 ——
    // 「靠编号分辨是什么错」这件事不受影响，被藏起来的只是那一截路径。
    // 宿主那份原因也一并省掉：它通常就是「系统找不到路径」，带着同一条路径。
    catch (err) {
      const 原因 = 在用脱敏() ? "" : ": " + String(err && err.message ? err.message : err);
      rt.fail("HMYR-R0211", "cannot read '" + 藏路径(路径) + "'" + 原因);
    }
    const enc = args[1] === undefined || args[1] === null ? null : rt.asString(args[1]);
    if (enc) return decodeBytes(rt, buf, enc);
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
    return buf.toString("utf8");
  },
  // 写文件：这台运行时只编得出 UTF-8 一类。写不出就拒绝——写出一串看着对、其实错的字节才是灾难。
  // 「这个文件在不在」是文件这一组最基础的问题，而 read_text 只能读。
  // 没有它，「引一个可选文件」就只能靠 read_text 去撞——而它撞到就是一条 R0211，
  // 于是「引了个不存在的」与「读不了」被混成同一件事。
  file_exists: (rt, args) => {
    const 路径 = String(args[0]);
    try { return rt.cap.file.exists(路径); } catch (err) { return false; }
  },
  // 列一个目录：交回名字的元组。排序由能力层保证，不留给调用者 ——
  // 「每个调用者自己记得排一下」这种约定迟早会被漏掉一处，而漏掉的那一处
  // 会让清单在两个实现之间不一致，且只在某个文件系统上现形。
  read_dir: (rt, args) => {
    const 路径 = String(args[0]);
    let 名们;
    try { 名们 = rt.cap.file.listDir(路径); }
    catch (err) {
      const 原因 = 在用脱敏() ? "" : ": " + String(err && err.message ? err.message : err);
      rt.fail("HMYR-R0211", "cannot list '" + 藏路径(路径) + "'" + 原因);
    }
    return 名们;
  },
  // 这是不是一个目录。问不到就交回 false —— 与 file_exists 同一个态度：
  // 「问不到」与「不是」在调用者眼里通常是同一件事，而多一个错误码只让人多写一段。
  is_dir: (rt, args) => {
    const 路径 = String(args[0]);
    try { return rt.cap.file.isDir(路径); } catch (err) { return false; }
  },
  // CRC32（多吉性与 ZIP 都用它）。表第一次用时生成。
  //
  // 为什么不 import node:zlib：「执行器对宿主要求什么」是一张被 test/host-deps.test.mjs
  // 盯着的清单，而 CRC 是纯算术 —— 不该让宿主少一项自由的代价换它。
  // 参数收字节的元组，元素可以是一字节，也可以是一块（与 write_bytes 同一条规矩）。
  校验和: (rt, args) => {
    const 元组 = args[0];
    if (!Array.isArray(元组)) throw new Error("校验和 wants a tuple of bytes");
    const 表 = 取校验表();
    let c = -1;
    for (const x of 元组) {
      if (Array.isArray(x)) {
        for (const y of x) {
          const b = rt.asNumber(y) & 0xff;
          c = (c >>> 8) ^ 表[(c ^ b) & 0xff];
        }
      } else {
        const b = rt.asNumber(x) & 0xff;
        c = (c >>> 8) ^ 表[(c ^ b) & 0xff];
      }
    }
    return (c ^ -1) >>> 0;
  },
  // 写一串字节、把双精度拆成字节、把一个值编成 .hmyrb 的一段 ——
  // 这三条是「打包搬进 HMYR」用的，出口都在能力层。
  // 这一层里元组就是普通数组（见 STAGE0_EXPR 的 Tuple），所以直接交回数组。
  write_bytes: (rt, args) => {
    const 路径 = String(args[0]);
    const 元组 = args[1];
    if (!Array.isArray(元组)) throw new Error("write_bytes wants a tuple of bytes");
    // 元素可以是字节，也可以是一块字节（语言那边按块累积，省掉平方复制）。
    const 平 = [];
    for (const x of 元组) {
      if (Array.isArray(x)) { for (const y of x) 平.push(rt.asNumber(y) & 0xff); }
      else 平.push(rt.asNumber(x) & 0xff);
    }
    writeBytes(rt, 路径, Buffer.from(平));
    return 平.length;
  },
  f64_bytes: (rt, args) => {
    return rt.cap.file.f64Bytes(rt.asNumber(args[0]));
  },
  pack_value: (rt, args) => {
    return rt.cap.file.packValue(args[0]);
  },
  // 按行读：从偏移读一行，交回 {行, 下一起点}；读完交回 下一起点 = -1。
  read_line: (rt, args) => {
    const 路径 = String(args[0]);
    const 起 = rt.asNumber(args[1]);
    try {
      const r = rt.cap.file.readLine(路径, 起);
      return { 行: r.行, 下一起点: r.下一起点 };
    } catch (err) {
      const 原因 = 在用脱敏() ? "" : ": " + String(err && err.message ? err.message : err);
      throw new Error("cannot read a line" + 原因);
    }
  },
  read_lines: (rt, args) => {
    const 路径 = String(args[0]);
    return rt.cap.file.readLines(路径);
  },
  write_text: (rt, args) => {
    const file = String(args[0]);
    const text = rt.asString(args[1]);
    const raw = args[2] === undefined || args[2] === null ? "utf8" : rt.asString(args[2]).toLowerCase();
    const enc = raw === "utf-8" ? "utf8" : raw === "utf-16le" ? "utf16le" : raw;
    if (["utf8", "latin1", "utf16le"].includes(enc)) {
      writeBytes(rt, file, Buffer.from(text, enc));
      return text.length;
    }
    // 其余编码走表。表不存在就明确拒绝——猜一个编码是这一路最不想要的行为。
    const table = loadEncodingTable(rt, enc);
    if (!table) {
      rt.fail("HMYR-R0203", "writing '" + raw + "' is not supported: no table under deps/encodings for it");
    }
    const bytes = [];
    const missing = [];
    for (const ch of text) {
      const b = table[ch];
      if (b) bytes.push(...b);
      else if (missing.indexOf(ch) < 0) missing.push(ch);
    }
    if (missing.length) {
      rt.fail("HMYR-R0204", "these characters do not exist in " + raw + ": " + missing.slice(0, 8).join("") +
        (missing.length > 8 ? " (and " + (missing.length - 8) + " more)" : ""));
    }
    writeBytes(rt, file, Buffer.from(bytes));
    return text.length;
  },
  // 控制台的代码页：让写程序的人**能查**，而不是让语言去猜。
  // ---- 四、进程（需要 process 效果） ----
  run_program: (rt, args) => {
    const command = String(args[0]);

    // 空名字什么也不指。此前这里会抛宿主的 ERR_INVALID_ARG_VALUE，那是裸的——契约要求有编号。

    if (command === "") rt.fail("HMYR-R0213", "run_program needs a program name: an empty string names nothing");
    const rest = Array.isArray(args[1]) ? args[1].map((a) => rt.asString(a)) : [];
    const timeout = args[2] === undefined || args[2] === null ? 10000 : rt.asNumber(args[2]);
    // 第四位是输出的编码：中文 Windows 的控制台多半是 GBK，写死 UTF-8 会让每个汉字变成替换字符。
    const outEnc = args[3] === undefined || args[3] === null ? "utf8" : rt.asString(args[3]);
    const result = rt.cap.process.exec(command, rest, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return {
      code: typeof result.status === "number" ? result.status : -1,
      stdout: trimEnd(decodeBytes(rt, result.stdout, outEnc)),
      stderr: trimEnd(decodeBytes(rt, result.stderr, outEnc)),
      timedOut: !!(result.error && result.error.code === "ETIMEDOUT"),
      error: result.error ? String(result.error.code || result.error.message) : null,
    };
  },
  // The clock needs no capability - reading it changes nothing - but it is the one builtin that breaks
  // reproducibility, and the specification says so rather than leaving it to be discovered.
  // 自己的命令行参数。交回一个元组，第一个是解释器名，之后是参数——
  // 与大多数系统一致，于是「第几个」不必自己换算。
  argv: (rt, args) => (rt.argv || []).map((x) => String(x)),
  chdir: (rt, args) => {
    const target = rt.asString(args[0]);
    try { rt.cap.process.chdir(target); return rt.cap.process.cwd(); }
    catch (err) { rt.fail("HMYR-R0209", "cannot enter '" + target + "': " + String(err && err.message ? err.message : err)); }
  },
  // ---- 五、环境（只读，不需要效果） ----
  cwd: (rt) => rt.cap.process.cwd(),
  home_dir: (rt) => rt.cap.env.home(),
  locale_env: (rt) => {
    let region = "";
    try { region = new Intl.DateTimeFormat().resolvedOptions().locale || ""; } catch (err) { region = ""; }
    let page = "utf8";
    if (rt.cap.env.platform() === "win32") {
      const r = rt.cap.process.exec("cmd", ["/c", "chcp"], { timeout: 5000, windowsHide: true });
      const m = /(\d{3,5})/.exec(r.stdout ? r.stdout.toString("latin1") : "");
      page = m ? (m[1] === "936" ? "gbk" : m[1] === "932" ? "shift_jis" : "utf8") : "utf8";
    }
    const guess = region.replace("_", "-") + "." + page;
    return LOCALE_NAMES.includes(guess) ? guess : "";
  },
  locale_current: () => currentLocale || "",
  locale_set: (rt, args) => {
    const name = rt.asString(args[0]);
    if (!LOCALE_NAMES.includes(name)) {
      rt.fail("HMYR-R0205", "no such locale profile: '" + name + "' (have: " + LOCALE_NAMES.join(", ") + ")");
    }
    currentLocale = name;
    return name;
  },

  console_codepage: (rt) => {
    if (rt.cap.env.platform() !== "win32") return "utf8";
    const r = rt.cap.process.exec("cmd", ["/c", "chcp"], { timeout: 5000, windowsHide: true });
    const m = /(\d{3,5})/.exec(r.stdout ? r.stdout.toString("latin1") : "");
    return m ? m[1] : "unknown";
  },
  // ---- 字符串与字符的基本手术 ----
  // 这几个本是语言的常规能力，此前靠手写替代品绕过去（截/片段各一份、码位换成十项小表、
  // 大小写换成二十六项小表）。规矩改了：语言达不到就先补语言，不是绕。
  // 字节元组转文本：按 UTF-8 解码。read_stdin_bytes 交回字节，而请求体是 UTF-8，
  // 两格之间需要这一格。不猜编码：给的就是 UTF-8。
  bytes_to_text: (rt, args) => {
    const 项们 = Array.isArray(args[0]) ? args[0] : [];
    const 字节们 = [];
    for (let i = 0; i < 项们.length; i++) 字节们.push(Number(项们[i]) & 0xFF);
    return Buffer.from(字节们).toString("utf8");
  },
  // 从标准输入读 N 个字节：交回 {字节们, 结束}。结束表示没读满（EOF 先到了）。
  // 与 read_stdin_line 分开，是因为请求体未必只有一行：先读头拿长度，再按长度读。
  read_stdin_bytes: (rt, args) => {
    const n = Math.max(0, Math.floor(rt.asNumber(args[0])));
    const 字节们 = [];
    while (字节们.length < n) {
      let b;
      try { b = rt.cap.terminal.readSync(n - 字节们.length); } catch (err) { b = null; }
      if (!b || b.length === 0) break;
      for (let i = 0; i < b.length; i++) 字节们.push(b[i]);
    }
    return { 字节们, 结束: 字节们.length < n };
  },
  // 从标准输入读一行：交回 {行, 结束}。结束是 EOF —— 与空行是两件事，
  // 「读到没有为止」的循环要能分清它们。行尾的 \r 去掉，别的空白不动。
  read_stdin_line: (rt) => {
    const 段们 = [];
    let 结束 = false;
    for (;;) {
      let b;
      try { b = rt.cap.terminal.readSync(1); } catch (err) { b = null; }
      if (!b || b.length === 0) { 结束 = true; break; }
      if (b[0] === 10) break;
      段们.push(b);
    }
    let s = Buffer.concat(段们).toString("utf8");
    if (s.endsWith("\r")) s = s.slice(0, -1);
    return { 行: s, 结束 };
  },
  // 读一份文件的原始字节：嵌入与打包要用它，而 read_text 会按 UTF-8 解码，
  // 二进制一过就坏。不需要编码参数，也不猜；读不到与 read_text 同一条路。
  read_bytes: (rt, args) => {
    const 路径 = String(args[0]);
    let buf;
    try { buf = rt.cap.file.read(路径); }
    catch (err) {
      const 原因 = 在用脱敏() ? "" : ": " + String(err && err.message ? err.message : err);
      rt.fail("HMYR-R0211", "cannot read '" + 藏路径(路径) + "'" + 原因);
    }
    return Array.from(buf);
  },
  // 按分隔符切：i18n 处理的第一步就是按行切。
  // ---- 六、时间（不需要效果，但破坏可复现性） ----
  now_ms: (rt) => rt.cap.time.now(),
  sleep_ms: (rt, args) => { const ms = Math.max(0, Math.floor(rt.asNumber(args[0]))); if (ms > 0) rt.cap.time.sleep(ms); return ms; },
  floor: (rt, args) => Math.floor(rt.asNumber(args[0])),
  // ---- 七、终端（只返回字符串，一个字都不写出去） ----
  term_size: (rt) => { const s = rt.cap.terminal.size(); return [s.rows, s.columns]; },
  term_clear: () => "\u001b[2J",
  term_escape: (rt, args) => "\u001b[" + Math.max(1, Math.floor(rt.asNumber(args[0]))) + ";" + Math.max(1, Math.floor(rt.asNumber(args[1]))) + "H",
  term_color: (rt, args) => {
    const fg = Math.floor(rt.asNumber(args[0]));
    if (fg < 0) return "\u001b[0m";
    const bg = args[1] === undefined || args[1] === null ? -1 : Math.floor(rt.asNumber(args[1]));
    return bg < 0 ? "\u001b[38;5;" + fg + "m" : "\u001b[38;5;" + fg + ";48;5;" + bg + "m";
  },
  term_hide: () => "\u001b[?25l",
  term_show: () => "\u001b[?25h",
  // ---- 八、输入（与真实终端共用一个队列） ----
  key_push: (rt, args) => { KEY_QUEUE.push(rt.asString(args[0])); return KEY_QUEUE.length; },
  key_available: () => KEY_QUEUE.length > 0,
  key_read: (rt) => {
    if (KEY_QUEUE.length) return KEY_QUEUE.shift();
    // 没有排队就读一次 stdin——同步读，raw 模式下它会阻塞到有键为止。
    // 为什么不用 'data' 事件：求值器是同步的，而 sleep_ms 是忙等，
    // 事件循环在那一刻是堵的，事件永远送不进来。同步读绕开了这件事。
    if (!rt.cap.terminal.isTTY()) return "";
    try {
      const buf = rt.cap.terminal.readSync(64);
      if (buf && buf.length > 0) {
        for (const ch of buf.toString("utf8")) KEY_QUEUE.push(ch);
        return KEY_QUEUE.length ? KEY_QUEUE.shift() : "";
      }
    } catch (err) { /* 读不到就是没有键 */ }
    return "";
  },
  key_start: (rt) => rt.cap.terminal.setRaw(true),
  // 环境说该是哪一套：语言看 Intl 给的区域，编码看控制台代码页。
  // 组合出来不在名单里就返回空串——环境说的话我们没档案，就如实说没有，不退回默认。
  // ---- 九、内存（三区模型的一半：区的记账与两条转换在这，真内存还在第三层） ----
  //
  // 这一格做的是 MEMORY.txt 里那条规则「不静默换区」的可检查部分：块带一个可见的
  // zone 字段，freeze 把它交给托管区，adopt 把它收回来，违规两次各有编号。
  // 而「托管区」今天就是宿主的回收器 —— freeze 改的是记账，不是搬内存；
  // 那句「不移动」在桩里恰好天然成立，因为全程是同一个对象。
  arena: (rt) => {
    const held = [];
    const 我 = ++区序号;
    区活着.add(我);
    const 是块 = (b) => !!b && typeof b === "object" && typeof b.live === "boolean" && typeof b.size === "number";
    const 要活块 = (b, 谁) => {
      if (!是块(b)) rt.fail("HMYR-R0302", 谁 + " wants an arena block, found " + describe(b));
      if (!b.live) rt.fail("HMYR-R0302", 谁 + " was given a block whose arena is already closed");
    };
    return {
      alloc: (n) => {
        const 容量 = typeof n === "number" ? n : 0;
        // 块现在有内容：一个按容量开的格子数组。以前它只有 size 与 live，
        // 于是「把中间值放进区里」这件事在语言里写不出来 —— 而区因此只能记账。
        // 用 function 而不是箭头：存/取 要靠 this 知道自己是哪一块。
        const block = { size: 容量, live: true, zone: "arena", 格: new Array(Math.max(0, 容量)).fill(null) };
        block.存 = function (i, v) {
          if (typeof i !== "number" || i < 0 || i >= this.size) {
            rt.fail("HMYR-R0151", "slot " + i + " is outside this block (size " + this.size + ")");
          }
          this.格[i] = v;
          return this;
        };
        block.取 = function (i) {
          if (typeof i !== "number" || i < 0 || i >= this.size) {
            rt.fail("HMYR-R0151", "slot " + i + " is outside this block (size " + this.size + ")");
          }
          return this.格[i];
        };
        区拥有者.set(block, 我);
        held.push(block);
        return block;
      },
      // 交给托管区：从此不随 close 死。同一条记录交回去，正是「不移动」那条规矩的样子。
      freeze: (b) => {
        要活块(b, "arena.freeze");
        if (区拥有者.get(b) !== 我) rt.fail("HMYR-R0302", "arena.freeze was given a block this arena does not own");
        b.zone = "managed";
        区拥有者.delete(b);
        const i = held.indexOf(b);
        if (i >= 0) held.splice(i, 1);
        return b;
      },
      // 收回本区：从此随 close 死。已经属于另一个活着的区就拒绝 —— 那一块的寿命会被两处同时拥有。
      adopt: (b) => {
        要活块(b, "arena.adopt");
        const 主人 = 区拥有者.get(b);
        if (主人 !== undefined && 主人 !== 我 && 区活着.has(主人)) {
          rt.fail("HMYR-R0303", "arena.adopt was given a block owned by another open arena: its lifetime would be owned twice");
        }
        b.zone = "arena";
        区拥有者.set(b, 我);
        if (!held.includes(b)) held.push(b);
        return b;
      },
      close: () => {
        for (const b of held) { b.live = false; 区拥有者.delete(b); }
        held.length = 0;
        区活着.delete(我);
        return null;
      },
      held: () => held.length,
    };
  },
  // owned：三区里那个「单一所有者」（design/MEMORY.txt 第 2 节）。
  //
  // 一个持有格只装零个或一个值，取出即转移 —— 取走之后源那边空了，于是
  // 「两个变量都声称拥有它」在运行期不成立。这是「单一所有者」能落的最小形状：
  // 作用域结束不会自动释放（语言没有作用域钩子），编译期也不检查转移（那要借用分析）。
  //
  // 方法用中文，与块的 存/取 同一条命名；arena 那五个是英文，因为它们是先来的。
  owned: (rt) => {
    const 格 = { 装: false, 值: null, 关了: false };
    格.放 = function (v) {
      if (this.关了) rt.fail("HMYR-R0305", "owned.放: this holder is already closed");
      if (this.装) rt.fail("HMYR-R0305", "owned.放: this holder already owns a value; take it out first");
      this.装 = true;
      this.值 = v;
      return this;
    };
    格.取 = function () {
      if (this.关了) rt.fail("HMYR-R0305", "owned.取: this holder is already closed");
      if (!this.装) rt.fail("HMYR-R0306", "owned.取: this holder is empty");
      const v = this.值;
      this.装 = false;
      this.值 = null;
      return v;
    };
    格.有 = function () { return this.装; };
    格.关 = function () {
      this.装 = false;
      this.值 = null;
      this.关了 = true;
      return null;
    };
    return 格;
  },
};

export function run(source, options = {}) {
  const lexed = lex(source, options);
  const { ast: 未展开, diagnostics } = parse(lexed.tokens, { diagnostics: lexed.diagnostics });
  if (diagnostics.errors.length) return { output: [], diagnostics, value: null };
  // 宏在解析之后、执行之前展开（src/expand.mjs）。没有宏的模块原样通过。
  // 展开期的错算语法那一类：它是「这段源码的形状不对」，不是运行到一半才出事。
  let ast;
  try {
    ast = 展开模块(未展开);
  } catch (e) {
    diagnostics.error("HMYR-E0103", String(e.message).replace(/^HMYR-E0103\s*/, ""), 0, 0);
    return { output: [], diagnostics, value: null };
  }
  const rt = new Runtime(options);
  let value = null;
  try {
    value = rt.run(ast);
  } catch (e) {
    if (e.code) diagnostics.error(e.code, e.message, 0, 0);
    // last resort: if the host stack went first anyway, say it in the language's own terms
    else if (e instanceof RangeError) diagnostics.error("HMYR-R0108", "call depth exceeded");
    else throw e;
  }
  return { output: rt.output, diagnostics, value };
}

// 这一份文件不再有 CLI 尾部：那段「node eval.mjs <file>」搬到了 bin/run-eval.mjs。
//
// 搬的理由是它一直不属于库：一个库的最后十几行若是「读一个文件、打印用法、按退出码退出」，
// 那它就不是库的一部分，而是这个文件顺带当命令用的那一面。留着它，求值器就得 import fs，
// 而那条 import 会让「求值器不借世界」这句话永远差一点。

