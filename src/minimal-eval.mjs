// 最小求值器：只做「跑 self/ 那六份」真正需要的事。
//
// 它认的范围是先量出来的一张表（design/BOOTSTRAP.txt 第九节，test/stage0-eval.test.mjs 钉着）：
//
//   表达式  十一种   Binary · Call · Field · Ident · If · Index · Literal · Record · Tuple · Unary · While
//   语句    五种     Assign · ExprStmt · Let · Return · Var
//   内置    十六个   argv · chr · field_get · field_has · file_exists · is_letter · is_mark · len ·
//                    nfc · print · print_err · read_text · record_new · slice · str · to_int
//
// 表外的节点与内置在这里不是「碰巧没实现」，而是抛并说清是哪一种。
// 那与宿主求值器的态度相反：宿主认得十八种节点，遇到不认的才报 R0110；
// 而这一份的立场是「我只需要这些，多的一概不认」——于是它自己就是那张表的执行体。
//
// 三条语义是照宿主抄的，因为它们在 self/ 那六份里是活的：
//
//   尾调用     return f(...) 不新压一帧，于是尾递归的深度不吃宿主栈。
//              没有这一条，self/run.hmyr 的递归在默认栈下就撞深度（那是当年真的踩过的事）。
//   效果      被调者做的不能比调用者声明的多（R0201）。内置也算：读文件属 file 组。
//   闸        深度（R0108）与步数（R0102）都是语言的，不该让宿主栈先崩。
//              步数还兼管「换函数」：纯尾递归每层不做一次求值，只换函数，不记步就会变成死循环。
//
// 值与类型用宿主的同一套（字符串、数字、布尔、null、数组当元组、对象当记录），
// 于是两个求值器在同一个程序上给出同一批值——对照才有意义。
const 步限 = 5_000_000;
const 深限 = 500;
const 循环闸 = 1000000;

// 一个绑定：值 + 可不可改。let 不可改、var 可改，而 assign 要走到「拥有这个名字」的那一层去改。
class 作用域 {
  constructor(parent) { this.map = new Map(); this.parent = parent; }
  has(name) { return this.map.has(name) || (this.parent ? this.parent.has(name) : false); }
  get(name) { return this.map.has(name) ? this.map.get(name).value : this.parent.get(name); }
  set(name, value, mutable = false) { this.map.set(name, { value, mutable }); }
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

export function 述(v) {
  if (v === null) return "nil";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "tuple";
  if (typeof v === "object") return "a host object";
  return String(v);
}

// 内置：只这十六个。实现照宿主的语义写，包括它们的失败编号。
const 内置 = {
  len: (rt, a) => {
    const v = a[0];
    if (typeof v === "string" || Array.isArray(v)) return v.length;
    rt.坏("HMYR-R0140", "len() wants a string or a tuple");
  },
  str: (rt, a) => rt.成串(a[0]),
  slice: (rt, a) => {
    const s = rt.成串(a[0]);
    const 起 = a[1] === undefined || a[1] === null ? 0 : Math.max(0, Math.floor(rt.成数(a[1])));
    const 止 = a[2] === undefined || a[2] === null ? s.length : Math.min(s.length, Math.floor(rt.成数(a[2])));
    return 起 >= 止 ? "" : s.slice(起, 止);
  },
  chr: (rt, a) => {
    const cp = Math.floor(rt.成数(a[0]));
    if (cp < 0 || cp > 0x10ffff) rt.坏("HMYR-R0207", "not a code point: " + cp);
    return String.fromCodePoint(cp);
  },
  to_int: (rt, a) => {
    const s = rt.成串(a[0]).trim();
    if (!/^-?[0-9]+$/.test(s)) rt.坏("HMYR-R0208", "not an integer literal: '" + s + "'");
    return Number(s);
  },
  nfc: (rt, a) => String(a[0]).normalize("NFC"),
  is_letter: (rt, a) => /\p{L}/u.test(String(a[0])),
  is_mark: (rt, a) => /\p{M}/u.test(String(a[0])),
  record_new: (rt, a) => {
    const pairs = a[0];
    if (!Array.isArray(pairs)) rt.坏("HMYR-R0214", "record_of wants a tuple of (name, value) pairs");
    const out = {};
    for (const p of pairs) {
      if (!Array.isArray(p) || p.length !== 2) rt.坏("HMYR-R0214", "every item must be a (name, value) pair");
      const k = rt.成串(p[0]);
      if (!/^[\p{L}_][\p{L}\p{N}\p{M}_]*$/u.test(k)) rt.坏("HMYR-R0214", "not a name a record could hold: " + JSON.stringify(k));
      out[k] = p[1];
    }
    return out;
  },
  field_get: (rt, a) => {
    const rec = a[0];
    const name = rt.成串(a[1]);
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) rt.坏("HMYR-R0215", "field_get wants a record, found " + 述(rec));
    if (!Object.prototype.hasOwnProperty.call(rec, name)) rt.坏("HMYR-R0216", "no field '" + name + "' on that record");
    return rec[name];
  },
  // 问「有没有」不是失败，于是它不给编号。
  field_has: (rt, a) => {
    const rec = a[0];
    const name = rt.成串(a[1]);
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) return false;
    return Object.prototype.hasOwnProperty.call(rec, name);
  },
  print: (rt, a) => { rt.write(a.map((x) => rt.成串(x)).join("")); return null; },
  print_err: (rt, a) => {
    const 文 = a.map((x) => rt.成串(x)).join("");
    if (rt.writeErr) rt.writeErr(文); else if (rt.write) rt.write(文);
    return null;
  },
  read_text: (rt, a) => {
    const 路径 = String(a[0]);
    let buf;
    try { buf = rt.读文件(路径); } catch (err) { rt.坏("HMYR-R0211", "cannot read '" + 路径 + "': " + String(err && err.message ? err.message : err)); }
    const enc = a[1] === undefined || a[1] === null ? null : rt.成串(a[1]);
    if (enc) {
      const 名 = String(enc).toLowerCase();
      if (名 === "utf8" || 名 === "utf-8") return buf.toString("utf8");
      if (名 === "utf16le" || 名 === "utf-16le") return new TextDecoder("utf-16le").decode(buf);
      if (名 === "latin1") return buf.toString("latin1");
      rt.坏("HMYR-R0212", "this runtime cannot decode '" + enc + "'");
    }
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
    return buf.toString("utf8");
  },
  file_exists: (rt, a) => {
    const 路径 = String(a[0]);
    try { return rt.有文件(路径); } catch (err) { return false; }
  },
  argv: (rt) => (rt.argv || []).map((x) => String(x)),
};

// 只有这四样碰世界。读文件与问文件在不在属 file，另两个通道属 process。
const 内置效果 = { read_text: "file", file_exists: "file", argv: "process", print_err: "process" };

class 尾调用 {
  constructor(decl, args, fromEffects) { this.decl = decl; this.args = args; this.fromEffects = fromEffects; }
}
class 返回 {
  constructor(value) { this.value = value; }
}

export class 最小运行时 {
  constructor(options = {}) {
    this.functions = new Map();
    this.globals = new Map();
    this.output = [];
    this.write = options.write || ((line) => this.output.push(line));
    this.writeErr = options.writeErr || null;
    this.argv = options.argv || [];
    this.steps = 0;
    this.depth = 0;
    this.maxDepth = options.maxDepth || 深限;
    this.stepLimit = options.stepLimit || 步限;
    // 读写文件交给调用方：一个求值器自己去碰 fs 就没法在别的地方用了。
    this.读文件 = options.readFile || ((p) => { throw new Error("no file reader configured: " + p); });
    this.有文件 = options.exists || (() => false);
  }

  // 宿主那边这个方法叫 callFunction；名字留着，于是两个求值器可以互换着跑同一段代码，
  // 而对照的代码不必写两遍。
  callFunction(decl, args, fromEffects) { return this.调用函数(decl, args, fromEffects); }
  registerModule(ast) { return this.登记模块(ast); }

  坏(code, message) {
    const e = new Error(message);
    e.code = code;
    throw e;
  }

  // 与宿主的 allowed 同一件事：没声明效果的函数，什么带效果的都不许调。
  允许(effects) { return new Set(effects || []); }

  登记模块(ast) {
    for (const decl of ast.decls) {
      if (decl.kind === "Fn") this.functions.set(decl.name, decl);
      else if (decl.kind === "Const") this.globals.set(decl.name, this.求值(decl.value, new 作用域(null), null));
    }
  }

  // 尾调用用循环吃掉，于是尾递归的深度不吃宿主栈。
  // 那一行「换函数也计一步」是必须的：纯尾递归每层不做一次求值，不记步就是死循环。
  调用函数(decl, args, fromEffects) {
    if (++this.depth > this.maxDepth) this.坏("HMYR-R0108", "call depth exceeded (" + this.maxDepth + ")");
    try {
      let 当前 = decl, 实参 = args, 效果 = fromEffects;
      for (;;) {
        try { return this.调用函数内(当前, 实参, 效果); }
        catch (e) {
          if (e instanceof 尾调用) {
            if (++this.steps > this.stepLimit) this.坏("HMYR-R0102", "the program ran for too long without finishing");
            当前 = e.decl; 实参 = e.args; 效果 = e.fromEffects;
            continue;
          }
          throw e;
        }
      }
    } finally { this.depth--; }
  }

  调用函数内(decl, args, fromEffects) {
    if (fromEffects) {
      for (const effect of decl.effects || []) {
        if (!fromEffects.has(effect)) {
          this.坏("HMYR-R0201", "function '" + decl.name + "' uses effect '" + effect + "', which the caller did not declare");
        }
      }
    }
    const scope = new 作用域(null);
    for (let i = 0; i < decl.params.length; i++) {
      const p = decl.params[i];
      let v;
      if (i < args.length) v = args[i];
      else if (p.fallback) v = this.求值(p.fallback, scope, null);
      else this.坏("HMYR-R0101", "function '" + decl.name + "' expects " + decl.params.length + " argument(s), got " + args.length);
      scope.set(p.name, v, false);
    }
    if (args.length > decl.params.length) {
      this.坏("HMYR-R0101", "function '" + decl.name + "' expects " + decl.params.length + " argument(s), got " + args.length);
    }
    const inner = this.允许(decl.effects);
    try {
      return decl.body ? this.执行块(decl.body, scope, inner) : null;
    } catch (e) {
      if (e instanceof 返回) return e.value;
      throw e;
    }
  }

  执行块(block, parentScope, effects) {
    const scope = new 作用域(parentScope);
    let last = null;
    for (const stmt of block.statements) last = this.执行语句(stmt, scope, effects);
    return last;
  }

  执行语句(stmt, scope, effects) {
    switch (stmt.kind) {
      case "Let": case "Var": {
        const value = this.求值(stmt.value, scope, effects);
        scope.set(stmt.name, value, stmt.kind === "Var");
        return value;
      }
      case "Assign": {
        const value = this.求值(stmt.value, scope, effects);
        if (!scope.assign(stmt.name, value)) {
          this.坏("HMYR-R0150", "cannot assign to '" + stmt.name + "': it is not a variable declared with var, or it is not in scope");
        }
        return value;
      }
      case "Return": {
        const v = stmt.value;
        // 尾位置：return f(...) 里那个调用不必保留这一层。只对被调的是这门语言的函数成立——
        // 内置不经过这条环，而 return 一个内置调用的结果本来也不占栈。
        if (v && v.kind === "Call" && v.callee.kind === "Ident" && this.functions.has(v.callee.name)) {
          const 实参 = v.args.map((a) => this.求值(a, scope, effects));
          throw new 尾调用(this.functions.get(v.callee.name), 实参, effects);
        }
        throw new 返回(v ? this.求值(v, scope, effects) : null);
      }
      case "ExprStmt": return this.求值(stmt.expr, scope, effects);
      default:
        throw new Error("最小求值器不认这种语句：'" + stmt.kind + "'");
    }
  }

  求值(node, scope, effects) {
    if (++this.steps > this.stepLimit) this.坏("HMYR-R0102", "the program ran for too long without finishing");
    if (!node || node.kind === "Error") this.坏("HMYR-R0103", "a syntax error reached the evaluator");
    switch (node.kind) {
      case "Literal": return node.value;
      case "Ident": {
        if (scope.has(node.name)) return scope.get(node.name);
        if (this.globals.has(node.name)) return this.globals.get(node.name);
        this.坏("HMYR-R0104", "there is no name '" + node.name + "' in scope");
        break;
      }
      case "Unary": {
        const v = this.求值(node.operand, scope, effects);
        return node.op === "-" ? -this.成数(v) : !this.真(v);
      }
      case "Binary": return this.二元(node, scope, effects);
      case "While": {
        // 循环用宿主的 while，于是深度不随迭代次数增长。
        let guard = 0;
        while (this.真(this.求值(node.condition, scope, effects))) {
          if (node.body) this.执行块(node.body, scope, effects);
          if (++guard > 循环闸) this.坏("HMYR-R0210", "a while loop ran past a million iterations without ending");
        }
        return null;
      }
      case "If": {
        const condition = this.求值(node.condition, scope, effects);
        if (this.真(condition)) return node.then ? this.执行块(node.then, scope, effects) : null;
        if (!node.otherwise) return null;
        return node.otherwise.kind === "Block" ? this.执行块(node.otherwise, scope, effects) : this.求值(node.otherwise, scope, effects);
      }
      case "Tuple": return node.items.map((n) => this.求值(n, scope, effects));
      case "Record": {
        const record = {};
        for (const field of node.fields) record[field.name] = this.求值(field.value, scope, effects);
        return record;
      }
      case "Field": {
        const target = this.求值(node.target, scope, effects);
        if (target === null || typeof target !== "object" || !(node.name in target)) {
          this.坏("HMYR-R0106", "no field '" + node.name + "' on that value");
        }
        return typeof target[node.name] === "function" ? target[node.name].bind(target) : target[node.name];
      }
      case "Index": {
        const target = this.求值(node.target, scope, effects);
        const index = this.成数(this.求值(node.index, scope, effects));
        if (typeof target !== "string" && !Array.isArray(target)) this.坏("HMYR-R0152", "cannot index " + 述(target));
        if (index < 0 || index >= target.length) this.坏("HMYR-R0151", "index " + index + " is outside a value of length " + target.length);
        return target[index];
      }
      case "Call": return this.调用(node, scope, effects);
      default:
        throw new Error("最小求值器不认这种表达式：'" + node.kind + "'");
    }
  }

  调用(node, scope, effects) {
    // 内置优先：这条规矩在宿主那里是刻意的（print 这类名字不该被变量遮蔽），这里照办。
    if (node.callee.kind === "Ident" && Object.prototype.hasOwnProperty.call(内置, node.callee.name)) {
      const name = node.callee.name;
      const need = 内置效果[name];
      if (need && !(effects instanceof Set && effects.has(need))) {
        this.坏("HMYR-R0201", "builtin '" + name + "' needs effect '" + need + "', which the caller did not declare");
      }
      const args = node.args.map((a) => this.求值(a, scope, effects));
      const result = 内置[name](this, args);
      return result === undefined ? null : result;
    }
    const args = node.args.map((a) => this.求值(a, scope, effects));
    if (node.callee.kind === "Ident") {
      const decl = this.functions.get(node.callee.name);
      if (decl) return this.调用函数(decl, args, effects);
    }
    const callee = this.求值(node.callee, scope, effects);
    if (typeof callee === "function") return callee(...args);
    this.坏("HMYR-R0107", "that value is not callable");
  }

  二元(node, scope, effects) {
    if (node.op === "&&") {
      const left = this.求值(node.left, scope, effects);
      return this.真(left) ? this.真(this.求值(node.right, scope, effects)) : false;
    }
    if (node.op === "||") {
      const left = this.求值(node.left, scope, effects);
      return this.真(left) ? true : this.真(this.求值(node.right, scope, effects));
    }
    const a = this.求值(node.left, scope, effects);
    const b = this.求值(node.right, scope, effects);
    switch (node.op) {
      case "+":
        // 元组相加是串接：那一条让描述能递归地长出来，而不是把每个元素都列一遍。
        if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
        if (typeof a === "string" || typeof b === "string") return this.成串(a) + this.成串(b);
        return this.成数(a) + this.成数(b);
      case "-": return this.成数(a) - this.成数(b);
      case "*": return this.成数(a) * this.成数(b);
      case "/":
        if (this.成数(b) === 0) this.坏("HMYR-R0120", "division by zero");
        return this.成数(a) / this.成数(b);
      case "%":
        if (this.成数(b) === 0) this.坏("HMYR-R0120", "division by zero");
        return this.成数(a) % this.成数(b);
      case "==": return this.相等(a, b);
      case "!=": return !this.相等(a, b);
      case "<": return this.比(a, b) < 0;
      case "<=": return this.比(a, b) <= 0;
      case ">": return this.比(a, b) > 0;
      case ">=": return this.比(a, b) >= 0;
      default: this.坏("HMYR-R0111", "no evaluation for operator " + node.op);
    }
  }

  成数(v) {
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    this.坏("HMYR-R0130", "expected a number, found " + 述(v));
  }
  成串(v) {
    if (typeof v === "string") return v;
    if (v === null) return "nil";
    if (Array.isArray(v)) return "[" + v.map((x) => this.成串(x)).join(", ") + "]";
    return String(v);
  }
  真(v) { return !(v === false || v === null || v === 0 || v === ""); }
  相等(a, b) { return typeof a === typeof b ? a === b : this.成串(a) === this.成串(b); }
  比(a, b) {
    if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
    if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
    this.坏("HMYR-R0131", "cannot compare " + 述(a) + " with " + 述(b));
  }
}

// 与宿主那个 runUnit 同一件事：把模块按依赖顺序登记进一个运行时，交回来给它跑。
export const 最小运行 = (unit, options = {}) => {
  const rt = new 最小运行时(options);
  for (const file of unit.order) rt.登记模块(unit.modules.get(file));
  return rt;
};
