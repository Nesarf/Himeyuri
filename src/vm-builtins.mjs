// 字节码那份执行器的内置表：二十一个，与 src/minimal-eval.mjs 里那张表一一对应。
//
// 两张表不一致时行为会分叉，而分叉的那一头最容易被漏掉。所以这里不另写一套逻辑：
// 每一条都照 minimal-eval 的实现抄，只把形状从 (rt, args) 换成 { 效果, 做(vm, args) }——
// 「需不需要效果」从一张旁表挪到条目自己身上，于是少了一处对不上。
//
// 失败用 return vm.坏(...)：坏 记下停机原因并交回 null，于是「出错之后这一条不该继续算」
// 写在每一处，而不是靠一个异常替人记着。这一版把十处都改了——漏一处的话，
// 后面那几行会用 undefined 接着算，而那种错比抛出来难查得多。
//
// 世界仍然从那一个对象里取（vm.cap）。这一份文件不 import 任何 node: 模块。
//
// 字符串的底由 vm.文 决定（src/text-impl.mjs）：默认宿主串，也可以换成码元序列。
// 所以这一份里不写死 文.，而是问那个对象 —— 于是两条执行路可以带着同一个选项跑。
import { 类元组, 类记录 } from "./vm-values.mjs";
// 数的意思只在 src/numbers.mjs 里定义。这一份不再自己写「向下取整」或「把字符串变成数」，
// 也不再自己判断「这是不是数」——换掉标量时要改的是那一份文件。
import * as 数 from "./numbers.mjs";

// 线程句柄表：一个 worker 一行。
//
// 它放在模块级而不是机器里，因为线程表跟进程走、不跟机器走 ——
// 一个进程里能起的线程数是进程的事，不是某一台虚拟机的事。
// 这也是「两台字节码机各跑一段、互不干扰」与「一个进程里有几个线程」
// 之所以是两件事的原因。
const 线程们 = new Map();
let 下一个线程号 = 1;

// CRC32 的表：256 项，第一次用时生成。与 src/eval.mjs 和 C 那台同一张表
// （多项式 0xEDB88320），于是三处对同一串字节给出同一个值。
let 校验表缓存 = null;const 取校验表 = () => {
  if (校验表缓存) return 校验表缓存;
  const 表 = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    表.push(c >>> 0);
  }
  校验表缓存 = 表;
  return 表;
};
// 哪一层是码元序列，问它 —— 只为了一处：空串要交回那个底上的空值。
import { 码元串层 } from "./text-impl.mjs";
import { 藏路径, 在用脱敏 } from "./redact.mjs";

// locale 的名字与当前选择。四套档案由 design/LOCALES.txt 定义，
// 这里只认名字，不做格式化 —— 格式化在标准库里。
const locale名字们 = ["zh-CN.gbk", "zh-CN.utf8", "ja-JP.shift_jis", "en-US.utf8"];
let 当前locale = "";

// 键队列：套件塞键、真终端读键，共用这一条。无界（C 那台 64 项有界，写在契约里）。
const 键队列 = [];

export const 内置表 = {
  // 32 位位运算：与另两份解释器同一套语义。
  位与: { 做: (vm, a) => 数.造(数.下整(vm.成数(a[0])) & 数.下整(vm.成数(a[1]))) },
  位或: { 做: (vm, a) => 数.造((数.下整(vm.成数(a[0])) | 数.下整(vm.成数(a[1]))) >>> 0) },
  位异或: { 做: (vm, a) => 数.造((数.下整(vm.成数(a[0])) ^ 数.下整(vm.成数(a[1]))) >>> 0) },
  位非: { 做: (vm, a) => 数.造((~数.下整(vm.成数(a[0]))) >>> 0) },
  位右移: { 做: (vm, a) => 数.造((数.下整(vm.成数(a[0])) >>> (数.下整(vm.成数(a[1])) & 31)) >>> 0) },
  位加: { 做: (vm, a) => 数.造((数.下整(vm.成数(a[0])) + 数.下整(vm.成数(a[1]))) >>> 0) },
  位循环右移: { 做: (vm, a) => {
    const x = 数.下整(vm.成数(a[0])) >>> 0;
    const n = 数.下整(vm.成数(a[1])) & 31;
    return 数.造(n === 0 ? x : ((x >>> n) | (x << (32 - n))) >>> 0);
  } },
  位循环左移: { 做: (vm, a) => {
    const x = 数.下整(vm.成数(a[0])) >>> 0;
    const n = 数.下整(vm.成数(a[1])) & 31;
    return 数.造(n === 0 ? x : ((x << n) | (x >>> (32 - n))) >>> 0);
  } },
  // 可变数组：与解释器同一个约定 —— 一个 tag 为 array 的值，设 原地改。
  数组: { 做: (vm, a) => {
    const t = a[0];
    if (!t || t.tag !== "tuple") return vm.坏("HMYR-R0150", "数组() 要一个元组");
    return { tag: "array", items: [...t.items] };
  } },
  设: { 做: (vm, a) => {
    const 列 = a[0];
    if (!列 || 列.tag !== "array") {
      return vm.坏("HMYR-R0151", "设() 的第一个参数必须是 数组() 造出来的可变数组");
    }
    const i = 数.下整(vm.成数(a[1]));
    if (数.比(i, 0) < 0 || 数.比(i, 列.items.length) >= 0) {
      return vm.坏("HMYR-R0152", "下标越出数组：" + i + "（长度 " + 列.items.length + "）");
    }
    列.items[i] = a[2];
    return 列;
  } },
  len: { 做: (vm, a) => {
    const v = a[0];
    if (vm.文.是串(v)) return 数.造(vm.文.长(v));
    if (v && (v.tag === "tuple" || v.tag === "array")) return 数.造(v.items.length);
    return vm.坏("HMYR-R0140", "len() wants a string or a tuple");
  } },
  // 交回的必须是「语言的字符串值」，不是宿主串 —— 在当前那个底上要用当前底的表示。
  // 少了 由宿主 这一步，str() 在码元序列底上会把一个宿主串塞进值域，下一次 len 就报 R0140。
  str: { 做: (vm, a) => vm.文.由宿主(vm.成串(a[0])) },
  slice: { 做: (vm, a) => {
    // 码元序列与宿主串各切一遍。夹界的规矩两边一致，所以结果也一致。
    const v = a[0];
    const 是码元 = vm.文 === 码元串层;
    const s = 是码元 ? v : vm.成串(v);
    const 长 = vm.文.长(s);
    const 起原 = a[1] === undefined || a[1] === null ? 0 : 数.下整(vm.成数(a[1]));
    const 起 = 数.比(起原, 0) < 0 ? 0 : 起原;
    const 止原 = a[2] === undefined || a[2] === null ? 长 : 数.下整(vm.成数(a[2]));
    const 止 = 数.比(止原, 长) > 0 ? 长 : 止原;
    if (数.比(起, 止) >= 0) return 是码元 ? vm.文.由宿主("") : "";
    return vm.文.切(s, 起, 止);
  } },
  // 切开一个字符串。切法照宿主那一份：空分隔按码元切（空串给空元组），
  // 其余按不重叠的子串切，连续或末尾的分隔留下空段。
  // 先落到宿主串再切，是为了两种底（宿主串与码元序列）走同一条判断。
  split: { 做: (vm, a) => {
    const s = String(vm.成串(a[0]));
    const d = String(vm.成串(a[1]));
    return new 类元组(s.split(d).map((x) => vm.文.由宿主(x)));
  } },
  // ---- 线程：一个 worker 一个线程，结果经文件送达 ----
  // 与宿主那一侧同一套做法（见 src/eval.mjs 的线程那一段）。差别只在 worker 里
  // 跑的是哪台机器：这一份跑字节码机（src/thr-worker-vm.mjs），所以「同一段源码
  // 在另一个线程上得到同一个答案」是同一台机器给的，不是另一台替它答的。
  //
  // 两处为什么照抄而不抽出共用：宿主那份用的是 rt.cap，这份用的是 vm.cap，
  // 而两边的失败语义不同（一个抛、一个交回停机记录）。抽出来的共用要同时满足
  // 两种，那层抽象比两份各三十行更难读。
  thr_spawn: { 效果: "thread", 做: (vm, a) => {
    // 档位里「线程池」那一项在这里落地 —— 在那之前它只是预设里的一个数字，没人读。
    // 0 表示不设限：普通 .hmoca 的跑法不该因为多了两档而变。
    const 上限 = vm.cap.thread.上限 || 0;
    if (上限 > 0 && 线程们.size >= 上限) {
      return vm.坏("HMYR-R0223", "thread pool is full: " + 线程们.size + " alive, limit " + 上限 + "（steady 那一档只给一个；要更多就用 hmhsr 那一档）");
    }
    const source = String(vm.成串(a[0]));
    const entry = String(vm.成串(a[1]));
    const id = 下一个线程号++;
    // 这一份不 import node:，所以不取 process.pid —— 用时间戳加序号起名。
    // 同一进程里序号本来就不重复；跨进程撞名的概率低到可以接受，
    // 而真撞了也只是两份临时结果互相覆盖 —— 那种情形下两边跑的是同一段程序。
    const outPath = vm.cap.path.join(vm.cap.env.temp(), "hmyr-vmthread-" + Date.now().toString(36) + "-" + id + ".json");
    const flag = vm.cap.thread.signal();
    const handle = { id, flag, outPath, worker: null };
    handle.worker = vm.cap.thread.spawn(new URL("./thr-worker-vm.mjs", import.meta.url), { source, entry, outPath, flag });
    // 起不来就交回 -1（一个无效句柄）。那不是「拒绝」，是这个线程压根没出生，
    // 而调用方拿到 -1 之后 join 会得到 R0221 —— 一条路，不是两条。
    if (!handle.worker) return 数.造(-1);
    handle.worker.on("error", () => vm.cap.thread.store(handle.flag, 9));
    // 不让一个还活着的线程拖住整个进程：宿主该退就退。
    if (typeof handle.worker.unref === "function") handle.worker.unref();
    handle.worker.on("exit", (code) => {
      if (vm.cap.thread.load(handle.flag) === 0) vm.cap.thread.store(handle.flag, code === 0 ? 1 : 9);
    });
    线程们.set(id, handle);
    return 数.造(id);
  } },
  thr_join: { 做: (vm, a) => {
    const id = 数.下整(vm.成数(a[0]));
    const h = 线程们.get(id);
    if (!h) return vm.坏("HMYR-R0221", "no such thread handle: " + id);
    const 限 = a[1] === undefined || a[1] === null ? 30000 : 数.下整(vm.成数(a[1]));
    const 到 = Date.now() + 限;
    while (vm.cap.thread.load(h.flag) === 0) {
      const 剩 = 到 - Date.now();
      if (剩 <= 0) return vm.坏("HMYR-R0222", "thread " + id + " did not finish within " + 限 + "ms");
      vm.cap.thread.wait(h.flag, 剩 < 50 ? 剩 : 50);
    }
    let 结果 = null;
    try { 结果 = JSON.parse(String(vm.cap.file.read(h.outPath))); } catch (err) { 结果 = null; }
    try { vm.cap.file.remove(h.outPath); } catch (err) { /* 已经没了就算清过 */ }
    线程们.delete(id);
    // 线程里失败时交回空串，与宿主那一侧同一个选择：失败不是这一门语言的值。
    if (!结果 || !结果.ok) return vm.文.由宿主("");
    return vm.文.由宿主(String(结果.text));
  } },
  thr_cancel: { 效果: "thread", 做: (vm, a) => {
    const id = 数.下整(vm.成数(a[0]));
    const h = 线程们.get(id);
    if (!h) return vm.坏("HMYR-R0221", "no such thread handle: " + id);
    try { if (h.worker) h.worker.terminate(); } catch (err) { /* 已经没了就算停住 */ }
    try { vm.cap.file.remove(h.outPath); } catch (err) { /* 同上 */ }
    线程们.delete(id);
    return 数.造(id);
  } },
  thr_count: { 做: (vm) => 数.造(Array.from(线程们.values()).filter((h) => vm.cap.thread.load(h.flag) === 0).length) },
  // arena：区在这一台也是真的了（2026-10-27）。交回的是一条索引 —— 与自举层
  // （self/eval.hmoca）同一个表示，因为 close 要改状态而记录不可变。
  // 六个方法由 vm.mjs 的 CALLM 分派，分派表在文件末尾的 调区方法。
  arena: { 做: () => 新区() },
  // owned：单一所有者的持有格（design/MEMORY.txt 第 2 节）。
  // 只装零个或一个值，取出即转移。四个动作由 调区方法 的 owner 分支分派。
  // owned：单一所有者的持有格（design/MEMORY.txt 第 2 节）。四条动作由 调区方法 的
  // owner 分支分派；建出来的格子登记到当前帧，帧退出时会被关掉。
  owned: { 做: (vm) => {
    const 格 = 新持有格();
    const 帧 = vm && vm.当前帧;
    if (帧 && 帧.持有格们) 帧.持有格们.push(格);
    return 格;
  } },
  // 字节元组转文本：按 UTF-8 解码。read_stdin_bytes 交回字节，而请求体是 UTF-8。
  bytes_to_text: { 做: (vm, a) => {
    const 项们 = a[0].items;
    const 字节们 = [];
    for (let i = 0; i < 项们.length; i++) 字节们.push(数.下整(项们[i].num) & 0xFF);
    return vm.文.由宿主(Buffer.from(字节们).toString("utf8"));
  } },
  // 从标准输入读 N 个字节：交回 {字节们, 结束}。结束表示没读满（EOF 先到了）。
  read_stdin_bytes: { 做: (vm, a) => {
    const 原 = 数.下整(vm.成数(a[0]));
    const n = 数.比(原, 0) < 0 ? 0 : 原;
    const 字节们 = [];
    while (字节们.length < n) {
      let b;
      try { b = vm.cap.terminal.readSync(n - 字节们.length); } catch { b = null; }
      if (!b || b.length === 0) break;
      for (let i = 0; i < b.length; i++) 字节们.push(b[i]);
    }
    return new 类记录(new Map([
      ["字节们", new 类元组(字节们.map((x) => 数.造(x)))],
      ["结束", 字节们.length < n],
    ]));
  } },
  // 从标准输入读一行：交回 {行, 结束}。结束是 EOF，与空行是两件事。
  read_stdin_line: { 做: (vm) => {
    const 段们 = [];
    let 结束 = false;
    for (;;) {
      let b;
      try { b = vm.cap.terminal.readSync(1); } catch { b = null; }
      if (!b || b.length === 0) { 结束 = true; break; }
      if (b[0] === 10) break;
      段们.push(b);
    }
    let s = Buffer.concat(段们).toString("utf8");
    // 去尾 CR 不用宿主方法：这一份里有断言盯着「不借字符串的方法」。
    if (s.length > 0 && s[s.length - 1] === "\r") {
      let t = "";
      for (let i = 0; i < s.length - 1; i++) t += s[i];
      s = t;
    }
    return new 类记录(new Map([["行", vm.文.由宿主(s)], ["结束", 结束]]));
  } },
  // 原始字节：嵌入与打包要它。read_text 会按 UTF-8 解码，二进制一过就坏。
  read_bytes: { 效果: "file", 做: (vm, a) => {
    const 路径 = vm.成串(a[0]);
    try {
      const buf = vm.cap.file.read(路径);
      return new 类元组(Array.from(buf).map((b) => 数.造(b)));
    } catch { return vm.坏("HMYR-R0211", "cannot read '" + 路径 + "'"); }
  } },
  // ---- 进程：改工作目录 ----
  // 成功交回新的目录（与宿主那一份同一条约定）；进不去报 R0209。
  chdir: { 效果: "process", 做: (vm, a) => {
    const 目标 = vm.成串(a[0]);
    try {
      vm.cap.process.chdir(目标);
      return vm.文.由宿主(vm.cap.process.cwd());
    } catch { return vm.坏("HMYR-R0209", "cannot enter '" + 目标 + "'"); }
  } },
  // 跑一个程序：结果是一份记录，五个字段。跑不起来也照实报告，不抛。
  run_program: { 效果: "process", 做: (vm, a) => {
    const 命令 = vm.成串(a[0]);
    if (命令 === "") return vm.坏("HMYR-R0213", "run_program needs a program name: an empty string names nothing");
    const 参们 = a[1] && a[1].tag === "tuple" ? a[1].items.map((x) => vm.成串(x)) : [];
    const 超时 = a[2] === undefined || a[2] === null ? 10000 : vm.成数(a[2]);
    const 编码 = a[3] === undefined || a[3] === null ? "utf8" : vm.成串(a[3]);
    const r = vm.cap.process.exec(命令, 参们, { timeout: 超时, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    const 解 = (buf) => {
      try { return new TextDecoder(编码 === "gbk" || 编码 === "gb2312" ? "gbk" : "utf-8").decode(buf || new Uint8Array()); }
      catch { return String(buf || ""); }
    };
    const 去尾 = (s) => String(s).replace(/[ \t\r\n]+$/, "");
    return new 类记录(new Map([
      ["code", 数.造(typeof r.status === "number" ? r.status : -1)],
      ["stdout", vm.文.由宿主(去尾(解(r.stdout)))],
      ["stderr", vm.文.由宿主(去尾(解(r.stderr)))],
      ["timedOut", !!(r.error && r.error.code === "ETIMEDOUT")],
      ["error", r.error ? vm.文.由宿主(String(r.error.code || r.error.message)) : null],
    ]));
  } },
  // ---- 环境与路径：读这台机器在哪儿 ----
  // 两台机器给出不同的字符串是对的：契约写的是「读宿主的位置」，
  // 不是「所有宿主必须同名」。测试因此只断言形状与结尾。
  // 两个如实说「没有」的：repo_path 只用设了的根，python_path 只认环境变量。
  cwd: { 做: (vm) => vm.文.由宿主(vm.cap.process.cwd()) },
  home_dir: { 做: (vm) => vm.文.由宿主(vm.cap.env.home()) },
  temp_path: { 做: (vm, a) => {
    const 目录 = vm.cap.env.get("HMYR_TMP") || vm.cap.env.temp();
    vm.cap.file.ensureDir(目录);
    return vm.文.由宿主(vm.cap.path.join(目录, "hmyr-" + vm.成串(a[0])));
  } },
  repo_path: { 做: (vm, a) => vm.文.由宿主(vm.cap.path.resolve(vm.cap.path.root(), vm.成串(a[0]))) },
  python_path: { 做: (vm) => vm.文.由宿主(vm.cap.env.get("HMYR_PYTHON") || "python") },
  locale_current: { 做: (vm) => vm.文.由宿主(当前locale) },
  locale_set: { 做: (vm, a) => {
    const 名 = vm.成串(a[0]);
    if (!locale名字们.includes(名)) {
      return vm.坏("HMYR-R0205", "no such locale profile: '" + 名 + "' (have: " + locale名字们.join(", ") + ")");
    }
    当前locale = 名;
    return vm.文.由宿主(当前locale);
  } },
  locale_env: { 做: (vm) => vm.文.由宿主(vm.cap.env.localeGuess()) },
  console_codepage: { 做: (vm) => vm.文.由宿主(vm.cap.env.codepage()) },
  // ---- 输入：一条键队列 ----
  // 队列里有东西就交回队首；空而 stdin 是终端才同步读一次（读完把多余的推进队列）；
  // 空而 stdin 不是终端就交回空串 —— 不阻塞，也没有键。
  key_push: { 做: (vm, a) => { 键队列.push(vm.成串(a[0])); return 数.造(键队列.length); } },
  key_available: { 做: () => 键队列.length > 0 },
  key_read: { 做: (vm) => {
    if (键队列.length) return vm.文.由宿主(键队列.shift());
    if (!vm.cap.terminal.isTTY()) return vm.文.由宿主("");
    try {
      const buf = vm.cap.terminal.readSync(64);
      if (buf && buf.length > 0) {
        for (const ch of buf.toString("utf8")) 键队列.push(ch);
        return vm.文.由宿主(键队列.length ? 键队列.shift() : "");
      }
    } catch { /* 读不到就是没有键 */ }
    return vm.文.由宿主("");
  } },
  key_start: { 做: (vm, a) => !!vm.cap.terminal.setRaw(a[0] === true) },
  // ---- 时间：读一次钟，或等一会儿 ----
  // 它们破坏可复现性（CAPABILITIES.txt 第六组），所以测试只断言形状。
  now_ms: { 做: (vm) => 数.造(vm.cap.time.now()) },
  sleep_ms: { 做: (vm, a) => {
    const n = 数.下整(vm.成数(a[0]));
    const ms = 数.比(n, 0) < 0 ? 0 : n;
    if (数.比(ms, 0) > 0) vm.cap.time.sleep(ms);
    return 数.造(ms);
  } },
  // ---- 终端：只交回字符串，一个字都不写出去 ----
  // 副作用留给 print：这里算出来的是「该写什么」，于是测试能断言它们，
  // 而板子没有终端也不会假装有。数的意思仍然只走 src/numbers.mjs。
  term_size: { 做: (vm) => {
    const s = vm.cap.terminal.size();
    return new 类元组([数.造(s.rows), 数.造(s.columns)]);
  } },
  term_clear: { 做: (vm) => vm.文.由宿主("\u001b[2J") },
  term_hide: { 做: (vm) => vm.文.由宿主("\u001b[?25l") },
  term_show: { 做: (vm) => vm.文.由宿主("\u001b[?25h") },
  term_escape: { 做: (vm, a) => {
    const 取 = (x) => {
      const n = 数.下整(vm.成数(x));
      return 数.比(n, 1) < 0 ? 1 : n;
    };
    return vm.文.由宿主("\u001b[" + 数.成文(取(a[0])) + ";" + 数.成文(取(a[1])) + "H");
  } },
  term_color: { 做: (vm, a) => {
    const fg = 数.下整(vm.成数(a[0]));
    if (数.比(fg, 0) < 0) return vm.文.由宿主("\u001b[0m");
    const bg = a[1] === undefined || a[1] === null ? -1 : 数.下整(vm.成数(a[1]));
    return vm.文.由宿主(数.比(bg, 0) < 0
      ? "\u001b[38;5;" + 数.成文(fg) + "m"
      : "\u001b[38;5;" + 数.成文(fg) + ";48;5;" + 数.成文(bg) + "m");
  } },
  // 取第一个码元的码点。空串拒绝（R0206），理由与最小求值器那一份相同。
  ord: { 做: (vm, a) => {
    const s = vm.成串(a[0]);
    if (s.length === 0) return vm.坏("HMYR-R0206", "ord of an empty string: there is no first character to read");
    return s.codePointAt(0);
  } },
  // 大小写：与最小求值器那一份同一个安排 —— 表在能力层，这里只转发。
  to_upper: { 做: (vm, a) => vm.文.由宿主(vm.cap.unicode.upper(vm.成串(a[0]))) },
  to_lower: { 做: (vm, a) => vm.文.由宿主(vm.cap.unicode.lower(vm.成串(a[0]))) },
  chr: { 做: (vm, a) => {
    const cp = 数.下整(vm.成数(a[0]));
    if (数.比(cp, 0) < 0 || 数.比(cp, 0x10ffff) > 0) return vm.坏("HMYR-R0207", "not a code point: " + 数.成文(cp));
    return vm.文.码点(cp);
  } },
  to_int: { 做: (vm, a) => {
    const s = vm.成串(a[0]).trim();
    if (!/^-?[0-9]+$/.test(s)) return vm.坏("HMYR-R0208", "not an integer literal: '" + s + "'");
    return 数.解析(s);
  } },
  // 算术那一组：纯函数，不碰世界。字节码那条路上一直缺它们 ——
  // 于是同一个程序在宿主求值器上跑得动，编成字节码就报「没有这个内置」。
  // 全落进 numbers 模块：内置表里自己写一个取绝对值的算式，会让「数的意思收在一处」破一个口。
  abs: { 做: (vm, a) => 数.绝对(vm.成数(a[0])) },
  floor: { 做: (vm, a) => 数.下整(vm.成数(a[0])) },
  int: { 做: (vm, a) => 数.截断(vm.成数(a[0])) },
  min: { 做: (vm, a) => {
    if (a.length === 0) return vm.坏("HMYR-R0101", "min wants at least one argument");
    return 数.最小(a.map((x) => vm.成数(x)));
  } },
  max: { 做: (vm, a) => {
    if (a.length === 0) return vm.坏("HMYR-R0101", "max wants at least one argument");
    return 数.最大(a.map((x) => vm.成数(x)));
  } },
  // 归一化与 Unicode 属性要一张字符表，而那张表是数据 —— 它住在能力层的 unicode 组里。
  // 于是内置表不再直接对宿主串调 normalize，也不再自己写一条属性正则。
  // 值先写成宿主串（那张表是按宿主串查的），回来再落到选定的那种底上。
  nfc: { 做: (vm, a) => vm.文.由宿主(vm.cap.unicode.normalize(vm.成串(a[0]))) },
  is_letter: { 做: (vm, a) => vm.cap.unicode.isLetter(vm.成串(a[0])) },
  is_mark: { 做: (vm, a) => vm.cap.unicode.isMark(vm.成串(a[0])) },
  // ---- 索引 ----
  // 值形状是 { tag: "index", m: Map }，与记录/元组同一层：靠传递，没有就地改动。
  // 约定见 design/INDEX.txt。
  index_new: { 做: () => ({ tag: "index", m: new Map() }) },
  index_set: { 做: (vm, a) => {
    const 表 = a[0];
    if (!表 || 表.tag !== "index") return vm.坏("HMYR-R0219", "index_set wants an index, found " + 述(表, vm.文));
    表.m.set(vm.成串(a[1]), a[2]);
    return 表;
  } },
  index_get: { 做: (vm, a) => {
    const 表 = a[0];
    if (!表 || 表.tag !== "index") return vm.坏("HMYR-R0219", "index_get wants an index, found " + 述(表, vm.文));
    const k = vm.成串(a[1]);
    if (!表.m.has(k)) return vm.坏("HMYR-R0218", "no key " + JSON.stringify(k) + " in that index");
    return 表.m.get(k);
  } },
  index_has: { 做: (vm, a) => {
    const 表 = a[0];
    if (!表 || 表.tag !== "index") return false;
    return 表.m.has(vm.成串(a[1]));
  } },
  index_len: { 做: (vm, a) => {
    const 表 = a[0];
    if (!表 || 表.tag !== "index") return vm.坏("HMYR-R0219", "index_len wants an index, found " + 述(表, vm.文));
    return 表.m.size;
  } },
  index_keys: { 做: (vm, a) => {
    const 表 = a[0];
    if (!表 || 表.tag !== "index") return vm.坏("HMYR-R0219", "index_keys wants an index, found " + 述(表, vm.文));
    return new 类元组([...表.m.keys()]);
  } },
  record_new: { 做: (vm, a) => {
    const pairs = a[0];
    if (!pairs || pairs.tag !== "tuple") return vm.坏("HMYR-R0214", "record_of wants a tuple of (name, value) pairs");
    const 字段 = new Map();
    for (const p of pairs.items) {
      if (!p || p.tag !== "tuple" || p.items.length !== 2) return vm.坏("HMYR-R0214", "every item must be a (name, value) pair");
      const k = vm.成串(p.items[0]);
      if (!/^[\p{L}_][\p{L}\p{N}\p{M}_]*$/u.test(k)) return vm.坏("HMYR-R0214", "not a name a record could hold: " + JSON.stringify(k));
      字段.set(k, p.items[1]);
    }
    return new 类记录(字段);
  } },
  field_get: { 做: (vm, a) => {
    const rec = a[0], name = vm.成串(a[1]);
    if (!rec || rec.tag !== "record") return vm.坏("HMYR-R0215", "field_get wants a record, found " + 述(rec, vm.文));
    if (!rec.fields.has(name)) return vm.坏("HMYR-R0216", "no field '" + name + "' on that record");
    return rec.fields.get(name);
  } },
  field_has: { 做: (vm, a) => {
    const rec = a[0], name = vm.成串(a[1]);
    if (!rec || rec.tag !== "record") return false;
    return rec.fields.has(name);
  } },
  // 字段名的列表，按造记录时的顺序。交回一个元组，不是 JS 数组 ——
  // 两个求值器之间是同一套值，这一条与 argv 那一处同一个理由。
  field_names: { 做: (vm, a) => {
    const rec = a[0];
    if (!rec || rec.tag !== "record") return vm.坏("HMYR-R0217", "field_names wants a record, found " + 述(rec, vm.文));
    return new 类元组([...rec.fields.keys()]);
  } },
  // 写一份文本。与最小求值器那一份同一个边界：只认 utf8。
  write_text: { 效果: "file", 做: (vm, a) => {
    const 路径 = vm.成串(a[0]);
    const 文 = vm.成串(a[1]);
    try { vm.cap.file.writeText(路径, 文); }
    catch (err) {
      const 原因 = 在用脱敏() ? "" : ": " + String(err && err.message ? err.message : err);
      return vm.坏("HMYR-R0212", "cannot write '" + 藏路径(路径) + "'" + 原因);
    }
    return 文.length;
  } },
  // 写一串字节。字节在语言里是「0 到 255 的整数元组」—— 这门语言没有字节类型。
  // 出口交给能力层，于是「字节怎么落成文件」不在求值器这一侧。
  write_bytes: { 效果: "file", 做: (vm, a) => {
    const 路径 = vm.成串(a[0]);
    const 元组 = a[1];
    if (!元组 || 元组.tag !== "tuple") return vm.坏("HMYR-R0130", "write_bytes wants a tuple of bytes");
    // 取整走 number 那一层，不在这里写 Math —— test/numbers.test.mjs 盯着这件事。
    // 元素可以是字节，也可以是一块字节（语言那边按块累积）。
    const 字节 = [];
    for (const x of 元组.items) {
      if (x && x.tag === "tuple") { for (const y of x.items) 字节.push(数.下整(vm.成数(y))); }
      else 字节.push(数.下整(vm.成数(x)));
    }
    try { vm.cap.file.writeBytes(路径, 字节); }
    catch (err) {
      const 原因 = 在用脱敏() ? "" : ": " + String(err && err.message ? err.message : err);
      return vm.坏("HMYR-R0212", "cannot write '" + 藏路径(路径) + "'" + 原因);
    }
    return 字节.length;
  } },
  // 双精度拆成 8 个字节（小端）。与 write_bytes 配套：语言里没有字节类型，
  // 所以「数怎么变成 8 个字节」由世界那一侧回答。
  f64_bytes: { 做: (vm, a) => {
    const 字节 = vm.cap.file.f64Bytes(vm.成数(a[0]));
    return new 类元组(字节.map((x) => x));
  } },
  // 把一个语言值编成 .hmyrb 里那一段字节。编码属于世界那一侧，
  // 因为语言里没有 typeof，也没有 try —— 判不出类型的编码器只会猜错。
  pack_value: { 做: (vm, a) => {
    try { return new 类元组(vm.cap.file.packValue(a[0])); }
    catch (err) { vm.坏("HMYR-R0214", "cannot encode this value: " + String(err && err.message ? err.message : err)); return null; }
  } },
  // 按行读：从偏移读一行，交回 {行, 下一起点}；读完交回 下一起点 = -1。
  // 语言里没有文件句柄，所以每次调用自己开、自己关 —— 语义封闭，能一段一段读。
  read_line: { 效果: "file", 做: (vm, a) => {
    const 路径 = vm.成串(a[0]);
    const 起 = 数.下整(vm.成数(a[1]));
    try {
      const r = vm.cap.file.readLine(路径, 起);
      return new 类记录(new Map([["行", r.行], ["下一起点", r.下一起点]]));
    } catch (err) {
      const 原因 = 在用脱敏() ? "" : ": " + String(err && err.message ? err.message : err);
      return vm.坏("HMYR-R0211", "cannot read '" + 藏路径(路径) + "'" + 原因);
    }
  } },
  // 整份按行切好。
  read_lines: { 效果: "file", 做: (vm, a) => {
    const 路径 = vm.成串(a[0]);
    try { return new 类元组(vm.cap.file.readLines(路径)); }
    catch (err) {
      const 原因 = 在用脱敏() ? "" : ": " + String(err && err.message ? err.message : err);
      return vm.坏("HMYR-R0211", "cannot read '" + 藏路径(路径) + "'" + 原因);
    }
  } },
  print: { 做: (vm, a) => { vm.write(a.map((x) => vm.成串(x)).join("")); return null; } },
  print_err: { 效果: "process", 做: (vm, a) => {
    const 文 = a.map((x) => vm.成串(x)).join("");
    if (vm.writeErr) vm.writeErr(文); else vm.write(a.map((x) => vm.成串(x)).join(""));
    return null;
  } },
  read_text: { 效果: "file", 做: (vm, a) => {
    // 路径与编码都是字符串值，先写成宿主串（文件系统只认那个）。
    const 路径 = vm.成串(a[0]);
    let buf;
    // 路径可以被藏起来（--redact 或 HMYR_REDACT），编号不动；宿主的原因也省掉，
    // 因为它通常带着同一条路径。
    try { buf = vm.cap.file.read(路径); }
    catch (err) {
      const 原因 = 在用脱敏() ? "" : ": " + String(err && err.message ? err.message : err);
      return vm.坏("HMYR-R0211", "cannot read '" + 藏路径(路径) + "'" + 原因);
    }
    // 解出来的东西是语言里的字符串值，所以最后一跳要落到选定的那种底上。
    const 出 = (文) => vm.文.由宿主(文);
    const enc = a[1] === undefined || a[1] === null ? null : vm.成串(a[1]);
    if (enc) {
      const 名 = enc.toLowerCase();
      if (名 === "utf8" || 名 === "utf-8") return 出(buf.toString("utf8"));
      if (名 === "utf16le" || 名 === "utf-16le") return 出(new TextDecoder("utf-16le").decode(buf));
      if (名 === "latin1") return 出(buf.toString("latin1"));
      return vm.坏("HMYR-R0212", "this runtime cannot decode '" + enc + "'");
    }
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 出(buf.subarray(3).toString("utf8"));
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 出(new TextDecoder("utf-16le").decode(buf.subarray(2)));
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 出(new TextDecoder("utf-16be").decode(buf.subarray(2)));
    return 出(buf.toString("utf8"));
  } },
  file_exists: { 效果: "file", 做: (vm, a) => {
    try { return vm.cap.file.exists(vm.成串(a[0])); } catch (err) { return false; }
  } },
  // 列目录交回元组（顺序由能力层排好）。写法与 argv 同一条路：
  // 值现在自己带标签，所以每个名字都要经过 vm.文.由宿主 落到选定的那种底上。
  read_dir: { 效果: "file", 做: (vm, a) => {
    const 路径 = vm.成串(a[0]);
    let 名们;
    try { 名们 = vm.cap.file.listDir(路径); }
    catch (err) {
      const 原因 = 在用脱敏() ? "" : ": " + String(err && err.message ? err.message : err);
      return vm.坏("HMYR-R0211", "cannot list '" + 藏路径(路径) + "'" + 原因);
    }
    return new 类元组(名们.map((x) => vm.文.由宿主(String(x))));
  } },
  // 这是不是一个目录。递归要走下去就得先问这一句；问不到就是 false。
  is_dir: { 效果: "file", 做: (vm, a) => {
    try { return vm.cap.file.isDir(vm.成串(a[0])); } catch (err) { return false; }
  } },
  // CRC32：纯算术，不需要效果。参数收字节元组，元素可以是一字节，也可以是一块。
  校验和: { 做: (vm, a) => {
    const 元组 = a[0];
    if (!元组 || 元组.tag !== "tuple") return vm.坏("HMYR-R0130", "校验和 wants a tuple of bytes");
    const 表 = 取校验表();
    let c = -1;
    // 长度取 items.length：这一侧的值是普通 JS 数组，ilen 是 C 那台的字段名。
    // 抄错一处不会报错 —— 循环零次，CRC 恒为 0。
    for (let i = 0; i < 元组.items.length; i++) {
      const x = 元组.items[i];
      if (x && x.tag === "tuple") {
        for (let k = 0; k < x.items.length; k++) {
          const b = vm.成数(x.items[k]) & 0xff;
          c = (c >>> 8) ^ 表[(c ^ b) & 0xff];
        }
      } else {
        const b = vm.成数(x) & 0xff;
        c = (c >>> 8) ^ 表[(c ^ b) & 0xff];
      }
    }
    return (c ^ -1) >>> 0;
  } },
  // 它交回的是一个元组，不是 JS 数组：值现在自己带标签，两个求值器之间也是同一套值。
  // 漏掉这一处会让 len(argv()) 报「要一个字符串或元组」——而那正是一次真实的失败。
  argv: { 效果: "process", 做: (vm) => new 类元组((vm.argv || []).map((x) => vm.文.由宿主(String(x)))) },
};

// 错误消息里要用「这个值长什么样」。这一份与 src/vm.mjs 里那份相同，而刻意不共享：
// 两个模块互相 import 会把依赖绕成环，而这两个小函数不值得为它绕环。
// 值现在自己带标签，所以这里不再靠 typeof 与 Array.isArray 去猜它是什么。
const 述 = (v, 文) => {
  if (v === null) return "nil";
  if (文.是串(v)) return JSON.stringify(文.成宿主(v));
  if (v && v.tag === "tuple") return "tuple";
  if (v && v.tag === "record") return "a host object";
  if (数.是数(v)) return 数.成文(v);
  return String(v);
};

// ---- 区：三区模型在字节码这一台的记账 ----
//
// 表示与自举层（self/eval.hmoca）一样：区是一条索引，键是「种 / 关 / 下一个 / 活 / 块N」；
// 块也是索引，键是「种 / zone / size / live / 号」。为什么用索引而不是记录 ——
// 记录不可变，而 close 要改状态，那是这件事的全部理由。
//
// 这是第三次实现（宿主求值器一份、自举层一份、这里一份）。重复是认下的代价：
// 三台机器各自要能跑同一段源码，而判据是「三台输出相同」，不是「三台共用一份实现」。
//
// 索引用 function 声明而不是 const：arena 那个内置在本文件靠前的位置就要调用 新区，
// 而 const 不提升、function 提升。
export function 是区(v) {
  return !!(v && v.tag === "index" && v.m.get("种") === "区");
}

export function 新区() {
  const m = new Map();
  m.set("种", "区");
  m.set("关", 0);
  m.set("下一个", 1);
  m.set("活", 0);
  return { tag: "index", m };
}

// 一个持有格：只装零个或一个值。取出即转移 —— 取走之后源这边空了。
export function 新持有格() {
  const m = new Map();
  m.set("kind", "owner");
  m.set("装", 0);
  m.set("值", null);
  m.set("关", 0);
  return { tag: "index", m };
}

// 交回 {值} 或 {码, 错}。码缺省是 R0302 —— 「拿到的不是那个区里活着的块」那一条。
export function 调区方法(主, 名, 参, vm) {
  // 块上的方法：存与取。块的上下文只有它自己，所以这两支必须挂在块上 ——
  // 而「块」在表示上是索引（kind = block），与区同一层。
  if (主 && 主.tag === "index" && 主.m.get("kind") === "block") {
    const 容量 = 主.m.get("size");
    const 格 = 主.m.get("格");
    if (名 === "存") {
      if (参.length !== 2) return { 错: "存 要两个参数" };
      const 位 = 参[0];
      if (typeof 位 !== "number" || 位 < 0 || 位 >= 容量) {
        return { 码: "HMYR-R0151", 错: "slot " + 位 + " is outside this block (size " + 容量 + ")" };
      }
      格.m.set(String(位), 参[1]);
      return { 值: 主 };
    }
    if (名 === "取") {
      if (参.length !== 1) return { 错: "取 要一个参数" };
      const 位 = 参[0];
      if (typeof 位 !== "number" || 位 < 0 || 位 >= 容量) {
        return { 码: "HMYR-R0151", 错: "slot " + 位 + " is outside this block (size " + 容量 + ")" };
      }
      return { 值: 格.m.has(String(位)) ? 格.m.get(String(位)) : null };
    }
    return { 错: "块上没有这个方法：" + 名 };
  }
  // 持有格上的四个动作（owned）。与区、块同一层：kind = owner。
  // 取出即转移：取走之后 装 变回 0，于是「两个变量都声称拥有它」不成立。
  if (主 && 主.tag === "index" && 主.m.get("kind") === "owner") {
    const 关 = 主.m.get("关");
    if (名 === "放") {
      if (参.length !== 1) return { 错: "放 要一个参数" };
      if (关 !== 0) return { 码: "HMYR-R0305", 错: "owned.放: this holder is already closed" };
      if (主.m.get("装") !== 0) return { 码: "HMYR-R0305", 错: "owned.放: this holder already owns a value; take it out first" };
      主.m.set("装", 1);
      主.m.set("值", 参[0]);
      // 放进去的若是一条持有格，它就从当前帧的登记表里移走 —— 「转移」的第二层意思，
      // 与自举层那一条同形。少了它，交出去的格子会被造它的帧关掉。
      const 帧 = vm && vm.当前帧;
      if (帧 && 帧.持有格们) {
        const at = 帧.持有格们.indexOf(参[0]);
        if (at >= 0) 帧.持有格们.splice(at, 1);
      }
      return { 值: 主 };
    }
    if (名 === "取") {
      if (参.length !== 0) return { 错: "取 不要参数" };
      if (关 !== 0) return { 码: "HMYR-R0305", 错: "owned.取: this holder is already closed" };
      if (主.m.get("装") !== 1) return { 码: "HMYR-R0306", 错: "owned.取: this holder is empty" };
      const v = 主.m.get("值");
      主.m.set("装", 0);
      主.m.set("值", null);
      return { 值: v };
    }
    if (名 === "有") return { 值: 主.m.get("装") };
    if (名 === "关") {
      主.m.set("装", 0);
      主.m.set("值", null);
      主.m.set("关", 1);
      return { 值: null };
    }
    return { 错: "持有格上没有这个方法：" + 名 };
  }
  if (!是区(主)) return { 错: "这一版只认区与块上的方法：" + 名 };
  const m = 主.m;  if (名 === "alloc") {
    if (参.length !== 1) return { 错: "alloc 要一个参数" };
    if (m.get("关") !== 0) return { 错: "arena.alloc: that arena is already closed" };
    const 号 = m.get("下一个");
    const 块 = new Map();
    块.set("种", "块");
    块.set("kind", "block");
    块.set("zone", "arena");
    块.set("size", 参[0]);
    块.set("live", 1);
    块.set("号", 号);
    // 块的格子：按下标的可变内容。没有它，块只有大小，于是「把值放进区里」写不出来。
    块.set("格", { tag: "index", m: new Map() });
    m.set("块" + 号, { tag: "index", m: 块 });
    m.set("下一个", 号 + 1);
    m.set("活", m.get("活") + 1);
    return { 值: { tag: "index", m: 块 } };
  }
  if (名 === "held") return { 值: m.get("活") };
  if (名 === "close") {
    // 交出去的那些归托管，close 不带它们走 —— 那正是 freeze 的全部意义。
    const 下一个 = m.get("下一个");
    for (let i = 1; i < 下一个; i++) {
      const 块 = m.get("块" + i);
      if (块 && 块.m.get("zone") === "arena") 块.m.set("live", 0);
    }
    m.set("关", 1);
    m.set("活", 0);
    return { 值: 0 };
  }
  if (名 === "freeze") {
    if (参.length !== 1) return { 错: "freeze 要一个参数" };
    if (m.get("关") !== 0) return { 错: "arena.freeze: that arena is already closed" };
    const 块 = 参[0];
    if (!块 || 块.tag !== "index" || 块.m.get("zone") !== "arena") {
      return { 错: "arena.freeze was given a block this arena does not own" };
    }
    块.m.set("zone", "managed");
    块.m.set("live", 1);
    m.set("活", m.get("活") - 1);
    return { 值: 块 };
  }
  if (名 === "adopt") {
    if (参.length !== 1) return { 错: "adopt 要一个参数" };
    if (m.get("关") !== 0) return { 错: "arena.adopt: that arena is already closed" };
    const 块 = 参[0];
    if (!块 || 块.tag !== "index" || 块.m.get("zone") !== "managed") {
      return { 码: "HMYR-R0303", 错: "arena.adopt: that block was not handed to the managed zone" };
    }
    块.m.set("zone", "arena");
    块.m.set("live", 1);
    m.set("活", m.get("活") + 1);
    return { 值: 块 };
  }
  return { 错: "区上没有这个方法：" + 名 };
}
