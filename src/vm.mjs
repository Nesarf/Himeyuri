// 字节码的执行器：一条扁平的指令序列 + 一个循环。
//
// 它与 src/minimal-eval.mjs 认同一张表（11 种表达式、5 种语句、21 个内置），
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
  if (v && v.tag === "array") return "array";
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
    // 名字到「第几个」的对照：调用序列要靠它跨机器对齐，因为名字多是中文。
    this.名序 = new Map();
    let 位 = 0;
    for (const 键 of 程序.函数们.keys()) this.名序.set(键, 位++);
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
    if (v && (v.tag === "tuple" || v.tag === "array")) return "[" + v.items.map((x) => this.成串(x)).join(", ") + "]";
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
      if (迹要) { 迹.push({ pc, op: 指令.op, n: 栈.length }); if (迹.length > 迹长) 迹.shift(); }
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
          // 数组 + 什么 都拼成一个新元组：+ 从来不就地改，这是它和 设 的分界。
          if (a && b && (a.tag === "tuple" || a.tag === "array") && (b.tag === "tuple" || b.tag === "array")) 压(new 类元组([...a.items, ...b.items]));
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
          if (域要) {
            // 与 C 那台同一行格式：pc、记录字段数、命中第几个、名字的码元，以及那个值的种类。
            let 位 = -1, k = 0;
            for (const 键 of t.fields.keys()) { if (键 === 指令.a) { 位 = k; break; } k++; }
            let 码 = "";
            for (let q = 0; q < 指令.a.length && q < 8; q++) 码 += 指令.a.charCodeAt(q).toString(16).padStart(4, "0");
            let 值类 = "?";
            if (位 >= 0) {
              const v = [...t.fields.values()][位];
              // 判类型要走这门语言自己的帮手，不在这里写 typeof ——
              // test/numbers 与 test/text 两条都在盯这件事。
              if (v && v.tag === "tuple") 值类 = "tuple";
              else if (v && v.tag === "array") 值类 = "array";
              else if (v && v.tag === "record") 值类 = "record";
              else if (数.是数(v)) 值类 = "num";
              else if (this.文.是串(v)) 值类 = "str";
              else if (v === true || v === false) 值类 = "bool:" + (v ? 1 : 0);
              else 值类 = "null";
            }
            process.stderr.write("EV " + 事件号() + " FIELD pc=" + pc + " n=" + t.fields.size + " i=" + 位 + " name=" + 码 + " val=" + 值类 + "\n");
          }
          压(t.fields.get(指令.a));
          pc++; break;
        }
        case "INDEX": {
          const i = this.成数(弹()), t = 弹();
          if (this.文.是串(t)) {
            if (!this.文.在界内(t, i)) { this.坏("HMYR-R0151", "index " + 数.成文(i) + " is outside a value of length " + this.文.长(t)); return null; }
            压(this.文.元(t, i));
          } else if (t && (t.tag === "tuple" || t.tag === "array")) {
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
          if (叫要 && 叫数 < 叫上限) { process.stderr.write("EV " + 事件号() + " CALLB " + 指令.a + " n=" + n + "\n"); 叫数++; }
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
          if (叫要 && 叫数 < 叫上限) {
            // 与 C 那台同一行：事件号、被调者位置、调用前的栈深、实参数。
            // 栈深是这一轮最要紧的一列 —— 它两边第一次不同，就说明那一步多压了东西。
            let 类们 = "";
            for (let q = 栈.length - n; q < 栈.length; q++) {
              const a = 栈[q];
              if (a && (a.tag === "tuple" || a.tag === "array")) 类们 += " 4";
              else if (a && a.tag === "record") 类们 += " 5";
              else if (数.是数(a)) 类们 += " 1";
              else if (this.文.是串(a)) 类们 += " 2";
              else if (a === true || a === false) 类们 += " 3";
              else 类们 += " 0";
            }
            process.stderr.write("EV " + 事件号() + " CALL " + this.名序.get(指令.a) + " sn=" + 栈.length + " n=" + n + " tags=" + 类们 + "\n");
            叫数++;
          }
          const 实参 = 栈.splice(栈.length - n, n);
          // 尾调用：下一条指令就是 RET 时，换掉这一帧而不是压新的。
          //
          // 这是解释器里那条规矩（src/eval.mjs 的 TailCall）搬到显式栈上：调用者的返回值
          // 就是被调者的返回值，中间那一层不需要存在。于是尾递归不再吃 JS 栈 ——
          // 而 tokenize 那样的「每读一个 token 递归一次」正是靠这一点才跑得动一千多层。
          //
          // 效果与参数数的检查照做：省掉的是帧，不是规矩。
          if (码[pc + 1] && 码[pc + 1].op === "RET") {
            const 函 = this.程序.函数们.get(指令.a);
            if (!函) { this.坏("HMYR-R0104", "there is no name '" + 指令.a + "' in scope"); return null; }
            for (const 效 of 函.效果) {
              if (!帧.效果.has(效)) {
                this.坏("HMYR-R0201", "function '" + 指令.a + "' uses effect '" + 效 + "', which the caller did not declare");
                return null;
              }
            }
            if (实参.length !== 函.参数量) {
              this.坏("HMYR-R0101", "function '" + 指令.a + "' expects " + 函.参数量 + " argument(s), got " + 实参.length);
              return null;
            }
            帧.槽 = new Array(函.槽数).fill(null).map(() => ({ v: null, 可写: true }));
            for (let i = 0; i < 实参.length; i++) 帧.槽[i] = { v: 实参[i], 可写: true };
            帧.效果 = new Set(函.效果);
            码 = 函.码;
            pc = 0;
            栈.length = 0;
            continue;
          }
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

// 一条轨迹：最近几十条指令的 pc、操作码与当时的栈深。
//
// 为什么要有它：C 那台机器有一份（vm/hmyr.c 的 HMYR_TRACE），而两台机器跑同一份
// 字节码若得出不同结果，唯一能问的问题是「从哪一条指令开始不一样」。
// 没有轨迹时，这个问题只能靠猜；有了它，两条 dump 一贴就能对齐。
//
// 默认关着：它每一步都要写一次，跑一个大程序会慢一倍。
const 迹 = [];
const 迹要 = process.env.HMYR_TRACE ? true : false;
const 迹长 = 40;

// 调用序列：每次 CALLF / CALLB 打印一个序号。两台机器跑同一份字节码时，
// 第一条不一致的调用就是分歧的起点 —— 而函数名多是中文，C 那边打不好，
// 所以两边都打「函数在表里的位置」，那个数字是共同的。
const 叫要 = process.env.HMYR_CALLS ? true : false;
// 字段读取的影子输出：与 C 那台的 HMYR_FIELDS 一行一条对齐。
const 域要 = process.env.HMYR_FIELDS ? true : false;
let 叫数 = 0;
const 叫上限 = 200000;
// 事件号：字段读取与每一次调用共用一条递增序号，与 C 那台的 g_ev 对齐。
let 事件计数 = 0;
const 事件号 = () => 事件计数++;

export const 迹输出 = () => {
  if (!迹要) return;
  for (const t of 迹) console.log("  pc=" + String(t.pc).padEnd(6) + " n=" + String(t.n).padEnd(5) + " " + t.op);
};
//
// 一个真实的差别：加载器交回的是「按依赖顺序排好的模块」，而这里把它们的函数表并起来。
// 重名先到者赢（加载器那边已经为这件事报过 W0302）。
//
// 但「先到者赢」对 main 不成立：依赖排在前面，被加载的主文件排在最后，
// 于是 self/verify.hmyr 的 main 会输给它 import 的 sha256.hmyr 的自测 main ——
// 跑了半天，输出的是别人算出来的哈希。所以入口那一份要显式交上去。
export const 跑字节码 = (unit, 选项 = {}) => {
  const 几份 = unit.order.map((文件) => 编译模块(unit.modules.get(文件)));
  const 入口份 = 几份.length > 0 ? 几份[几份.length - 1] : null;
  return new 虚拟机(合并程序(几份, 入口份), 选项);
};
