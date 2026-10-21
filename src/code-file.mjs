// .hmyrb：字节码落成一份文件，与把它读回来。
//
// 为什么要有这一份：HMYR 现在能解释 HMYR，可最底下那台是 JS 写的虚拟机。
// 要让这门语言不依赖宿主，得有一台不是 JS 的机器执行同一份字节码 ——
// 而两台机器要执行同一份东西，第一件事就是把那东西写成文件。
//
// 格式的全部约定都在这一个文件里（C 那一侧照着写一份读法即可）：
//
//   文件头    "HMYRB" + 版本 u16（当前 1）
//   函数数    u16
//   每个函数  名字（串）、参数量 u16、槽数 u16、效果数 u16 + 每个效果名（串）、
//             指令数 u32、每条指令：操作码 u8 + 立即数
//   全局数    u16，每个：名字（串）+ 值
//
//   串 = u16 长度 + 每字符 u16（UTF-16 码元，与语言里字符串的底一致）
//
// 值与语言里的值是同一套编码（tag 用一字节）：
//   0x00 空  0x01 数（f64 小端）  0x02 串  0x03 布尔（u8）  0x04 元组  0x05 记录
//
// 指令的立即数按操作码定，见 立即数长度表。整数一律小端。

export const 魔数 = [0x48, 0x4d, 0x59, 0x52, 0x42]; // "HMYRB"
export const 版本 = 1;

// 操作码：按名字排序之后编号。排序是为了「同一个名字永远是同一个号」——
// 将来加指令时新号追加在末尾，旧号不动，于是旧文件仍然读得进来。
export const 操作码表 = [
  "ADD", "ASSIGN", "BOOL", "CALLB", "CALLF", "CONST", "DIV", "EQ", "FIELD", "GE",
  "GLOBAL", "GT", "INDEX", "JMP", "JMPF", "JMPF_KEEP", "JMPT", "JMPT_KEEP", "LE",
  "LOAD", "LT", "MOD", "MUL", "NE", "NEG", "NOT", "POP", "RECORD", "RET", "STORE",
  "SUB", "TUPLE",
];

export const 码 = new Map(操作码表.map((名, i) => [名, i]));

// 立即数的形状：none | u16 | u32 | name | slot | store | record | call | value | tuple
export const 立即数形状 = {
  CONST: "value", LOAD: "u16", STORE: "store", ASSIGN: "u16", POP: "none",
  GLOBAL: "name", BOOL: "none", NEG: "none", NOT: "none",
  ADD: "none", SUB: "none", MUL: "none", DIV: "none", MOD: "none",
  EQ: "none", NE: "none", LT: "none", LE: "none", GT: "none", GE: "none",
  JMP: "u32", JMPF: "u32", JMPT: "u32", JMPF_KEEP: "u32", JMPT_KEEP: "u32",
  TUPLE: "u16", RECORD: "record", FIELD: "name", INDEX: "none",
  CALLB: "call", CALLF: "call", RET: "none",
};

class 写者 {
  constructor() { this.块 = []; }
  u8(v) { this.块.push(v & 0xff); }
  u16(v) { this.u8(v); this.u8(v >> 8); }
  u32(v) { this.u16(v & 0xffff); this.u16(Math.floor(v / 65536)); }
  f64(v) {
    const b = new DataView(new ArrayBuffer(8));
    b.setFloat64(0, v, true);
    for (let i = 0; i < 8; i++) this.u8(b.getUint8(i));
  }
  串(s) {
    const t = String(s);
    this.u16(t.length);
    for (let i = 0; i < t.length; i++) this.u16(t.charCodeAt(i));
  }
  值(v) {
    if (v === null || v === undefined) { this.u8(0x00); return; }
    if (typeof v === "boolean") { this.u8(0x03); this.u8(v ? 1 : 0); return; }
    if (typeof v === "number") { this.u8(0x01); this.f64(v); return; }
    if (typeof v === "string") { this.u8(0x02); this.串(v); return; }
    if (v && v.tag === "tuple") {
      this.u8(0x04); this.u16(v.items.length);
      for (const 项 of v.items) this.值(项);
      return;
    }
    if (v && v.tag === "record") {
      this.u8(0x05); this.u16(v.fields.size);
      for (const [名, 内] of v.fields) { this.串(名); this.值(内); }
      return;
    }
    throw new Error("写不进这份文件的值：" + String(v));
  }
  取() { return Uint8Array.from(this.块); }
}

class 读者 {
  constructor(字节) { this.字节 = 字节; this.at = 0; this.视 = new DataView(字节.buffer, 字节.byteOffset, 字节.byteLength); }
  要(n) { if (this.at + n > this.字节.length) throw new Error("文件在这里断了（偏移 " + this.at + "）"); }
  u8() { this.要(1); return this.字节[this.at++]; }
  u16() { this.要(2); const v = this.视.getUint16(this.at, true); this.at += 2; return v; }
  u32() { this.要(4); const v = this.视.getUint32(this.at, true); this.at += 4; return v; }
  f64() { this.要(8); const v = this.视.getFloat64(this.at, true); this.at += 8; return v; }
  串() {
    const n = this.u16();
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u16());
    return s;
  }
  值(元组工厂, 记录工厂) {
    const t = this.u8();
    if (t === 0x00) return null;
    if (t === 0x01) return this.f64();
    if (t === 0x02) return this.串();
    if (t === 0x03) return this.u8() === 1;
    if (t === 0x04) {
      const n = this.u16();
      const 项 = [];
      for (let i = 0; i < n; i++) 项.push(this.值(元组工厂, 记录工厂));
      return 元组工厂(项);
    }
    if (t === 0x05) {
      const n = this.u16();
      const 字段 = new Map();
      for (let i = 0; i < n; i++) { const 名 = this.串(); 字段.set(名, this.值(元组工厂, 记录工厂)); }
      return 记录工厂(字段);
    }
    throw new Error("不认的值标记：" + t);
  }
}

// 一个程序（编译模块 交回的形状）→ 一份字节。
export const 写程序 = (程序) => {
  const w = new 写者();
  for (const b of 魔数) w.u8(b);
  w.u16(版本);
  const 函数们 = [...程序.函数们.values()];
  w.u16(函数们.length);
  for (const 函 of 函数们) {
    w.串(函.名);
    w.u16(函.参数量);
    w.u16(函.槽数);
    w.u16(函.效果.length);
    for (const 效 of 函.效果) w.串(效);
    w.u32(函.码.length);
    for (const 指令 of 函.码) {
      const 号 = 码.get(指令.op);
      if (号 === undefined) throw new Error("不认的指令：" + 指令.op);
      w.u8(号);
      const 形 = 立即数形状[指令.op];
      if (形 === "u16") w.u16(指令.a);
      else if (形 === "u32") w.u32(指令.a);
      else if (形 === "name") w.串(指令.a);
      else if (形 === "slot") w.u16(指令.a);
      else if (形 === "store") { w.u16(指令.a); w.u8(指令.b ? 1 : 0); }
      else if (形 === "tuple") w.u16(指令.a);
      else if (形 === "record") {
        const 名们 = 指令.a;
        w.u16(名们.length);
        for (const 名 of 名们) w.串(名);
      } else if (形 === "call") { w.串(指令.a); w.u16(指令.b); }
      else if (形 === "value") w.值(指令.a);
    }
  }
  w.u16(程序.全局们.length);
  for (const 全 of 程序.全局们) { w.串(全.name); }
  return w.取();
};

// 一份字节 → 一个程序。元组与记录要由调用方给工厂：那是运行时自己的值类型，
// 这一层不该替它决定（vm.mjs 用类元组与类记录，测试里也可以用别的）。
export const 读程序 = (字节, 工厂) => {
  const r = new 读者(字节);
  for (const b of 魔数) {
    if (r.u8() !== b) throw new Error("这不是 .hmyrb 文件");
  }
  const 版 = r.u16();
  if (版 !== 版本) throw new Error("这份文件的版本是 " + 版 + "，这份读法只认 " + 版本);
  const 元组工厂 = (工厂 && 工厂.元组) || ((项) => ({ tag: "tuple", items: 项 }));
  const 记录工厂 = (工厂 && 工厂.记录) || ((字段) => ({ tag: "record", fields: 字段 }));
  const 函数数 = r.u16();
  const 函数们 = new Map();
  for (let i = 0; i < 函数数; i++) {
    const 名 = r.串();
    const 参数量 = r.u16();
    const 槽数 = r.u16();
    const 效果数 = r.u16();
    const 效果 = [];
    for (let j = 0; j < 效果数; j++) 效果.push(r.串());
    const 指令数 = r.u32();
    const 码列 = [];
    for (let j = 0; j < 指令数; j++) {
      const 号 = r.u8();
      const op = 操作码表[号];
      if (!op) throw new Error("不认的操作码：" + 号);
      const 形 = 立即数形状[op];
      const 指令 = { op };
      if (形 === "u16") 指令.a = r.u16();
      else if (形 === "u32") 指令.a = r.u32();
      else if (形 === "name") 指令.a = r.串();
      else if (形 === "store") { 指令.a = r.u16(); 指令.b = r.u8() === 1; }
      else if (形 === "tuple") 指令.a = r.u16();
      else if (形 === "record") {
        const n = r.u16();
        const 名们 = [];
        for (let k = 0; k < n; k++) 名们.push(r.串());
        指令.a = 名们;
      } else if (形 === "call") { 指令.a = r.串(); 指令.b = r.u16(); }
      else if (形 === "value") 指令.a = r.值(元组工厂, 记录工厂);
      码列.push(指令);
    }
    函数们.set(名, { 名, 参数量, 槽数, 效果, 码: 码列 });
  }
  const 全局数 = r.u16();
  const 全局们 = [];
  for (let i = 0; i < 全局数; i++) 全局们.push({ name: r.串() });
  return { 函数们, 全局们 };
};
