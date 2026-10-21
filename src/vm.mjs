// 字节码的执行器：一条扁平的指令序列 + 一个循环。
//
// 它与 src/minimal-eval.mjs 认同一张表（11 种表达式、5 种语句、20 个内置），
// 差别只在执行模型：那边递归走树，这边在一个循环里读指令。前者吃宿主栈，后者不吃。
//
// 这一版又去掉一样借来的东西：错误不再靠 JS 的 throw 传播。VM 自己记一个「停机」，
// 解释循环每步开头看一眼，有就退出。于是控制流全在 VM 手里——它自己的循环、自己的闸、
// 自己的停机。这是第三层的意思：一个循环能交给一台机器，一个 throw 不能。
//
// 还没换掉的：数字、字符串、布尔、null 仍是宿主的标量（它们就是那些东西）。
// 写在 design/VM.txt 的「还没做的」里，不假装做了。
//
// 而数字的意思在 src/numbers.mjs 里有一处定义：执行器不再自己写裸算术，
// 也不再自己判断「这是不是数」。字符串的码元操作同理，在 src/text.mjs。
// 换掉标量那件事要改的就是这两份文件。
import { 内置表 } from "./vm-builtins.mjs";
import { 编译模块, 合并程序 } from "./bytecode.mjs";
import * as 数 from "./numbers.mjs";
import * as 文 from "./text.mjs";
import { 按选项取, 收进来 } from "./text-impl.mjs";

// 值：两种聚合值自己带标签（定义在 src/vm-values.mjs，内置表也要用同一份）。
import { 类元组, 类记录 } from "./vm-values.mjs";
export { 类元组, 类记录 };

// 语义辅助：与 minimal-eval 一致，因为它们定义的是这门语言的意思，不是实现细节。
// 一处细节要对齐：宿主那边 describe 一个记录会得到 "a host object"，
// 而错误消息是照着那句写的——所以这里的记录也报同一句话。
//
// 层的参数是「字符串的底」：默认宿主串，也可以是码元序列（src/text-impl.mjs）。
// 述 要把值写进一句话里，所以它得把那个底的字符串写成宿主串。
const 述 = (v, 层 = 文) => {
  if (v === null) return "nil";
  if (层.是串(v)) return JSON.stringify(层.成宿主(v));
  if (v && v.tag === "tuple") return "tuple";
  if (v && v.tag === "record") return "a host object";
  if (数.是数(v)) return 数.成文(v);
  return String(v);
};
const 真 = (v, 层 = 文) => {
  if (层 !== 文 && 层.是串(v)) return 层.长(v) !== 0;
  return !(v === false || v === null || v === 0 || v === "");
};

export class 虚拟机 {
  constructor(程序, 选项 = {}) {
    this.程序 = 程序;
    this.全局 = new Map();
    this.write = 选项.write || (() => {});
    this.writeErr = 选项.writeErr || null;
    this.argv = 选项.argv || [];
    this.cap = 选项.capabilities;
    if (!this.cap) throw new Error("虚拟机需要一份能力（见 src/capabilities.mjs）");
    // 字符串住在哪里：默认宿主串，打开之后是码元序列（src/text-impl.mjs）。
    // 与最小求值器用同一个选项名，于是两条执行路可以一起换。
    this.码元串 = 选项.字符串用码元序列 === true;
    this.文 = 按选项取(选项);
    this.步 = 0;
    this.步限 = 选项.stepLimit || 5_000_000;
    this.深限 = 选项.maxDepth || 500;
    this.深 = 0;
    // 停机：null 表示还在跑；否则是 { 码, 话 }。
    // 它就是「错误」在这台机器上的全部表示——一个标志，加上一条可以读的话。
    this.停机 = null;
  }

  // 登记一次失败。它不再抛：返回 null 是给调用处用的，好让那里写成
  //   return this.坏(...)
  // 于是「出错之后不该继续跑」这件事写在每一处，而不是靠一个异常替人记着。
  坏(码, 话) {
    if (!this.停机) this.停机 = { 码, 话 };
    return null;
  }

  成数(v) {
    const n = 数.收(v);
    if (n !== null) return n;
    this.坏("HMYR-R0130", "expected a number, found " + 述(v, this.文));
    return 0;                       // 停机之后这个值不会被用到，给个 0 免得算出 NaN
  }
  成串(v) {
    // 「一个值怎么写成一个字符串」：走到这一层就要落回宿主串，因为它是输出那一头。
    if (this.文.是串(v)) return this.文.成宿主(v);
    if (v === null) return "nil";
    if (v && v.tag === "tuple") return "[" + v.items.map((x) => this.成串(x)).join(", ") + "]";
    if (数.是数(v)) return 数.成文(v);
    return String(v);               // 记录走这一步，与宿主那边 String(obj) 相同
  }
  相等(a, b) {
    if (数.是数(a) && 数.是数(b)) return 数.同(a, b);
    if (this.文.是串(a) && this.文.是串(b)) return this.文.比(a, b) === 0;
    return typeof a === typeof b ? a === b : this.成串(a) === this.成串(b);
  }
  比(a, b) {
    if (数.是数(a) && 数.是数(b)) return 数.比(a, b);
    if (this.文.是串(a) && this.文.是串(b)) return this.文.比(a, b);
    this.坏("HMYR-R0131", "cannot compare " + 述(a, this.文) + " with " + 述(b, this.文));
    return 0;
  }

  // 调一个函数。交回的东西有两种形状，而调用者必须两种都看：
  //
  //   { ok: true, 值 }          正常返回
  //   { ok: false, 码, 话 }      停机
  //
  // 这一层不再抛，于是「失败」是一条要读的返回值，而不是一个要接的异常。
  调用(名, 实参, 调用者效果) {
    if (this.停机) return { ok: false, ...this.停机 };
    const 函 = this.程序.函数们.get(名);
    if (!函) { this.坏("HMYR-R0104", "there is no name '" + 名 + "' in scope"); return { ok: false, ...this.停机 }; }
    if (++this.深 > this.深限) {
      this.坏("HMYR-R0108", "call depth exceeded (" + this.深限 + ")");
      return { ok: false, ...this.停机 };
    }
    try {
      // 效果：被调者声明的不能比调用者声明的多。
      if (调用者效果) {
        for (const 效 of 函.效果) {
          if (!调用者效果.has(效)) {
            this.坏("HMYR-R0201", "function '" + 名 + "' uses effect '" + 效 + "', which the caller did not declare");
            return { ok: false, ...this.停机 };
          }
        }
      }
      if (实参.length !== 函.参数量) {
        this.坏("HMYR-R0101", "function '" + 名 + "' expects " + 函.参数量 + " argument(s), got " + 实参.length);
        return { ok: false, ...this.停机 };
      }
      const 帧 = { 槽: new Array(函.槽数).fill(null).map(() => ({ v: null, 可写: true })), 效果: new Set(函.效果) };
      for (let i = 0; i < 实参.length; i++) 帧.槽[i] = { v: 实参[i], 可写: true };
      const 值 = this.执行(函.码, 帧);
      return this.停机 ? { ok: false, ...this.停机 } : { ok: true, 值 };
    } finally { this.深--; }
  }

  // 解释循环。正常返回靠 RET（JS 的 return 仍然是这一条的路，它不表示失败）；
  // 失败靠 this.停机——每走一步看一次，有就交回 null。
  执行(码, 帧) {
    const 栈 = [];
    let pc = 0;
    const 弹 = () => 栈.pop();
    const 压 = (v) => { 栈.push(v); };
    for (;;) {
      if (this.停机) return null;
      if (++this.步 > this.步限) { this.坏("HMYR-R0102", "the program ran for too long without finishing"); return null; }
      const 指令 = 码[pc];
      if (!指令) { this.坏("HMYR-R0110", "the instruction stream ran off its end"); return null; }
      switch (指令.op) {
        // 字面量是编译期从宿主串来的，所以它进来时要落到选定的那种底上。
        case "CONST": 压(this.码元串 && typeof 指令.a === "string" ? 收进来(this.文, 指令.a) : 指令.a); pc++; break;
        case "LOAD": 压(帧.槽[指令.a].v); pc++; break;
        case "STORE": 帧.槽[指令.a] = { v: 弹(), 可写: 指令.b === true }; pc++; break;
        case "ASSIGN": {
          const 槽 = 帧.槽[指令.a];
          const v = 弹();
          if (!槽.可写) { this.坏("HMYR-R0150", "cannot assign to a name that was not declared with var"); return null; }
          槽.v = v;
          pc++; break;
        }
        case "POP": 弹(); pc++; break;
        case "GLOBAL": {
          if (!this.全局.has(指令.a)) { this.坏("HMYR-R0104", "there is no name '" + 指令.a + "' in scope"); return null; }
          压(this.全局.get(指令.a)); pc++; break;
        }
        case "BOOL": 压(真(弹(), this.文)); pc++; break;
        case "NEG": 压(数.反(this.成数(弹()))); pc++; break;
        case "NOT": 压(!真(弹(), this.文)); pc++; break;
        case "ADD": { const b = 弹(), a = 弹();
          if (a && b && a.tag === "tuple" && b.tag === "tuple") 压(new 类元组([...a.items, ...b.items]));
          // 拼接要在选定的那种底上做：先把这个值写成文本，再落到那层去。
          else if (this.文.是串(a) || this.文.是串(b)) 压(this.文.拼(收进来(this.文, this.成串(a)), 收进来(this.文, this.成串(b))));
          else 压(数.加(this.成数(a), this.成数(b)));
          pc++; break; }
        case "SUB": { const b = 弹(), a = 弹(); 压(数.减(this.成数(a), this.成数(b))); pc++; break; }
        case "MUL": { const b = 弹(), a = 弹(); 压(数.乘(this.成数(a), this.成数(b))); pc++; break; }
        case "DIV": { const b = 弹(), a = 弹();
          if (数.是零(this.成数(b))) { this.坏("HMYR-R0120", "division by zero"); return null; }
          压(数.除(this.成数(a), this.成数(b))); pc++; break; }
        case "MOD": { const b = 弹(), a = 弹();
          if (数.是零(this.成数(b))) { this.坏("HMYR-R0120", "division by zero"); return null; }
          压(数.余(this.成数(a), this.成数(b))); pc++; break; }
        case "EQ": { const b = 弹(), a = 弹(); 压(this.相等(a, b)); pc++; break; }
        case "NE": { const b = 弹(), a = 弹(); 压(!this.相等(a, b)); pc++; break; }
        case "LT": { const b = 弹(), a = 弹(); 压(this.比(a, b) < 0); pc++; break; }
        case "LE": { const b = 弹(), a = 弹(); 压(this.比(a, b) <= 0); pc++; break; }
        case "GT": { const b = 弹(), a = 弹(); 压(this.比(a, b) > 0); pc++; break; }
        case "GE": { const b = 弹(), a = 弹(); 压(this.比(a, b) >= 0); pc++; break; }
        case "JMP": pc = 指令.a; break;
        case "JMPF": if (!真(弹(), this.文)) pc = 指令.a; else pc++; break;
        case "JMPT": if (真(弹(), this.文)) pc = 指令.a; else pc++; break;
        // 短路那两个：跳走时不弹栈——栈上留着的就是整个表达式的值（下一句 BOOL 转成布尔）。
        case "JMPF_KEEP": if (!真(栈[栈.length - 1], this.文)) pc = 指令.a; else { 弹(); pc++; } break;
        case "JMPT_KEEP": if (真(栈[栈.length - 1], this.文)) pc = 指令.a; else { 弹(); pc++; } break;
        case "TUPLE": {
          const n = 指令.a;
          压(new 类元组(栈.splice(栈.length - n, n)));
          pc++; break;
        }
        case "RECORD": {
          const 名们 = 指令.a;
          const 值们 = 栈.splice(栈.length - 名们.length, 名们.length);
          const 字段 = new Map();
          for (let i = 0; i < 名们.length; i++) 字段.set(名们[i], 值们[i]);
          压(new 类记录(字段));
          pc++; break;
        }
        case "FIELD": {
          const t = 弹();
          if (!t || t.tag !== "record" || !t.fields.has(指令.a)) {
            this.坏("HMYR-R0106", "no field '" + 指令.a + "' on that value");
            return null;
          }
          压(t.fields.get(指令.a));
          pc++; break;
        }
        case "INDEX": {
          const i = this.成数(弹()), t = 弹();
          if (this.文.是串(t)) {
            if (!this.文.在界内(t, i)) { this.坏("HMYR-R0151", "index " + 数.成文(i) + " is outside a value of length " + this.文.长(t)); return null; }
            压(this.文.元(t, i));
          } else if (t && t.tag === "tuple") {
            if (i < 0 || i >= t.items.length) { this.坏("HMYR-R0151", "index " + 数.成文(i) + " is outside a value of length " + t.items.length); return null; }
            压(t.items[i]);
          } else {
            this.坏("HMYR-R0152", "cannot index " + 述(t, this.文));
            return null;
          }
          pc++; break;
        }
        case "CALLB": {
          const n = 指令.b;
          const 实参 = 栈.splice(栈.length - n, n);
          const 内置项 = 内置表[指令.a];
          if (!内置项) { this.坏("HMYR-R0104", "there is no builtin '" + 指令.a + "'"); return null; }
          if (内置项.效果 && !(帧.效果 instanceof Set && 帧.效果.has(内置项.效果))) {
            this.坏("HMYR-R0201", "builtin '" + 指令.a + "' needs effect '" + 内置项.效果 + "', which the caller did not declare");
            return null;
          }
          const 结果 = 内置项.做(this, 实参);
          if (this.停机) return null;
          压(结果 === undefined ? null : 结果);
          pc++; break;
        }
        case "CALLF": {
          const n = 指令.b;
          const 实参 = 栈.splice(栈.length - n, n);
          const r = this.调用(指令.a, 实参, 帧.效果);
          if (!r.ok) return null;
          压(r.值);
          pc++; break;
        }
        case "RET": return 弹();
        default: this.坏("HMYR-R0110", "cannot execute the opcode " + 指令.op); return null;
      }
    }
  }
}

// 与 runUnit 同一件事：把加载器交出来的模块编译成一个程序，再交回一个虚拟机。
//
// 一个真实的差别：加载器交回的是「按依赖顺序排好的模块」，而这里把它们的函数表并起来。
// 重名先到者赢（加载器那边已经为这件事报过 W0302）。
export const 跑字节码 = (unit, 选项 = {}) => {
  const 几份 = unit.order.map((文件) => 编译模块(unit.modules.get(文件)));
  return new 虚拟机(合并程序(几份), 选项);
};
