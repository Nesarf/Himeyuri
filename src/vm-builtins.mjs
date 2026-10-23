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
// 数的意思只在 src/numbers.mjs 里定义。这一份不再自己写 Math.floor / Number()，
// 也不再自己判断「这是不是数」——换掉标量时要改的是那一份文件。
import * as 数 from "./numbers.mjs";
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
  len: { 做: (vm, a) => {
    const v = a[0];
    if (vm.文.是串(v)) return 数.造(vm.文.长(v));
    if (v && v.tag === "tuple") return 数.造(v.items.length);
    return vm.坏("HMYR-R0140", "len() wants a string or a tuple");
  } },
  str: { 做: (vm, a) => vm.成串(a[0]) },
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
  // ---- 进程：改工作目录 ----
  // 成功交回新的目录（与宿主那一份同一条约定）；进不去报 R0209。
  chdir: { 效果: "process", 做: (vm, a) => {
    const 目标 = vm.成串(a[0]);
    try {
      vm.cap.process.chdir(目标);
      return vm.文.由宿主(vm.cap.process.cwd());
    } catch { return vm.坏("HMYR-R0209", "cannot enter '" + 目标 + "'"); }
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
  // 全落进 numbers 模块：内置表里写 Math.abs 会让「数的意思收在一处」破一个口。
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
