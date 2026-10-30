// 最小求值器：只做「跑 self/ 那六份」真正需要的事。
//
// 它认的范围是先量出来的一张表（design/BOOTSTRAP.txt 第九节，test/stage0-eval.test.mjs 钉着）：
//
//   表达式  十一种   Binary · Call · Field · Ident · If · Index · Literal · Record · Tuple · Unary · While
//   语句    五种     Assign · ExprStmt · Let · Return · Var
//   内置    十八个   argv · chr · field_get · field_has · file_exists · is_dir · is_letter · is_mark ·
//                    len · nfc · print · print_err · read_dir · read_text · record_new · slice · str · to_int
//
// 表外的节点与内置在这里不是「碰巧没实现」，而是抛并说清是哪一种。
// 那与宿主求值器的态度相反：宿主认得十八种节点，遇到不认的才报 HMYR-行-010；
// 而这一份的立场是「我只需要这些，多的一概不认」——于是它自己就是那张表的执行体。
//
// 三条语义是照宿主抄的，因为它们在 self/ 那六份里是活的：
//
//   尾调用     return f(...) 不新压一帧，于是尾递归的深度不吃宿主栈。
//              没有这一条，self/run.hmyr 的递归在默认栈下就撞深度（那是当年真的踩过的事）。
//   效果      被调者做的不能比调用者声明的多（HMYR-內-001）。内置也算：读文件属 file 组。
//   闸        深度（HMYR-行-009）与步数（HMYR-行-003）都是语言的，不该让宿主栈先崩。
//              步数还兼管「换函数」：纯尾递归每层不做一次求值，只换函数，不记步就会变成死循环。
//
// 值与类型用宿主的同一套（字符串、数字、布尔、null、数组当元组、对象当记录），
// 于是两个求值器在同一个程序上给出同一批值——对照才有意义。
//
// 而字符串的底可以换：选项 字符串用码元序列 打开之后，语言的字符串值是
// src/units.mjs 的码元序列，宿主串只在两处出现（字面量进来、输出出去）。
// 默认仍是宿主串 —— 与算术那两条路同一个安排：能换，而换不换由调用方说。
import * as 码元 from "./units.mjs";
import { 藏路径, 在用脱敏 } from "./redact.mjs";
import { 有序, 下整 } from "./numbers.mjs";
const 步限 = 5_000_000;
const 深限 = 500;

// 线程：这一份自己一张表。与 eval.mjs 的 THREADS 分开，因为两台求值器可能同时
// 跑在一个进程里，而句柄编号不该跨机器复用 —— 复用的话，一边 join 会把另一边
// 的线程等掉。
const THREADS = new Map();
let nextThreadId = 0;
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
  if (码元.是码元序列(v)) return JSON.stringify(码元.成宿主(v));
  if (Array.isArray(v)) return "tuple";
  if (typeof v === "object") return "a host object";
  return String(v);
}

// 内置：只这二十一个。实现照宿主的语义写，包括它们的失败编号。
// locale 的名字与当前选择：与字节码那一份同一组名字（design/LOCALES.txt）。
const locale名字们 = ["zh-CN.gbk", "zh-CN.utf8", "ja-JP.shift_jis", "en-US.utf8"];
let 当前locale = "";
// 键队列：与字节码那一份同一件事。
const 键队列 = [];

// 可变数组的标记：与原版解释器同一个约定（一个 symbol 属性）。
const 数组标 = "__hmyr_array";

// CRC32 的表：第一次算，之后一直用。二百五十六项，一次生成比每次循环里算便宜得多。
let 校验表缓存 = null;
const 校验表 = () => {
  if (校验表缓存) return 校验表缓存;
  const 表 = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    表[i] = c >>> 0;
  }
  校验表缓存 = 表;
  return 表;
};

const 内置 = {
  // CRC32（多吉性与 ZIP 都用它）。与宿主那一份同一套语义：
  // 收字节的元组，元素可以是一字节，也可以是一块（与 write_bytes 同一条规矩），
  // 交回一个 32 位无符号数。表第一次用时生成 —— 它是纯算术，
  // 不该为了它让宿主少一项自由（宿主依赖那张清单由 test/host-deps.test.mjs 盯着）。
  //
  // 这一条原来在最小求值器上根本不存在，于是带它的程序在默认跑法里会以
  // 「没有这个内置」停下 —— 而另外三台都有。examples/view-window.hmoca
  // 为此少写了半截演示，design/FFI.txt 第六节留着那条缺口。
  校验和: (rt, a) => {
    const 元组 = a[0];
    if (!Array.isArray(元组)) rt.坏("HMYR-行-013", "校验和 wants a tuple of bytes");
    const 表 = 校验表();
    let c = -1;
    const 吃一个 = (b) => { c = (c >>> 8) ^ 表[(c ^ (rt.成数(b) & 0xff)) & 0xff]; };
    for (const x of 元组) {
      if (Array.isArray(x)) { for (const y of x) 吃一个(y); } else 吃一个(x);
    }
    return (c ^ -1) >>> 0;
  },
  // 32 位位运算：与宿主那份同一套语义（无符号 32 位，移位按 31 取模）。
  位与: (rt, a) => Math.floor(rt.成数(a[0])) & Math.floor(rt.成数(a[1])),
  位或: (rt, a) => (Math.floor(rt.成数(a[0])) | Math.floor(rt.成数(a[1]))) >>> 0,
  位异或: (rt, a) => (Math.floor(rt.成数(a[0])) ^ Math.floor(rt.成数(a[1]))) >>> 0,
  位非: (rt, a) => (~Math.floor(rt.成数(a[0]))) >>> 0,
  位右移: (rt, a) => (Math.floor(rt.成数(a[0])) >>> (Math.floor(rt.成数(a[1])) & 31)) >>> 0,
  位加: (rt, a) => (Math.floor(rt.成数(a[0])) + Math.floor(rt.成数(a[1]))) >>> 0,
  位循环右移: (rt, a) => {
    const x = Math.floor(rt.成数(a[0])) >>> 0;
    const n = Math.floor(rt.成数(a[1])) & 31;
    return n === 0 ? x : ((x >>> n) | (x << (32 - n))) >>> 0;
  },
  位循环左移: (rt, a) => {
    const x = Math.floor(rt.成数(a[0])) >>> 0;
    const n = Math.floor(rt.成数(a[1])) & 31;
    return n === 0 ? x : ((x << n) | (x >>> (32 - n))) >>> 0;
  },
  // 可变数组：标记与原版解释器一致 —— 一个打了 symbol 的宿主数组。
  数组: (rt, a) => {
    const t = a[0];
    if (!Array.isArray(t)) rt.坏("HMYR-行-017", "数组() 要一个元组");
    const 出 = [...t];
    出[数组标] = true;
    return 出;
  },
  设: (rt, a) => {
    const 列 = a[0];
    if (!Array.isArray(列) || 列[数组标] !== true) rt.坏("HMYR-行-018", "设() 的第一个参数必须是 数组() 造出来的可变数组");
    const i = Math.floor(rt.成数(a[1]));
    if (!Number.isFinite(i) || i < 0 || i >= 列.length) rt.坏("HMYR-行-019", "下标越出数组：" + i);
    列[i] = a[2];
    return 列;
  },
  len: (rt, a) => {
    const v = a[0];
    if (码元.是码元序列(v)) return 码元.长(v);
    if (typeof v === "string" || Array.isArray(v)) return v.length;
    rt.坏("HMYR-行-015", "len() wants a string or a tuple");
  },
  str: (rt, a) => rt.成串(a[0]),
  slice: (rt, a) => {
    // 切片在两种底上各做一遍：码元序列走 units，宿主串走 slice。
    // 夹界的那几条（起不小于零、止不超过长度）两边一致，所以结果也一致。
    //
    // 数组不在这里切：2026-10-26 试过加一支「数组走 Array.prototype.slice」，
    // 结果 cli 那一套大面积红 —— 有地方（read_text 的路径处理、argv 那一路）
    // 正是靠「数组进这儿、按字符串出来」这个行为在做事的。那不是一个可以
    // 顺手扩展的函数，所以容器那一层自己写了字节段，见 self/ittgn.hmoca。
    const v = a[0];
    const s = 码元.是码元序列(v) ? v : rt.成串(v);
    const 长 = 码元.是码元序列(v) ? 码元.长(s) : s.length;
    const 起 = a[1] === undefined || a[1] === null ? 0 : Math.max(0, Math.floor(rt.成数(a[1])));
    const 止 = a[2] === undefined || a[2] === null ? 长 : Math.min(长, Math.floor(rt.成数(a[2])));
    if (码元.是码元序列(v)) return 起 >= 止 ? 码元.由宿主("") : 码元.切(s, 起, 止);
    return 起 >= 止 ? "" : s.slice(起, 止);
  },
  // 字节元组转文本：按 UTF-8 解码。解码手写，理由同 read_stdin_line 那一条。
  bytes_to_text: (rt, a) => {
    const 项们 = a[0];
    const 字节们 = [];
    for (let i = 0; i < 项们.length; i++) 字节们.push(Number(项们[i]) & 0xFF);
    let s = "";
    let i = 0;
    while (i < 字节们.length) {
      const b0 = 字节们[i];
      let cp = 0, 续 = 0;
      if (b0 < 0x80) { cp = b0; 续 = 0; }
      else if ((b0 & 0xE0) === 0xC0) { cp = b0 & 0x1F; 续 = 1; }
      else if ((b0 & 0xF0) === 0xE0) { cp = b0 & 0x0F; 续 = 2; }
      else { cp = b0 & 0x07; 续 = 3; }
      i++;
      for (let k = 0; k < 续 && i < 字节们.length; k++) { cp = (cp << 6) | (字节们[i] & 0x3F); i++; }
      s += String.fromCodePoint(cp);
    }
    return s;
  },
  // 从标准输入读 N 个字节：交回 {字节们, 结束}。结束表示没读满（EOF 先到了）。
  read_stdin_bytes: (rt, a) => {
    const n = Math.max(0, Math.floor(rt.成数(a[0])));
    const 字节们 = [];
    while (字节们.length < n) {
      let b;
      try { b = rt.cap.terminal.readSync(n - 字节们.length); } catch (err) { b = null; }
      if (!b || b.length === 0) break;
      for (let i = 0; i < b.length; i++) 字节们.push(b[i]);
    }
    return { 字节们, 结束: 字节们.length < n };
  },
  // 从标准输入读一行：交回 {行, 结束}。结束是 EOF，与空行是两件事。
  // 解码手写：这一份的宿主依赖钉在十项上，而 Buffer 与 Uint8Array 都不在那十项里。
  read_stdin_line: (rt) => {
    const 字节们 = [];
    let 结束 = false;
    for (;;) {
      let b;
      try { b = rt.cap.terminal.readSync(1); } catch (err) { b = null; }
      if (!b || b.length === 0) { 结束 = true; break; }
      if (b[0] === 10) break;
      字节们.push(b[0]);
    }
    let s = "";
    let i = 0;
    while (i < 字节们.length) {
      const b0 = 字节们[i];
      let cp = 0, 续 = 0;
      if (b0 < 0x80) { cp = b0; 续 = 0; }
      else if ((b0 & 0xE0) === 0xC0) { cp = b0 & 0x1F; 续 = 1; }
      else if ((b0 & 0xF0) === 0xE0) { cp = b0 & 0x0F; 续 = 2; }
      else { cp = b0 & 0x07; 续 = 3; }
      i++;
      for (let k = 0; k < 续 && i < 字节们.length; k++) { cp = (cp << 6) | (字节们[i] & 0x3F); i++; }
      s += String.fromCodePoint(cp);
    }
    if (s.endsWith("\r")) s = s.slice(0, -1);
    return { 行: s, 结束 };
  },
  // 原始字节：嵌入与打包要它。read_text 会按 UTF-8 解码，二进制一过就坏。
  read_bytes: (rt, a) => {
    const 路径 = rt.成串(a[0]);
    try { return Array.from(rt.cap.file.read(路径)); }
    catch (err) { rt.坏("HMYR-內-011", "cannot read '" + 路径 + "'"); }
  },
  // 切开一个字符串。切法照宿主那一份：空分隔按码元切（空串给空元组），
  // 其余按不重叠的子串切，连续或末尾的分隔留下空段。
  split: (rt, a) => rt.成串(a[0]).split(rt.成串(a[1])),
  // ---- 环境与路径：读这台机器在哪儿 ----
  // 两台机器给出不同的字符串是对的；两个如实说「没有」的见各条注释。
  cwd: (rt) => rt.cap.process.cwd(),
  home_dir: (rt) => rt.cap.env.home(),
  temp_path: (rt, a) => {
    const 目录 = rt.cap.env.get("HMYR_TMP") || rt.cap.env.temp();
    rt.cap.file.ensureDir(目录);
    return rt.cap.path.join(目录, "hmyr-" + rt.成串(a[0]));
  },
  // 仓库根由能力层给（capabilities.path.root），这一份不自己猜。
  repo_path: (rt, a) => rt.cap.path.resolve(rt.cap.path.root(), rt.成串(a[0])),
  // 这台机器不是 Python 宿主：只认设了的环境变量，否则就说 python 这个名字。
  python_path: (rt) => rt.cap.env.get("HMYR_PYTHON") || "python",
  locale_current: () => 当前locale,
  locale_set: (rt, a) => {
    const 名 = rt.成串(a[0]);
    if (!locale名字们.includes(名)) {
      rt.坏("HMYR-內-005", "no such locale profile: '" + 名 + "' (have: " + locale名字们.join(", ") + ")");
    }
    当前locale = 名;
    return 当前locale;
  },
  locale_env: (rt) => rt.cap.env.localeGuess(),
  console_codepage: (rt) => rt.cap.env.codepage(),
  // ---- 线程：这一份起的是最小求值器自己的工人（thr-worker-min.mjs） ----
  // 与宿主那份是同一套做法，差别只在工人里跑哪台机器 —— 所以「同一段源码在
  // 另一个线程上得到同一个答案」是这台机器给的，不是另一台替它答的。
  //
  // 起与停要 thread 效果；等与数是读（与宿主那份同）。
  thr_spawn: (rt, a) => {
    const 源码 = rt.成串(a[0]);
    const 入口 = rt.成串(a[1]);
    // 档位的线程池那一项：0 表示不设限，也就是普通 .hmoca 的情形。
    const 上限 = rt.cap.thread.上限 || 0;
    if (上限 > 0 && THREADS.size >= 上限) {
      rt.坏("HMYR-內-022", "thread pool is full: " + THREADS.size + " alive, limit " + 上限 + "（steady 那一档只给一个线程槽；要更多就用 hmhsr 那一档）");
    }
    const id = nextThreadId++;
    const 出 = rt.cap.path.join(rt.cap.env.temp(), "hmyr-minthread-" + Date.now().toString(36) + "-" + id + ".json");
    const flag = rt.cap.thread.signal();
    const handle = { id, flag, outPath: 出, worker: null };
    handle.worker = rt.cap.thread.spawn(new URL("./thr-worker-min.mjs", import.meta.url), { source: 源码, entry: 入口, outPath: 出, flag });
    // 起不来就交回 -1：那不是「拒绝」，是这个线程压根没出生，
    // 而调用方拿到 -1 之后 join 会得到 HMYR-內-020 —— 一条路，不是两条。
    if (!handle.worker) return -1;
    handle.worker.on("error", () => rt.cap.thread.store(handle.flag, 9));
    if (typeof handle.worker.unref === "function") handle.worker.unref();
    handle.worker.on("exit", (code) => { if (rt.cap.thread.load(handle.flag) === 0) rt.cap.thread.store(handle.flag, code === 0 ? 1 : 9); });
    THREADS.set(id, handle);
    return id;
  },
  thr_join: (rt, a) => {
    const id = Math.floor(rt.成数(a[0]));
    const h = THREADS.get(id);
    if (!h) rt.坏("HMYR-內-020", "no such thread handle: " + id);
    const 超时 = a[1] === undefined || a[1] === null ? 30000 : Math.floor(rt.成数(a[1]));
    const 到 = Date.now() + 超时;
    while (rt.cap.thread.load(h.flag) === 0) {
      const 剩 = 到 - Date.now();
      if (剩 <= 0) rt.坏("HMYR-內-021", "thread " + id + " did not finish within " + 超时 + "ms");
      rt.cap.thread.wait(h.flag, 剩 < 50 ? 剩 : 50);
    }
    let 结果 = null;
    try { 结果 = JSON.parse(rt.cap.file.read(h.outPath).toString("utf8")); } catch (err) { 结果 = null; }
    rt.cap.file.remove(h.outPath);
    THREADS.delete(id);
    if (!结果) return "";
    return 结果.ok ? String(结果.text) : "";
  },
  thr_cancel: (rt, a) => {
    const id = Math.floor(rt.成数(a[0]));
    const h = THREADS.get(id);
    if (!h) rt.坏("HMYR-內-020", "no such thread handle: " + id);
    try { if (h.worker) h.worker.terminate(); } catch (err) { /* 已经没了就算停住 */ }
    rt.cap.file.remove(h.outPath);
    THREADS.delete(id);
    return id;
  },
  thr_count: (rt) => Array.from(THREADS.values()).filter((h) => rt.cap.thread.load(h.flag) === 0).length,
  // arena：三区模型的桩，字段是函数值；这一份也没有一等函数值。
  arena: (rt) => rt.坏("HMYR-行-005", "arena is a stub for the zone model: its fields are functions, and this machine has no first-class functions"),
  // owned：与 arena 一样是桩。自举层自己实现区与所有权（self/eval.hmoca），
  // 而这一份跑的是自举层，它不用这两个 —— 七处内置表的账要对得上，所以这里留一格。
  owned: (rt) => rt.坏("HMYR-行-005", "owned is a stub on this machine for the same reason arena is"),
  // FFI 的最小形状：这一台跑的是自举层，它自己实现（self/eval.hmoca），
  // 而七处内置表的账要对得上，所以这六格在这里是桩。
  bytes_view: (rt) => rt.坏("HMYR-行-005", "bytes_view is a stub on this machine for the same reason arena is"),
  view_len: (rt) => rt.坏("HMYR-行-005", "view_len is a stub on this machine for the same reason arena is"),
  view_get: (rt) => rt.坏("HMYR-行-005", "view_get is a stub on this machine for the same reason arena is"),
  view_set: (rt) => rt.坏("HMYR-行-005", "view_set is a stub on this machine for the same reason arena is"),
  fmt_number: (rt) => rt.坏("HMYR-行-005", "fmt_number is a stub on this machine for the same reason arena is"),
  // 跑一个程序：一份记录，五个字段。跑不起来也照实报告，不抛。
  run_program: (rt, a) => {
    const 命令 = rt.成串(a[0]);
    if (命令 === "") rt.坏("HMYR-內-013", "run_program needs a program name: an empty string names nothing");
    const 参们 = Array.isArray(a[1]) ? a[1].map((x) => rt.成串(x)) : [];
    const 超时 = a[2] === undefined || a[2] === null ? 10000 : rt.成数(a[2]);
    const 编码 = a[3] === undefined || a[3] === null ? "utf8" : rt.成串(a[3]);
    const r = rt.cap.process.exec(命令, 参们, { timeout: 超时, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    const 解 = (buf) => {
      try { return new TextDecoder(编码 === "gbk" || 编码 === "gb2312" ? "gbk" : "utf-8").decode(buf || new Uint8Array()); }
      catch (err) { return String(buf || ""); }
    };
    const 去尾 = (s) => String(s).replace(/[ \t\r\n]+$/, "");
    return {
      code: typeof r.status === "number" ? r.status : -1,
      stdout: 去尾(解(r.stdout)),
      stderr: 去尾(解(r.stderr)),
      timedOut: !!(r.error && r.error.code === "ETIMEDOUT"),
      error: r.error ? String(r.error.code || r.error.message) : null,
    };
  },
  // ---- 进程：改工作目录 ----
  chdir: (rt, a) => {
    const 目标 = rt.成串(a[0]);
    try { rt.cap.process.chdir(目标); return rt.cap.process.cwd(); }
    catch (err) { rt.坏("HMYR-內-009", "cannot enter '" + 目标 + "'"); }
  },
  // ---- 输入：一条键队列 ----
  key_push: (rt, a) => { 键队列.push(rt.成串(a[0])); return 键队列.length; },
  key_available: () => 键队列.length > 0,
  key_read: (rt) => {
    if (键队列.length) return 键队列.shift();
    if (!rt.cap.terminal.isTTY()) return "";
    try {
      const buf = rt.cap.terminal.readSync(64);
      if (buf && buf.length > 0) {
        for (const ch of buf.toString("utf8")) 键队列.push(ch);
        return 键队列.length ? 键队列.shift() : "";
      }
    } catch (err) { /* 读不到就是没有键 */ }
    return "";
  },
  key_start: (rt, a) => !!rt.cap.terminal.setRaw(a[0] === true),
  // ---- 时间：读一次钟，或等一会儿 ----
  now_ms: (rt) => rt.cap.time.now(),
  sleep_ms: (rt, a) => {
    const ms = Math.max(0, Math.floor(rt.成数(a[0])));
    if (ms > 0) rt.cap.time.sleep(ms);
    return ms;
  },
  // ---- 终端：只交回字符串，一个字都不写出去 ----
  term_size: (rt) => { const s = rt.cap.terminal.size(); return [s.rows, s.columns]; },
  term_clear: () => "\u001b[2J",
  term_hide: () => "\u001b[?25l",
  term_show: () => "\u001b[?25h",
  term_escape: (rt, a) => "\u001b[" + Math.max(1, Math.floor(rt.成数(a[0]))) + ";" + Math.max(1, Math.floor(rt.成数(a[1]))) + "H",
  term_color: (rt, a) => {
    const fg = Math.floor(rt.成数(a[0]));
    if (fg < 0) return "\u001b[0m";
    const bg = a[1] === undefined || a[1] === null ? -1 : Math.floor(rt.成数(a[1]));
    return bg < 0 ? "\u001b[38;5;" + fg + "m" : "\u001b[38;5;" + fg + ";48;5;" + bg + "m";
  },
  // 取第一个码元的码点。空串拒绝，而不是交回一个编出来的零 —— 那正是 HMYR-內-006 的意思。
  // 宿主那一份（src/eval.mjs）早就有它，最小求值器一直没转发：标准库写大小写时
  // 才撞上这件事（没有它，大小写只能写成五十二行字符比较）。
  ord: (rt, a) => {
    const s = rt.成串(a[0]);
    if (s.length === 0) rt.坏("HMYR-內-006", "ord of an empty string: there is no first character to read");
    return s.codePointAt(0);
  },
  // 大小写：规格第一圈里有它们，而这一份一直没转发。
  // 它们查的是一张随宿主来的大小写表，与归一化同一个性质 —— 所以表在能力层，这里只转发。
  to_upper: (rt, a) => rt.cap.unicode.upper(rt.成串(a[0])),
  to_lower: (rt, a) => rt.cap.unicode.lower(rt.成串(a[0])),
  chr: (rt, a) => {
    const cp = Math.floor(rt.成数(a[0]));
    if (cp < 0 || cp > 0x10ffff) rt.坏("HMYR-內-007", "not a code point: " + cp);
    return rt.码元串 ? 码元.码点(cp) : String.fromCodePoint(cp);
  },
  to_int: (rt, a) => {
    const s = rt.成串(a[0]).trim();
    if (!/^-?[0-9]+$/.test(s)) rt.坏("HMYR-內-008", "not an integer literal: '" + s + "'");
    return Number(s);
  },
  // 算术那一组：纯函数，不碰世界。这一层一直没有转发它们，于是自举层解释程序时
  // 遇到了也只能说「没有这个内置」。min 与 max 收任意多个参数 —— 少一个参数就报。
  abs: (rt, a) => Math.abs(rt.成数(a[0])),
  floor: (rt, a) => Math.floor(rt.成数(a[0])),
  int: (rt, a) => {
    // 只收数，不猜数字串 —— 猜法有宽有窄，而两窄不如一窄说得清。
    return Math.trunc(rt.成数(a[0]));
  },
  min: (rt, a) => {
    if (a.length === 0) rt.坏("HMYR-行-002", "min wants at least one argument");
    return Math.min(...a.map((x) => rt.成数(x)));
  },
  max: (rt, a) => {
    if (a.length === 0) rt.坏("HMYR-行-002", "max wants at least one argument");
    return Math.max(...a.map((x) => rt.成数(x)));
  },
  // 归一化与 Unicode 属性都要一张字符表，而那张表是能力，不是这一层能自制的。
  // 于是这三条把值先写成宿主串，再交给世界的库 —— 借在明处，写在这里。
  // 归一化与 Unicode 属性要一张字符表，而那张表是数据 —— 它住在能力层的 unicode 组里。
  // 于是求值器不再直接对宿主串调 normalize，也不再自己写一条属性正则。
  nfc: (rt, a) => rt.cap.unicode.normalize(rt.成串(a[0])),
  is_letter: (rt, a) => rt.cap.unicode.isLetter(rt.成串(a[0])),
  is_mark: (rt, a) => rt.cap.unicode.isMark(rt.成串(a[0])),
  record_new: (rt, a) => {
    const pairs = a[0];
    if (!Array.isArray(pairs)) rt.坏("HMYR-內-014", "record_of wants a tuple of (name, value) pairs");
    const out = {};
    for (const p of pairs) {
      if (!Array.isArray(p) || p.length !== 2) rt.坏("HMYR-內-014", "every item must be a (name, value) pair");
      const k = rt.成串(p[0]);
      if (!/^[\p{L}_][\p{L}\p{N}\p{M}_]*$/u.test(k)) rt.坏("HMYR-內-014", "not a name a record could hold: " + JSON.stringify(k));
      out[k] = p[1];
    }
    return out;
  },
  field_get: (rt, a) => {
    const rec = a[0];
    const name = rt.成串(a[1]);
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) rt.坏("HMYR-內-015", "field_get wants a record, found " + 述(rec));
    if (!Object.prototype.hasOwnProperty.call(rec, name)) rt.坏("HMYR-內-016", "no field '" + name + "' on that record");
    return rec[name];
  },
  // 问「有没有」不是失败，于是它不给编号。
  field_has: (rt, a) => {
    const rec = a[0];
    const name = rt.成串(a[1]);
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) return false;
    return Object.prototype.hasOwnProperty.call(rec, name);
  },
  // 字段名的列表，按造记录时的顺序。
  // 没有它，「把一条记录摊开」这一类东西写不出来 —— 标准库的表那一份卡在这里。
  // 非记录给 HMYR-內-017：交回空表会把「这不是记录」说成「这是一条空记录」。
  field_names: (rt, a) => {
    const rec = a[0];
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
      return rt.坏("HMYR-內-017", "field_names wants a record, found " + 述(rec));
    }
    return Object.keys(rec);
  },
  // ---- 索引 ----
  // 一个按键查的东西。记录凑不了（键要像名字，也不能增量置入），元组拼接是 O(n²)。
  // 约定见 design/INDEX.txt：键是任意字符串，set 交回同一个索引，取不到报 HMYR-內-018。
  index_new: () => new Map(),
  index_set: (rt, a) => {
    const m = a[0];
    if (!(m instanceof Map)) rt.坏("HMYR-內-019", "index_set wants an index, found " + 述(m));
    m.set(rt.成串(a[1]), a[2]);
    return m;
  },
  index_get: (rt, a) => {
    const m = a[0];
    if (!(m instanceof Map)) rt.坏("HMYR-內-019", "index_get wants an index, found " + 述(m));
    const k = rt.成串(a[1]);
    if (!m.has(k)) rt.坏("HMYR-內-018", "no key " + JSON.stringify(k) + " in that index");
    return m.get(k);
  },
  index_has: (rt, a) => {
    const m = a[0];
    if (!(m instanceof Map)) return false;
    return m.has(rt.成串(a[1]));
  },
  index_len: (rt, a) => {
    const m = a[0];
    if (!(m instanceof Map)) rt.坏("HMYR-內-019", "index_len wants an index, found " + 述(m));
    return m.size;
  },
  index_keys: (rt, a) => {
    const m = a[0];
    if (!(m instanceof Map)) rt.坏("HMYR-內-019", "index_keys wants an index, found " + 述(m));
    return [...m.keys()];
  },
  // 写一份文本。规格里有它，而这一层一直没转发 —— 库只有读的那一侧。  // 只认 utf8：别的编码要一张表，而表在 deps/encodings 下（宿主那一份用着）。
  // 说清这个边界，比悄悄按 utf8 处理要好。
  write_text: (rt, a) => {
    const 路径 = rt.成串(a[0]);
    const 文 = rt.成串(a[1]);
    try { rt.cap.file.writeText(路径, 文); }
    catch (err) {
      const 原因 = 在用脱敏() ? "" : ": " + String(err && err.message ? err.message : err);
      return rt.坏("HMYR-內-012", "cannot write '" + 藏路径(路径) + "'" + 原因);
    }
    return 文.length;
  },
  // 写一串字节。字节在语言里是「0 到 255 的整数元组」—— 这门语言没有字节类型，
  // 而 .hmyrb 的落盘需要一个能交出字节的出口。落文件那一步交给能力层。
  write_bytes: (rt, a) => {
    const 路径 = rt.成串(a[0]);
    const 元组 = a[1];
    // 三种形状都要认：这一层的元组是普通数组（见开头那段值表示），字节码机那边
    // 交上来的是带 items 的类元组，而 read_bytes 在这一层交回的是 TypedArray ——
    // 于是「读出来再写回去」这件事只认前两种时会失败。2026-10-26 撞上的：
    // 容器那一份在 bin/hmyr.mjs 下报「wants a tuple of bytes」，同一份代码在字节码机上是好的。
    const 是视图 = typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(元组);
    if (!元组 || !(元组.items || Array.isArray(元组) || 是视图)) return rt.坏("HMYR-行-013", "write_bytes wants a tuple of bytes");
    // 元素可以是字节，也可以是一块字节（语言那边按块累积，省掉平方复制）。
    const 字节 = [];
    for (const x of (元组.items || 元组)) {
      if (Array.isArray(x) || (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(x))) {
        for (const y of x) 字节.push(Math.trunc(rt.成数(y)));
      }
      else 字节.push(Math.trunc(rt.成数(x)));
    }
    try { rt.cap.file.writeBytes(路径, 字节); }
    catch (err) {
      const 原因 = 在用脱敏() ? "" : ": " + String(err && err.message ? err.message : err);
      return rt.坏("HMYR-內-012", "cannot write '" + 藏路径(路径) + "'" + 原因);
    }
    return 字节.length;
  },
  // 把一个值编成 .hmyrb 里那一段字节。编码属于世界那一侧。
  // 这一层里元组就是普通数组（见开头那段值表示），所以直接交回数组。
  pack_value: (rt, a) => {
    try {
      return rt.cap.file.packValue(a[0]);
    } catch (err) {
      rt.坏("HMYR-內-014", "cannot encode this value: " + String(err && err.message ? err.message : err));
      return null;
    }
  },
  // 按行读：从偏移读一行，交回 {行, 下一起点}；读完交回 下一起点 = -1。
  read_line: (rt, a) => {
    const 路径 = rt.成串(a[0]);
    const 起 = Math.trunc(rt.成数(a[1]));
    try {
      const r = rt.cap.file.readLine(路径, 起);
      return { 行: r.行, 下一起点: r.下一起点 };
    } catch (err) {
      const 原因 = 在用脱敏() ? "" : ": " + String(err && err.message ? err.message : err);
      return rt.坏("HMYR-內-011", "cannot read '" + 藏路径(路径) + "'" + 原因);
    }
  },
  // 整份按行切好。
  read_lines: (rt, a) => {
    const 路径 = rt.成串(a[0]);
    try { return rt.cap.file.readLines(路径); }
    catch (err) {
      const 原因 = 在用脱敏() ? "" : ": " + String(err && err.message ? err.message : err);
      return rt.坏("HMYR-內-011", "cannot read '" + 藏路径(路径) + "'" + 原因);
    }
  },
  print: (rt, a) => { rt.write(a.map((x) => rt.成串(x)).join("")); return null; },
  print_err: (rt, a) => {
    const 文 = a.map((x) => rt.成串(x)).join("");
    if (rt.writeErr) rt.writeErr(文); else if (rt.write) rt.write(文);
    return null;
  },
  read_text: (rt, a) => {
    // 路径与编码都是字符串值，先按那一条规矩写成宿主串（文件系统只认那个）。
    const 路径 = rt.成串(a[0]);
    let buf;
    // 路径可以被藏起来（--redact 或 HMYR_REDACT），编号不动；宿主的原因也省掉，
    // 因为它通常带着同一条路径。
    try { buf = rt.cap.file.read(路径); }
    catch (err) {
      const 原因 = 在用脱敏() ? "" : ": " + String(err && err.message ? err.message : err);
      rt.坏("HMYR-內-011", "cannot read '" + 藏路径(路径) + "'" + 原因);
    }
    const enc = a[1] === undefined || a[1] === null ? null : rt.成串(a[1]);
    // 解出来的东西是宿主串，而它是语言里的字符串值 —— 所以最后要落到那种底上。
    const 出 = (文) => (rt.码元串 ? 码元.由宿主(文) : 文);
    if (enc) {
      const 名 = enc.toLowerCase();
      if (名 === "utf8" || 名 === "utf-8") return 出(buf.toString("utf8"));
      if (名 === "utf16le" || 名 === "utf-16le") return 出(new TextDecoder("utf-16le").decode(buf));
      if (名 === "latin1") return 出(buf.toString("latin1"));
      rt.坏("HMYR-內-012", "this runtime cannot decode '" + enc + "'");
    }
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 出(buf.subarray(3).toString("utf8"));
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 出(new TextDecoder("utf-16le").decode(buf.subarray(2)));
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 出(new TextDecoder("utf-16be").decode(buf.subarray(2)));
    return 出(buf.toString("utf8"));
  },
  file_exists: (rt, a) => {
    // 路径是字符串值，所以要走那一条规矩写成宿主串。写成 String(a[0]) 的话，
    // 在码元那一层上会得到 "104,101,..." 这样一串数字 —— 文件当然不存在，
    // 而报出来的话里却是正确路径，看上去像个假失败。
    const 路径 = rt.成串(a[0]);
    try { return rt.cap.file.exists(路径); } catch (err) { return false; }
  },
  // 列目录：这一层的元组就是普通数组，所以直接交回数组（顺序由能力层排好）。
  // 名字仍然是字符串值，走与 argv 同一条落地路径。
  read_dir: (rt, a) => {
    const 路径 = rt.成串(a[0]);
    let 名们;
    try { 名们 = rt.cap.file.listDir(路径); }
    catch (err) {
      const 原因 = 在用脱敏() ? "" : ": " + String(err && err.message ? err.message : err);
      rt.坏("HMYR-內-011", "cannot list '" + 藏路径(路径) + "'" + 原因);
    }
    return 名们.map((x) => (rt.码元串 ? 码元.由宿主(String(x)) : String(x)));
  },
  // 这是不是一个目录。问不到就是 false。
  is_dir: (rt, a) => {
    const 路径 = rt.成串(a[0]);
    try { return rt.cap.file.isDir(路径); } catch (err) { return false; }
  },
  // 命令行参数也是字符串值，所以它们进语言时同样要落到那种底上。
  argv: (rt) => (rt.argv || []).map((x) => (rt.码元串 ? 码元.由宿主(String(x)) : String(x))),
};

// 只有这四样碰世界。读文件与问文件在不在属 file，另两个通道属 process。
const 内置效果 = { read_text: "file", read_bytes: "file", read_dir: "file", is_dir: "file", read_line: "file", read_lines: "file", write_text: "file", write_bytes: "file", file_exists: "file", argv: "process", print_err: "process", chdir: "process", run_program: "process", thr_spawn: "thread", thr_cancel: "thread" };

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
    // 字符串住在哪里：默认是宿主的串，打开之后是码元序列（src/units.mjs）。
    // 打开时语言的每一个字符串值都是 Uint16Array，宿主串只在进出的两处出现。
    this.码元串 = options.字符串用码元序列 === true;
    // 效果检查默认开着。关掉它只有一个正当理由：这一层正在跑一个解释器
    // （self/ 那六份），而那东西替目标程序执行，必然碰得到全部效果。
    // 目标程序自己的效果仍然要查 —— 那一条在 self/eval.hmyr 里。
    this.检查效果 = options.检查效果 !== false;
    // 能力内核交给调用方：一个求值器自己去 import node:fs 就没法在别的地方用了，
    // 而「它借了世界什么」也就只能去读它的源码才知道。见 src/capabilities.mjs。
    //
    // 没给就当场拒绝，而不是等到第一次读文件：一份缺能力的运行时能跑到半路才失败，
    // 那时错已经离开这一层很远了。
    if (!options.capabilities) throw new Error("最小求值器需要一份能力（见 src/capabilities.mjs）");
    this.cap = options.capabilities;
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
    if (++this.depth > this.maxDepth) this.坏("HMYR-行-009", "call depth exceeded (" + this.maxDepth + ")");
    try {
      let 当前 = decl, 实参 = args, 效果 = fromEffects;
      for (;;) {
        try { return this.调用函数内(当前, 实参, 效果); }
        catch (e) {
          if (e instanceof 尾调用) {
            if (++this.steps > this.stepLimit) this.坏("HMYR-行-003", "the program ran for too long without finishing");
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
        // 与宿主求值器同一条：realtime 是档位，不沿调用链传。
        if (effect === "realtime") continue;
        if (!fromEffects.has(effect)) {
          this.坏("HMYR-內-001", "function '" + decl.name + "' uses effect '" + effect + "', which the caller did not declare");
        }
      }
    }
    const scope = new 作用域(null);
    for (let i = 0; i < decl.params.length; i++) {
      const p = decl.params[i];
      let v;
      if (i < args.length) v = args[i];
      else if (p.fallback) v = this.求值(p.fallback, scope, null);
      else this.坏("HMYR-行-002", "function '" + decl.name + "' expects " + decl.params.length + " argument(s), got " + args.length);
      scope.set(p.name, v, false);
    }
    if (args.length > decl.params.length) {
      this.坏("HMYR-行-002", "function '" + decl.name + "' expects " + decl.params.length + " argument(s), got " + args.length);
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
          this.坏("HMYR-行-017", "cannot assign to '" + stmt.name + "': it is not a variable declared with var, or it is not in scope");
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
    if (++this.steps > this.stepLimit) this.坏("HMYR-行-003", "the program ran for too long without finishing");
    if (!node || node.kind === "Error") this.坏("HMYR-行-004", "a syntax error reached the evaluator");
    switch (node.kind) {
      case "字":
        // 字符串也可以住在码元序列里（选项 字符串用码元序列）。打开之后，
        // 语言的每一个字符串值都是 Uint16Array，而宿主串只在进出这一层时出现。
        return this.码元串 && typeof node.value === "string" ? 码元.由宿主(node.value) : node.value;
      case "Ident": {
        if (scope.has(node.name)) return scope.get(node.name);
        if (this.globals.has(node.name)) return this.globals.get(node.name);
        this.坏("HMYR-行-005", "there is no name '" + node.name + "' in scope");
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
          if (++guard > 循环闸) this.坏("HMYR-內-010", "a while loop ran past a million iterations without ending");
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
          this.坏("HMYR-行-007", "no field '" + node.name + "' on that value");
        }
        return typeof target[node.name] === "function" ? target[node.name].bind(target) : target[node.name];
      }
      case "Index": {
        const target = this.求值(node.target, scope, effects);
        // 下标先取下整，与 slice 的起止、设()、chr() 同一条规矩。
        const index = 下整(this.成数(this.求值(node.index, scope, effects)));
        if (码元.是码元序列(target)) {
          const 长 = 码元.长(target);
          if (!码元.在界内(target, index)) {
            /* HMYR_INDEX_TRACE=1：把越界那一次的现场打出来。
             * 为什么（2026-11-01）：自举层的词法器在某个下标上越界，而报错只有
             * 「index N outside a value of length N」—— 不知道是哪个表达式。
             * 这一行给的是目标、下标与那个 Index 节点本身，足够指到一行源码。 */
            if (process.env.HMYR_INDEX_TRACE) {
              console.error("越界现场 目标=" + JSON.stringify(target).slice(0, 120)
                + " 下标=" + index + " 节点=" + JSON.stringify(node).slice(0, 260));
            }
            this.坏("HMYR-行-018", "index " + index + " is outside a value of length " + 长);
          }
          // 下标取一个码元，而取出来的那一个码元也是字符串值 —— 所以它是一个只有一位的序列。
          return 码元.码点(码元.元(target, index));
        }
        if (typeof target !== "string" && !Array.isArray(target)) this.坏("HMYR-行-019", "cannot index " + 述(target));
        if (index < 0 || index >= target.length) this.坏("HMYR-行-018", "index " + index + " is outside a value of length " + target.length);
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
      // 检查效果，但自举那一层例外：它是解释器，替目标程序执行，
      // 于是它自己必然碰得到全部效果 —— 真正该被查的是目标程序的函数，
      // 而那一层的检查在 self/eval.hmyr 里（它读 functions 表里的效果项）。
      if (this.检查效果 !== false && need && !(effects instanceof Set && effects.has(need))) {
        this.坏("HMYR-內-001", "builtin '" + name + "' needs effect '" + need + "', which the caller did not declare");
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
    this.坏("HMYR-行-008", "that value is not callable");
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
        if (码元.是码元序列(a) || 码元.是码元序列(b)) {
          // 有一边是码元序列，拼接就在那一层做；另一边先按「值写成字」的规矩转过去。
          const 左 = 码元.是码元序列(a) ? a : 码元.由宿主(this.成串(a));
          const 右 = 码元.是码元序列(b) ? b : 码元.由宿主(this.成串(b));
          return 码元.拼(左, 右);
        }
        if (typeof a === "string" || typeof b === "string") return this.成串(a) + this.成串(b);
        return this.成数(a) + this.成数(b);
      case "-": return this.成数(a) - this.成数(b);
      case "*": return this.成数(a) * this.成数(b);
      case "/":
        if (this.成数(b) === 0) this.坏("HMYR-行-012", "division by zero");
        return this.成数(a) / this.成数(b);
      case "%":
        if (this.成数(b) === 0) this.坏("HMYR-行-012", "division by zero");
        return this.成数(a) % this.成数(b);
      case "==": return this.相等(a, b);
      case "!=": return !this.相等(a, b);
      case "<": return this.比(a, b) < 0;
      // <= 与 >= 先问「能不能比」：「比」把不可比压成 0，看起来像等于。
      case "<=": return 有序(a, b) && this.比(a, b) <= 0;
      case ">": return this.比(a, b) > 0;
      case ">=": return 有序(a, b) && this.比(a, b) >= 0;
      default: this.坏("HMYR-行-011", "no evaluation for operator " + node.op);
    }
  }

  成数(v) {
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    this.坏("HMYR-行-013", "expected a number, found " + 述(v));
  }
  成串(v) {
    // 这是「一个值怎么写成一个字符串」的那一条规矩。而在码元序列那种底上，
    // 交回来的仍是宿主串 —— 它是写出去的那一头，也就是借世界的那一处。
    if (码元.是码元序列(v)) return 码元.成宿主(v);
    if (typeof v === "string") return v;
    // nil 与空元组在这门语言里是同一个东西，所以它写成 []（与自举层、另三台一致）。
    if (v === null) return "[]";
    if (Array.isArray(v)) return "[" + v.map((x) => this.成串(x)).join(", ") + "]";
    return String(v);
  }
  真(v) {
    if (码元.是码元序列(v)) return 码元.长(v) !== 0;
    return !(v === false || v === null || v === 0 || v === "");
  }
  相等(a, b) {
    if (码元.是码元序列(a) && 码元.是码元序列(b)) return 码元.比(a, b) === 0;
    return typeof a === typeof b ? a === b : this.成串(a) === this.成串(b);
  }
  比(a, b) {
    if (码元.是码元序列(a) && 码元.是码元序列(b)) return 码元.比(a, b);
    if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
    if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
    this.坏("HMYR-行-014", "cannot compare " + 述(a) + " with " + 述(b));
  }
}

// 与宿主那个 runUnit 同一件事：把模块按依赖顺序登记进一个运行时，交回来给它跑。
export const 最小运行 = (unit, options = {}) => {
  const rt = new 最小运行时(options);
  for (const file of unit.order) rt.登记模块(unit.modules.get(file));
  return rt;
};
