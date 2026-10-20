// 字节码的执行器：一条扁平的指令序列 + 一个循环。
//
// 它与 src/minimal-eval.mjs 认同一张表（11 种表达式、5 种语句、16 个内置），
// 差别只在执行模型：那边递归走树，这边在一个循环里读指令。前者吃宿主栈，后者不吃。
//
// 这是 SELFRUN 第三层的第一格，而它的定位要说清：**它还没有让执行器摆脱高级宿主。**
// 它仍在 JS 里跑，仍用 JS 的数组与对象当值。这一格证明的是「执行模型能换成扁平的」——
// 而那正是把自己的机器层接上来的前提：一个循环能交给一台机器，一棵树不能。
//
// 值仍是宿主的四种（数、串、布尔、null）加元组（数组）与记录（对象）。
// 换成自己的表示是后面的事，写在 design/VM.txt 里，不假装已经做了。
import { 内置表 } from "./vm-builtins.mjs";
import { 编译模块, 合并程序 } from "./bytecode.mjs";

class 运行错 extends Error {
  constructor(码, 话) { super(话); this.code = 码; }
}

// 语义辅助：与 minimal-eval 完全一致，因为它们定义的是这门语言的意思，不是实现细节。
const 述 = (v) => {
  if (v === null) return "nil";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "tuple";
  if (typeof v === "object") return "a host object";
  return String(v);
};
const 真 = (v) => !(v === false || v === null || v === 0 || v === "");

export class 虚拟机 {
  constructor(程序, 选项 = {}) {
    this.程序 = 程序;
    this.全局 = new Map();
    this.write = 选项.write || (() => {});
    this.writeErr = 选项.writeErr || null;
    this.argv = 选项.argv || [];
    this.cap = 选项.capabilities;
    if (!this.cap) throw new Error("虚拟机需要一份能力（见 src/capabilities.mjs）");
    this.步 = 0;
    this.步限 = 选项.stepLimit || 5_000_000;
    this.深限 = 选项.maxDepth || 500;
    this.深 = 0;
    this.输出 = [];
  }

  坏(码, 话) { throw new 运行错(码, 话); }

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
  相等(a, b) { return typeof a === typeof b ? a === b : this.成串(a) === this.成串(b); }
  比(a, b) {
    if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
    if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
    this.坏("HMYR-R0131", "cannot compare " + 述(a) + " with " + 述(b));
  }

  // 调一个函数：建一帧，跑它的指令段，交回它的返回值。
  调用(名, 实参, 调用者效果) {
    const 函 = this.程序.函数们.get(名);
    if (!函) this.坏("HMYR-R0104", "there is no name '" + 名 + "' in scope");
    if (++this.深 > this.深限) this.坏("HMYR-R0108", "call depth exceeded (" + this.深限 + ")");
    try {
      // 效果：被调者声明的不能比调用者声明的多。
      if (调用者效果) {
        for (const 效 of 函.效果) {
          if (!调用者效果.has(效)) {
            this.坏("HMYR-R0201", "function '" + 名 + "' uses effect '" + 效 + "', which the caller did not declare");
          }
        }
      }
      if (实参.length !== 函.参数量) {
        this.坏("HMYR-R0101", "function '" + 名 + "' expects " + 函.参数量 + " argument(s), got " + 实参.length);
      }
      const 帧 = { 槽: new Array(函.槽数).fill(null).map(() => ({ v: null, 可写: true })), 效果: new Set(函.效果) };
      for (let i = 0; i < 实参.length; i++) 帧.槽[i] = { v: 实参[i], 可写: true };
      return this.执行(函.码, 帧);
    } finally { this.深--; }
  }

  // 解释循环。返回值靠一个专门的退出：RET 直接 return。
  执行(码, 帧) {
    const 栈 = [];
    let pc = 0;
    const 弹 = () => 栈.pop();
    const 压 = (v) => { 栈.push(v); };
    for (;;) {
      if (++this.步 > this.步限) this.坏("HMYR-R0102", "the program ran for too long without finishing");
      const 指令 = 码[pc];
      if (!指令) this.坏("HMYR-R0110", "the instruction stream ran off its end");
      switch (指令.op) {
        case "CONST": 压(指令.a); pc++; break;
        case "LOAD": 压(帧.槽[指令.a].v); pc++; break;
        case "STORE": 帧.槽[指令.a] = { v: 弹(), 可写: 指令.b === true }; pc++; break;
        case "ASSIGN": {
          const 槽 = 帧.槽[指令.a];
          const v = 弹();
          if (!槽.可写) this.坏("HMYR-R0150", "cannot assign to a name that was not declared with var");
          槽.v = v;
          pc++; break;
        }
        case "POP": 弹(); pc++; break;
        case "GLOBAL": {
          if (!this.全局.has(指令.a)) this.坏("HMYR-R0104", "there is no name '" + 指令.a + "' in scope");
          压(this.全局.get(指令.a)); pc++; break;
        }
        case "BOOL": 压(真(弹())); pc++; break;
        case "NEG": 压(-this.成数(弹())); pc++; break;
        case "NOT": 压(!真(弹())); pc++; break;
        case "ADD": { const b = 弹(), a = 弹();
          if (Array.isArray(a) && Array.isArray(b)) 压([...a, ...b]);
          else if (typeof a === "string" || typeof b === "string") 压(this.成串(a) + this.成串(b));
          else 压(this.成数(a) + this.成数(b));
          pc++; break; }
        case "SUB": { const b = 弹(), a = 弹(); 压(this.成数(a) - this.成数(b)); pc++; break; }
        case "MUL": { const b = 弹(), a = 弹(); 压(this.成数(a) * this.成数(b)); pc++; break; }
        case "DIV": { const b = 弹(), a = 弹();
          if (this.成数(b) === 0) this.坏("HMYR-R0120", "division by zero");
          压(this.成数(a) / this.成数(b)); pc++; break; }
        case "MOD": { const b = 弹(), a = 弹();
          if (this.成数(b) === 0) this.坏("HMYR-R0120", "division by zero");
          压(this.成数(a) % this.成数(b)); pc++; break; }
        case "EQ": { const b = 弹(), a = 弹(); 压(this.相等(a, b)); pc++; break; }
        case "NE": { const b = 弹(), a = 弹(); 压(!this.相等(a, b)); pc++; break; }
        case "LT": { const b = 弹(), a = 弹(); 压(this.比(a, b) < 0); pc++; break; }
        case "LE": { const b = 弹(), a = 弹(); 压(this.比(a, b) <= 0); pc++; break; }
        case "GT": { const b = 弹(), a = 弹(); 压(this.比(a, b) > 0); pc++; break; }
        case "GE": { const b = 弹(), a = 弹(); 压(this.比(a, b) >= 0); pc++; break; }
        case "JMP": pc = 指令.a; break;
        case "JMPF": if (!真(弹())) pc = 指令.a; else pc++; break;
        case "JMPT": if (真(弹())) pc = 指令.a; else pc++; break;
        // 短路那两个：跳走时**不弹**——栈上留着的就是整个表达式的值（再转成布尔）。
        case "JMPF_KEEP": if (!真(栈[栈.length - 1])) pc = 指令.a; else { 弹(); pc++; } break;
        case "JMPT_KEEP": if (真(栈[栈.length - 1])) pc = 指令.a; else { 弹(); pc++; } break;
        case "TUPLE": {
          const n = 指令.a;
          const 项 = 栈.splice(栈.length - n, n);
          压(项);
          pc++; break;
        }
        case "RECORD": {
          const 名们 = 指令.a;
          const 值们 = 栈.splice(栈.length - 名们.length, 名们.length);
          const 记 = {};
          for (let i = 0; i < 名们.length; i++) 记[名们[i]] = 值们[i];
          压(记);
          pc++; break;
        }
        case "FIELD": {
          const t = 弹();
          if (t === null || typeof t !== "object" || !(指令.a in t)) this.坏("HMYR-R0106", "no field '" + 指令.a + "' on that value");
          压(typeof t[指令.a] === "function" ? t[指令.a].bind(t) : t[指令.a]);
          pc++; break;
        }
        case "INDEX": {
          const i = this.成数(弹()), t = 弹();
          if (typeof t !== "string" && !Array.isArray(t)) this.坏("HMYR-R0152", "cannot index " + 述(t));
          if (i < 0 || i >= t.length) this.坏("HMYR-R0151", "index " + i + " is outside a value of length " + t.length);
          压(t[i]);
          pc++; break;
        }
        case "CALLB": {
          const n = 指令.b;
          const 实参 = 栈.splice(栈.length - n, n);
          const 内置项 = 内置表[指令.a];
          if (!内置项) this.坏("HMYR-R0104", "there is no builtin '" + 指令.a + "'");
          if (内置项.效果 && !(帧.效果 instanceof Set && 帧.效果.has(内置项.效果))) {
            this.坏("HMYR-R0201", "builtin '" + 指令.a + "' needs effect '" + 内置项.效果 + "', which the caller did not declare");
          }
          const 结果 = 内置项.做(this, 实参);
          压(结果 === undefined ? null : 结果);
          pc++; break;
        }
        case "CALLF": {
          const n = 指令.b;
          const 实参 = 栈.splice(栈.length - n, n);
          压(this.调用(指令.a, 实参, 帧.效果));
          pc++; break;
        }
        case "RET": return 弹();
        default: this.坏("HMYR-R0110", "cannot execute the opcode " + 指令.op);
      }
    }
  }
}

// 与 runUnit 同一件事：把加载器交出来的模块编译成一个程序，再交回一个虚拟机。
//
// 注意一个真实的差别：加载器交回的是「按依赖顺序排好的模块」，而这里把它们的函数表并起来。
// 重名先到者赢（加载器那边已经为这件事报过 W0302）。
export const 跑字节码 = (unit, 选项 = {}) => {
  const 几份 = unit.order.map((文件) => 编译模块(unit.modules.get(文件)));
  const 程序 = 合并程序(几份);
  return new 虚拟机(程序, 选项);
};

