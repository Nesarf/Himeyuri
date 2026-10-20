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
  thread: 线程能力(),
  file: {
    read: (p) => fs.readFileSync(p),
    exists: (p) => fs.existsSync(p),
    write: (p, buf) => fs.writeFileSync(p, buf),
    // 建目录不让它失败：已经在就算了。这一条与「写」分开，因为「准备一个地方」
    // 与「往里写东西」是两件事，而契约里只有后者要求 file 效果。
    ensureDir: (p) => { try { fs.mkdirSync(p, { recursive: true }); } catch (err) { /* 已经在就算了 */ } },
    // 删一个文件，删不掉就算了：调用方在收尾，而收尾失败不该变成一条诊断。
    remove: (p) => { try { fs.unlinkSync(p); } catch (err) { /* 没有就算了 */ } },
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
});

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
    file: 组("file", ["read", "exists", "write"]),
    process: 组("process", ["argv", "exec", "chdir", "cwd"]),
    time: 组("time", ["now", "sleep"]),
    env: 组("env", ["home", "temp"]),
    path: 组("path", ["join", "resolve", "dirname", "basename"]),
    terminal: 组("terminal", ["size", "clear", "escape", "color", "hide", "show"]),
  };
};
