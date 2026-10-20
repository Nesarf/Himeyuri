// 字节码的执行器：一条扁平的指令序列 + 一个循环。
//
// 它与 src/minimal-eval.mjs 认同一张表（11 种表达式、5 种语句、16 个内置），
// 差别只在执行模型：那边递归走树，这边在一个循环里读指令。前者吃宿主栈，后者不吃。
//
// 这一版把「聚合值」收成自己的两种：元组与记录不再借用 JS 的数组与对象，而是两个带标签的
// 东西（见下面的 类元组 / 类记录）。于是 VM 判断一个值是什么，靠它自己的标签，
// 不再靠 Array.isArray 与 instanceof——那两样问的是「宿主怎么看它」，这里要问「它是什么」。
//
// 还没换掉的：数字、字符串、布尔、null 仍是宿主的标量（它们就是这些标量，换掉没有意义）；
// 而错误仍靠 JS 的 throw 传播。那两样写在 design/VM.txt 的「还没做的」里，不假装做了。
import { 内置表 } from "./vm-builtins.mjs";
import { 编译模块, 合并程序 } from "./bytecode.mjs";

// 值：两种聚合值自己带标签（定义在 src/vm-values.mjs，内置表也要用同一份）。
import { 类元组, 类记录 } from "./vm-values.mjs";
export { 类元组, 类记录 };

class 运行错 extends Error {
  constructor(码, 话) { super(话); this.code = 码; }
}

// 语义辅助：与 minimal-eval 一致，因为它们定义的是这门语言的意思，不是实现细节。
// 一处细节要对齐：宿主那边 describe 一个记录会得到 "a host object"，
// 而错误消息是照着那句写的——所以这里的记录也报同一句话。
const 述 = (v) => {
  if (v === null) return "nil";
  if (typeof v === "string") return JSON.stringify(v);
  if (v && v.tag === "tuple") return "tuple";
  if (v && v.tag === "record") return "a host object";
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
    if (v && v.tag === "tuple") return "[" + v.items.map((x) => this.成串(x)).join(", ") + "]";
    return String(v);          // 记录走这一步，与宿主那边 String(obj) 相同
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

  // 解释循环。返回值靠 RET 直接 return。
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
          if (a && b && a.tag === "tuple" && b.tag === "tuple") 压(new 类元组([...a.items, ...b.items]));
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
        // 短路那两个：跳走时不弹栈——栈上留着的就是整个表达式的值（下一句 BOOL 转成布尔）。
        case "JMPF_KEEP": if (!真(栈[栈.length - 1])) pc = 指令.a; else { 弹(); pc++; } break;
        case "JMPT_KEEP": if (真(栈[栈.length - 1])) pc = 指令.a; else { 弹(); pc++; } break;
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
          if (!t || t.tag !== "record" || !t.fields.has(指令.a)) this.坏("HMYR-R0106", "no field '" + 指令.a + "' on that value");
          压(t.fields.get(指令.a));
          pc++; break;
        }
        case "INDEX": {
          const i = this.成数(弹()), t = 弹();
          if (typeof t === "string") {
            if (i < 0 || i >= t.length) this.坏("HMYR-R0151", "index " + i + " is outside a value of length " + t.length);
            压(t[i]);
          } else if (t && t.tag === "tuple") {
            if (i < 0 || i >= t.items.length) this.坏("HMYR-R0151", "index " + i + " is outside a value of length " + t.items.length);
            压(t.items[i]);
          } else {
            this.坏("HMYR-R0152", "cannot index " + 述(t));
          }
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
// 一个真实的差别：加载器交回的是「按依赖顺序排好的模块」，而这里把它们的函数表并起来。
// 重名先到者赢（加载器那边已经为这件事报过 W0302）。
export const 跑字节码 = (unit, 选项 = {}) => {
  const 几份 = unit.order.map((文件) => 编译模块(unit.modules.get(文件)));
  return new 虚拟机(合并程序(几份), 选项);
};
