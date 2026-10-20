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
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { 本机能力 } from "./capabilities.mjs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { lex } from "./lexer.mjs";
import { parse } from "./parser.mjs";

// 尾调用的标记：函数体最后一件事是调用另一个函数时，抛它而不是真的压栈。
//
// 为什么要它：一层函数调用在宿主那边要过好几帧栈，于是递归只能到九百多层。
// 而尾递归（f(n, acc) = f(n-1, ...) 这种）本来不需要保留任何东西——
// 于是那种形状可以跑到任意深，而不必换掉整个求值器。
class TailCall extends Error {
  // 带着抛出处的效果集：效果检查是「被调者不能比调用者多」，
  // 而换函数之后「调用者」就变了——那个集合必须跟着换，否则尾调用会变成一条绕过检查的路。
  constructor(decl, args, fromEffects) { super("tail"); this.decl = decl; this.args = args; this.fromEffects = fromEffects; }
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
const STAGE0_BUILTIN = new Set(["argv", "chr", "field_get", "field_has", "file_exists", "is_letter", "is_mark", "len", "nfc", "print", "print_err", "read_text", "record_new", "slice", "str", "to_int"]);

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
        const index = this.asNumber(this.evalExpr(node.index, scope, effects));
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
        return this.asNumber(a) + this.asNumber(b);
      case "-": return this.asNumber(a) - this.asNumber(b);
      case "*": return this.asNumber(a) * this.asNumber(b);
      case "/":
        if (this.asNumber(b) === 0) this.fail("HMYR-R0120", "division by zero");
        return this.asNumber(a) / this.asNumber(b);
      case "%":
        if (this.asNumber(b) === 0) this.fail("HMYR-R0120", "division by zero");
        return this.asNumber(a) % this.asNumber(b);
      case "==": return this.equal(a, b);
      case "!=": return !this.equal(a, b);
      case "<": return this.compare(a, b) < 0;
      case "<=": return this.compare(a, b) <= 0;
      case ">": return this.compare(a, b) > 0;
      case ">=": return this.compare(a, b) >= 0;
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
    if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
    if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
    this.fail("HMYR-R0131", "cannot compare " + describe(a) + " with " + describe(b));
  }
}

export function describe(v) {
  if (v === null) return "nil";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "tuple";
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

// A builtin that touches the outside world is a capability, and it is checked at the call site against
// what the calling function declared. Without this, "effects" would only apply to functions we wrote.
const BUILTIN_EFFECTS = { read_text: "file", write_text: "file", run_program: "process", chdir: "process", argv: "process", file_exists: "file", print_err: "process", thr_spawn: "thread", thr_cancel: "thread" };

/** 编码表按需读入并缓存：表是「字符 -> 字节」，从本运行时的解码器推出来的。 */
const ENCODING_TABLES = new Map();
function loadEncodingTable(enc) {
  if (ENCODING_TABLES.has(enc)) return ENCODING_TABLES.get(enc);
  let table = null;
  try {
    table = JSON.parse(fs.readFileSync(new URL("../deps/encodings/" + enc + ".json", import.meta.url), "utf8"));
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
import { Worker } from "node:worker_threads";
const THREADS = new Map();
let nextThreadId = 1;

// 仓库根：语言文件用的相对路径都以它为基准。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BUILTINS = {
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
  // ---- 十、线程 ----
  // thr_spawn 起一个 worker；thr_join 同步等它；thr_cancel 叫停；thr_count 数活着的。
  // 起与停要 thread 效果；等与数是读。
  thr_spawn: (rt, args) => {
    const source = rt.asString(args[0]);
    const entry = rt.asString(args[1]);
    const id = nextThreadId++;
    const outPath = path.join(os.tmpdir(), "hmyr-thread-" + process.pid + "-" + id + ".json");
    const flag = new Int32Array(new SharedArrayBuffer(4));
    const handle = { id, flag, outPath, done: false, worker: null };
    try {
      handle.worker = new Worker(new URL("./thr-worker.mjs", import.meta.url), {
        workerData: { source, entry, outPath, flag },
      });
    } catch (err) {
      // 起不来就交回 -1（一个无效句柄）。不用编号：那不是「拒绝」，是这个线程压根没出生，
      // 而调用方拿到 -1 之后 join 会得到 R0221——一条路，不是两条。
      return -1;
    }
    // 顺手把错误也记下来：不让一个起不来的线程把主线程一直挂着。
    handle.worker.on("error", () => { Atomics.store(handle.flag, 0, 9); Atomics.notify(handle.flag, 0); });
    // 不让一个还活着的线程拖住整个进程：宿主该退就退。
    if (typeof handle.worker.unref === "function") handle.worker.unref();
    handle.worker.on("exit", (code) => { if (Atomics.load(handle.flag, 0) === 0) { Atomics.store(handle.flag, 0, code === 0 ? 1 : 9); Atomics.notify(handle.flag, 0); } });
    THREADS.set(id, handle);
    return id;
  },
  thr_join: (rt, args) => {
    const id = Math.floor(rt.asNumber(args[0]));
    const h = THREADS.get(id);
    if (!h) rt.fail("HMYR-R0221", "no such thread handle: " + id);
    const timeout = args[1] === undefined || args[1] === null ? 30000 : Math.floor(rt.asNumber(args[1]));
    const 到 = Date.now() + timeout;
    while (Atomics.load(h.flag, 0) === 0) {
      const 剩 = 到 - Date.now();
      if (剩 <= 0) rt.fail("HMYR-R0222", "thread " + id + " did not finish within " + timeout + "ms");
      Atomics.wait(h.flag, 0, 0, Math.min(剩, 50));
    }
    let 结果 = null;
    try { 结果 = JSON.parse(fs.readFileSync(h.outPath, "utf8")); } catch (err) { 结果 = null; }
    try { fs.unlinkSync(h.outPath); } catch (err) { /* 没有就算了 */ }
    THREADS.delete(id);
    if (!结果) return "";
    return 结果.ok ? String(结果.text) : "";
  },
  thr_cancel: (rt, args) => {
    const id = Math.floor(rt.asNumber(args[0]));
    const h = THREADS.get(id);
    if (!h) rt.fail("HMYR-R0221", "no such thread handle: " + id);
    try { if (h.worker) h.worker.terminate(); } catch (err) { /* 已经没了就算停住 */ }
    try { fs.unlinkSync(h.outPath); } catch (err) { /* 同上 */ }
    THREADS.delete(id);
    return id;
  },
  thr_count: () => Array.from(THREADS.values()).filter((h) => Atomics.load(h.flag, 0) === 0).length,
  // ---- 五、环境（只读，不需要效果） ----
  // 仓库根：语言文件里不该写死绝对路径，否则换一台机器就坏。
  // 这一对内置把「仓库在哪」与「解释器在哪」收成两处，而不是散在各文件里。
  repo_path: (rt, args) => {
    const rel = rt.asString(args[0]);
    return path.resolve(ROOT, rel);
  },
  // 临时文件放哪儿：只有这一处说。缺省是系统临时目录，
  // 而 HMYR_TMP 可以把它指到别处——本机就把它指到 E: 上的缓存目录，以守那条磁盘纪律。
  temp_path: (rt, args) => {
    const 名 = rt.asString(args[0]);
    const 目录 = process.env.HMYR_TMP || os.tmpdir();
    try { fs.mkdirSync(目录, { recursive: true }); } catch (err) { /* 已经在就算了 */ }
    return path.join(目录, "hmyr-" + 名);
  },
  python_path: () => {
    // 先看环境变量（于是别的机器可以指自己的），再看这台机器上那个托管解释器，最后退回 PATH。
    if (process.env.HMYR_PYTHON) return process.env.HMYR_PYTHON;
    const 托管 = "E:/DaShaoHuo/Python-managed/bin/python.exe";
    if (fs.existsSync(托管)) return 托管;
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
    catch (err) { rt.fail("HMYR-R0211", "cannot read '" + 路径 + "': " + String(err && err.message ? err.message : err)); }
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
    const table = loadEncodingTable(enc);
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
    const result = spawnSync(command, rest, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
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
    try { process.chdir(target); return process.cwd(); }
    catch (err) { rt.fail("HMYR-R0209", "cannot enter '" + target + "': " + String(err && err.message ? err.message : err)); }
  },
  // ---- 五、环境（只读，不需要效果） ----
  cwd: () => process.cwd(),
  home_dir: () => os.homedir(),
  locale_env: () => {
    let region = "";
    try { region = new Intl.DateTimeFormat().resolvedOptions().locale || ""; } catch (err) { region = ""; }
    let page = "utf8";
    if (process.platform === "win32") {
      const r = spawnSync("cmd", ["/c", "chcp"], { timeout: 5000, windowsHide: true });
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

  console_codepage: () => {
    if (process.platform !== "win32") return "utf8";
    const r = spawnSync("cmd", ["/c", "chcp"], { timeout: 5000, windowsHide: true });
    const m = /(\d{3,5})/.exec(r.stdout ? r.stdout.toString("latin1") : "");
    return m ? m[1] : "unknown";
  },
  // ---- 字符串与字符的基本手术 ----
  // 这几个本是语言的常规能力，此前靠手写替代品绕过去（截/片段各一份、码位换成十项小表、
  // 大小写换成二十六项小表）。规矩改了：语言达不到就先补语言，不是绕。
  // 按分隔符切：i18n 处理的第一步就是按行切。
  // ---- 六、时间（不需要效果，但破坏可复现性） ----
  now_ms: () => Date.now(),
  sleep_ms: (rt, args) => { const ms = Math.max(0, Math.floor(rt.asNumber(args[0]))); if (ms > 0) { const until = Date.now() + ms; while (Date.now() < until) { /* 等 */ } } return ms; },
  floor: (rt, args) => Math.floor(rt.asNumber(args[0])),
  // ---- 七、终端（只返回字符串，一个字都不写出去） ----
  term_size: () => [process.stdout.rows || 24, process.stdout.columns || 80],
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
  key_read: () => {
    if (KEY_QUEUE.length) return KEY_QUEUE.shift();
    // 没有排队就读一次 stdin——同步读，raw 模式下它会阻塞到有键为止。
    // 为什么不用 'data' 事件：求值器是同步的，而 sleep_ms 是忙等，
    // 事件循环在那一刻是堵的，事件永远送不进来。同步读绕开了这件事。
    if (!process.stdin.isTTY) return "";
    try {
      const buf = Buffer.alloc(64);
      const n = fs.readSync(0, buf, 0, 64, null);
      if (n > 0) {
        for (const ch of buf.subarray(0, n).toString("utf8")) KEY_QUEUE.push(ch);
        return KEY_QUEUE.length ? KEY_QUEUE.shift() : "";
      }
    } catch (err) { /* 读不到就是没有键 */ }
    return "";
  },
  key_start: () => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") return false;
    try {
      process.stdin.setRawMode(true);
      return true;
    } catch (err) { return false; }
  },
  // 环境说该是哪一套：语言看 Intl 给的区域，编码看控制台代码页。
  // 组合出来不在名单里就返回空串——环境说的话我们没档案，就如实说没有，不退回默认。
  // ---- 九、内存（三区模型未实现前的宿主桩） ----
  arena: () => {
    const held = [];
    return {
      alloc: (n) => { const block = { size: typeof n === "number" ? n : 0, live: true }; held.push(block); return block; },
      close: () => { for (const b of held) b.live = false; held.length = 0; return null; },
      held: () => held.length,
    };
  },
};

export function run(source, options = {}) {
  const lexed = lex(source, options);
  const { ast, diagnostics } = parse(lexed.tokens, { diagnostics: lexed.diagnostics });
  if (diagnostics.errors.length) return { output: [], diagnostics, value: null };
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

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const file = process.argv[2];
  if (!file) { console.log("usage: node eval.mjs <file.hmyr>"); process.exit(1); }
  const result = run(fs.readFileSync(file, "utf8"), { path: file });
  for (const line of result.output) console.log(line);
  for (const d of result.diagnostics.items) console.log("  " + d.severity + " " + d.code + "  " + d.message);
  process.exit(result.diagnostics.errors.length ? 1 : 0);
}
