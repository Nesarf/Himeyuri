// 能力内核：宿主交给这门语言的全部东西，收在这一个对象里。
//
// 为什么要这一层：在这之前，「怎么读文件」是求值器里的内置直接 import fs 做出来的。
// 于是「换一个宿主」这件事没有落点——你得去读求值器的源码，才知道它借了什么。
// 而 design/CAPABILITIES.txt 已经把这些东西按组写清了；这一份是那份契约的实现面。
//
// 分组与契约一一对应（见 design/CAPABILITIES.txt）：
//
//   file      读、写、问在不在            需要 file 效果
//   process   跑程序、改工作目录、取参数   需要 process 效果（argv 也要：它读的是进程的状态）
//   time      现在、等一会儿              不需要效果，但破坏可复现性
//   env       主目录、临时目录、工作目录   只读
//   path      拼、拆路径                  纯函数
//   terminal  终端控制序列                只返回字符串，一个字都不写出去
//
// 这一份实现用 Node 的模块。它是有意被写得无聊的：能力层不该有自己的主意，
// 它只把「世界」递给上面那两层（内置与求值器）。所有决定——要不要效果、拒绝时给哪个编号——
// 都在上面，而不是在这里。
//
// 所以它也不做检查：read 一个不存在的文件就抛，好让上面那条路把它翻成 R0211。
// 在这里编一个编号，会让「拒绝时给哪个编号」这件事分散到两个地方去。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Worker } from "node:worker_threads";

// 终端尺寸与控制序列：它们只交回字符串，所以不需要碰任何设备。
// 真的终端会自己去问系统；套件里 call 一份假的就够了——这一层让那件事成立。
const 转义 = (s) => "\u001b[" + s;

// 线程那一组单独在这里，因为它要用 Worker 与 Atomics，而别的组都不需要。
//
// 为什么不是 postMessage：那个回调也在主线程的事件循环里，而主线程正堵在 Atomics.wait 上。
// 于是结果经文件送达，共享内存只发「写完了」这一个信号。这一条与 CAPABILITIES.txt 里那段一致。
const 线程能力 = () => ({
  // 起不来就交回 null，让调用方决定怎么说话（契约里：交回一个无效句柄，不另设编号）。
  // 而原因要留下来：静默的 null 会让「为什么起不来」变成一件要去猜的事，
  // 今天这一格就是这样多花了时间——Worker 没 import，ReferenceError 被吞成了 null。
  spawn: (scriptUrl, workerData) => {
    try { return new Worker(scriptUrl, { workerData }); }
    catch (err) { 线程能力.上次错误 = String(err && err.message ? err.message : err); return null; }
  },
  // 信号：一个 32 位整数，0 表示还在跑。
  signal: () => new Int32Array(new SharedArrayBuffer(4)),
  load: (flag) => Atomics.load(flag, 0),
  store: (flag, v) => { Atomics.store(flag, 0, v); Atomics.notify(flag, 0); },
  wait: (flag, ms) => Atomics.wait(flag, 0, 0, ms),
});

export const 本机能力 = (options = {}) => ({
  // 这一份能力说自己会什么 —— 报告只读这一张单子，不从「有没有那个函数」去猜。
  // 单上的每一项都由 报告 对照成员检查一遍，说了却做不到会被报成「缺」。
  声明: [
    "io.file.read_write", "io.file.exists", "io.file.directories",
    "process.spawn", "process.argv", "process.directory",
    "time.wall_clock", "time.sleep",
    "env.locations", "env.variables", "path.manipulate",
    "terminal.size", "terminal.escape", "terminal.raw_input", "terminal.read",
    "text.unicode.normalize", "text.unicode.properties", "text.unicode.case", "thread.spawn",
  ],
  thread: 线程能力(),
  file: {
    read: (p) => fs.readFileSync(p),
    exists: (p) => fs.existsSync(p),
    write: (p, buf) => fs.writeFileSync(p, buf),
    // 写一份文本。这一条存在的理由是「谁负责把字变成字节」：
    // 求值器如果自己调 Buffer，宿主依赖那一张表就多一项（test/host-deps.test.mjs 会红）。
    // 而「字怎么变成字节」正是世界那一侧的事 —— 编码表随宿主来。
    writeText: (p, s) => fs.writeFileSync(p, String(s), "utf8"),
    // 写一串字节。字节在语言里是「0 到 255 的整数元组」，因为这门语言没有字节类型。
    // 这一条是 .hmyrb 落盘要用的：把语言算出来的字节交出去，由世界这一侧落成文件。
    //
    // 也接受「块们的元组」（二维）：在语言里按块累积再拍平是线性的，
    // 一次性拍平在这里做，比让语言那边每放一个字节都复制一次累积便宜得多。
    writeBytes: (p, 字节) => {
      const 平 = [];
      for (const x of 字节) {
        if (Array.isArray(x)) { for (const y of x) 平.push(y & 0xff); }
        else 平.push(x & 0xff);
      }
      fs.writeFileSync(p, Buffer.from(平));
    },
    // 把双精度拆成 8 个字节（小端）。这一条属于世界那一侧，理由与 writeText 一样：
    // 浮点数的位怎么排是宿主的事，语言里手搓只会搓出另一种错法。
    f64Bytes: (x) => {
      const b = Buffer.alloc(8);
      b.writeDoubleLE(Number(x), 0);
      return [...b];
    },
    // 把一个语言值编成 .hmyrb 里那一段字节。
    //
    // 这一条也在世界那一侧，理由比上一条更硬：语言里没有 typeof，
    // 也没有 try，所以「这个值是数还是串还是记录」在语言内部判不出来。
    // 试过用 == () 与 len() 去猜，猜不准 —— 猜不准的编码器比没有更危险。
    packValue: (v) => {
      const 段 = [];
      const u16 = (n) => { 段.push(n & 0xff, (n >> 8) & 0xff); };
      const u32 = (n) => { u16(n & 0xffff); u16((n >> 16) & 0xffff); };
      const 串 = (s) => { u16(s.length); for (let i = 0; i < s.length; i++) u16(s.charCodeAt(i)); };
      const 值 = (x) => {
        if (x === null || x === undefined) { 段.push(0); return; }
        // 两种值表示都要认：VM 那一侧是带 tag 的对象，而 stage 0 那一侧
        // 数组就是元组、普通对象就是记录（见 src/eval.mjs 的 STAGE0_EXPR）。
        // 只认一种的话，同一个 pack_value 在两台机器上会在某个值上停住。
        const 是元组 = (x && x.tag === "tuple") || Array.isArray(x);
        const 元组项 = Array.isArray(x) ? x : (x && x.tag === "tuple" ? x.items : null);
        if (是元组 && 元组项 && 元组项.length === 0) { 段.push(0); return; }
        if (是元组 && 元组项) { 段.push(4); u16(元组项.length); for (const it of 元组项) 值(it); return; }
        const 是记录 = x && x.tag === "record" ? x.fields : (x && typeof x === "object" && !Array.isArray(x) ? x : null);
        if (是记录) {
          段.push(5);
          const 名们 = 是记录 instanceof Map ? [...是记录.keys()] : Object.keys(是记录);
          u16(名们.length);
          for (const k of 名们) 串(k);
          for (const k of 名们) 值(是记录 instanceof Map ? 是记录.get(k) : 是记录[k]);
          return;
        }
        if (x === true || x === false) { 段.push(3); 段.push(x ? 1 : 0); return; }
        if (x && x.tag === "string") { 段.push(2); 串(x.value); return; }
        if (typeof x === "string") { 段.push(2); 串(x); return; }
        if (typeof x === "number") {
          段.push(1);
          const b = Buffer.alloc(8);
          b.writeDoubleLE(x, 0);
          for (const q of b) 段.push(q);
          return;
        }
        // 到这里说明是这一层不认的值形状 —— 明说，不要悄悄写半截。
        throw new Error("packValue: cannot encode this value");
      };
      值(v);
      void u32;
      return 段;
    },
    // 建目录不让它失败：已经在就算了。这一条与「写」分开，因为「准备一个地方」
    // 与「往里写东西」是两件事，而契约里只有后者要求 file 效果。
    ensureDir: (p) => { try { fs.mkdirSync(p, { recursive: true }); } catch (err) { /* 已经在就算了 */ } },
    // 删一个文件，删不掉就算了：调用方在收尾，而收尾失败不该变成一条诊断。
    remove: (p) => { try { fs.unlinkSync(p); } catch (err) { /* 没有就算了 */ } },
    // 一个写出口：开着、写多段、最后关掉。write 一次写整份 buffer，适合「一次算完再落盘」；
    // 而程序的输出是一段一段来的，每段开一次文件会让顺序乱。
    //
    // 它在能力层，因为「怎么开一个文件」属于世界那一侧 —— 启动器用 --out 时正是要这个。
    stream: (p) => {
      const fd = fs.openSync(p, "w");
      return {
        write: (s) => fs.writeSync(fd, s),
        close: () => { try { fs.closeSync(fd); } catch (err) { /* 已经关了就算了 */ } },
      };
    },
  },
  process: {
    argv: () => process.argv.slice(),
    exec: (cmd, args, opts) => spawnSync(cmd, args || [], opts || {}),
    chdir: (p) => { process.chdir(p); },
    cwd: () => process.cwd(),
  },
  time: {
    // 忙等：求值器是同步的，而事件循环在那一刻堵着，setTimeout 的回调永远送不进来。
    // 这一条与 CAPABILITIES.txt 里「sleep_ms 是忙等」是同一件事。
    now: () => Date.now(),
    sleep: (ms) => {
      const until = Date.now() + ms;
      while (Date.now() < until) { /* 等 */ }
      return ms;
    },
  },
  env: {
    home: () => os.homedir(),
    temp: () => os.tmpdir(),
    // 环境变量也算世界：读它是读进程的状态，而不是读这门语言自己的东西。
    get: (name) => process.env[name],
    platform: () => process.platform,
  },
  path: {
    join: (...parts) => path.join(...parts),
    resolve: (...parts) => path.resolve(...parts),
    dirname: (p) => path.dirname(p),
    basename: (p) => path.basename(p),
    isAbsolute: (p) => path.isAbsolute(p),
  },
  terminal: {
    // 尺寸取自 options（套件里给一份固定的），而序列是纯字符串。
    // 于是「终端」这一组不需要真的有一个终端在场。
    size: () => (options.terminal && options.terminal.size) || { columns: 80, rows: 24 },
    clear: () => 转义("2J") + 转义("H"),
    escape: (s) => 转义(String(s)),
    color: (n) => 转义(String(n) + "m"),
    hide: () => 转义("?25l"),
    show: () => 转义("?25h"),
    // 输入那一组：真的有一个终端时才有的三件事。
    // 同步读而不是监听 'data'：求值器是同步的，而 sleep_ms 是忙等，
    // 事件循环在那一刻是堵的，事件永远送不进来。这一条与 CAPABILITIES.txt 里那段一致。
    isTTY: () => !!process.stdin.isTTY,
    setRaw: (on) => {
      if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") return false;
      try { process.stdin.setRawMode(on); return true; } catch (err) { return false; }
    },
    readSync: (n) => {
      const buf = Buffer.alloc(n);
      const got = fs.readSync(0, buf, 0, n, null);
      return got > 0 ? buf.subarray(0, got) : null;
    },
  },
  unicode: {
    // 归一化、大小写与「这个码元属于哪一类」各要一张 Unicode 表，而那张表是数据，
    // 不是这一层能自制的。它属于世界这一侧：换一份表、或者换一个宿主，答案就可能不同 ——
    // 那正是「借」的意思，所以它在这里，而不是散在求值器里。
    //
    // 这五条不需要效果：它们不读进程、不碰文件、不看时间，只查一张随宿主来的表。
    normalize: (s) => s.normalize("NFC"),
    upper: (s) => s.toUpperCase(),
    lower: (s) => s.toLowerCase(),
    isLetter: (s) => /\p{L}/u.test(s),
    isMark: (s) => /\p{M}/u.test(s),
  },
});

// 能力报告：把一份能力说成「类」与「限制」，不说版本，也不说路径。
//
// 这一条是从 oak-barrels 学来的（它的协议第 4.3 节）：兼容性是一个类，
// 不是一个版本号。一个「我支持文件读写」的答案，比「我支持某个版本」稳定得多 ——
// 前者在版本变动之后仍然成立。
//
// 「不说路径」是同一条的另一面：一份报告不该顺手把机器的布局说出去。
//
// 类不是从「有没有那个函数」推断出来的：空的成员也是函数（一调就拒），
// 于是推断会把一份空能力报成什么都会。类由能力对象自己声明，而这里只做两件事 ——
// 把声明换算成类名，以及检查「声明了但成员不在」的那部分。后者是过宣称的守卫：
// 说了自己会做而做不到，比什么都别说糟。
const 类表 = {
  "io.file.read_write": [["file", "read"], ["file", "write"]],
  "io.file.exists": [["file", "exists"]],
  "io.file.directories": [["file", "ensureDir"]],
  "process.spawn": [["process", "exec"]],
  "process.argv": [["process", "argv"]],
  "process.directory": [["process", "chdir"]],
  "time.wall_clock": [["time", "now"]],
  "time.sleep": [["time", "sleep"]],
  "env.locations": [["env", "home"], ["env", "temp"]],
  "env.variables": [["env", "get"]],
  "path.manipulate": [["path", "join"]],
  "terminal.size": [["terminal", "size"]],
  "terminal.escape": [["terminal", "escape"]],
  "terminal.raw_input": [["terminal", "setRaw"]],
  "terminal.read": [["terminal", "readSync"]],
  "text.unicode.normalize": [["unicode", "normalize"]],
  "text.unicode.properties": [["unicode", "isLetter"]],
  "text.unicode.case": [["unicode", "upper"], ["unicode", "lower"]],
  "thread.spawn": [["thread", "spawn"]],
};

export const 报告 = (cap) => {
  const 声明 = Array.isArray(cap && cap.声明) ? cap.声明 : [];
  const 类 = [];
  const 缺 = [];
  for (const 名 of 声明) {
    const 需要 = 类表[名];
    if (!需要) { 缺.push(名 + "（没有这样一类）"); continue; }
    if (需要.every(([组, 成员]) => cap[组] && typeof cap[组][成员] === "function")) 类.push(名);
    else 缺.push(名);
  }
  // 组数只说「有几组」，不列组名：组名比类名更接近实现细节，而报告要的是能力。
  // 声明 那一项不算一组 —— 它是单子本身，不是一种能力。
  const 组数 = cap ? Object.keys(cap).filter((k) => k !== "声明").length : 0;
  return { 类, 缺, 组数 };
};

// 一份「什么都不做」的能力，给只想知道「这一段用到哪些能力」的调用方用：
// 任何一次真的访问都会被记下来并抛，于是漏掉的能力会当场说出来，而不是静默成功。
export const 空能力 = (记下) => {
  const 拒 = (组, 名) => (...args) => {
    if (记下) 记下(组 + "." + 名);
    throw new Error("这一份能力没有实现：" + 组 + "." + 名);
  };
  const 组 = (名, 项目们) => {
    const out = {};
    for (const 项 of 项目们) out[项] = 拒(名, 项);
    return out;
  };
  return {
    // 一份什么都不做的能力，声明是空的：报告会说它一类都不会。
    // 这正是「拒绝优于过宣称」的那一条 —— 它不假装自己会做什么。
    声明: [],
    file: 组("file", ["read", "exists", "write", "writeText", "writeBytes", "f64Bytes", "packValue", "stream", "ensureDir", "remove"]),
    process: 组("process", ["argv", "exec", "chdir", "cwd"]),
    time: 组("time", ["now", "sleep"]),
    env: 组("env", ["home", "temp", "get", "platform"]),
    path: 组("path", ["join", "resolve", "dirname", "basename", "isAbsolute"]),
    terminal: 组("terminal", ["size", "clear", "escape", "color", "hide", "show", "isTTY", "setRaw", "readSync"]),
    thread: 组("thread", ["spawn", "signal", "load", "store", "wait"]),
    unicode: 组("unicode", ["normalize", "upper", "lower", "isLetter", "isMark"]),
  };
};
