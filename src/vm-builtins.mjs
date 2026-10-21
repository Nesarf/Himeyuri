// 字节码那份执行器的内置表：十九个，与 src/minimal-eval.mjs 里那张表一一对应。
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
    try { buf = vm.cap.file.read(路径); }
    catch (err) { return vm.坏("HMYR-R0211", "cannot read '" + 路径 + "': " + String(err && err.message ? err.message : err)); }
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
