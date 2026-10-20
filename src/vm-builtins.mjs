// 字节码那份执行器的内置表：十六个，与 src/minimal-eval.mjs 里那张表一一对应。
//
// 两张表不一致时行为会分叉，而分叉的那一头最容易被漏掉。所以这里不另写一套逻辑：
// 每一条都照 minimal-eval 的实现抄，只把形状从 (rt, args) 换成 { 效果, 做(vm, args) }——
// 「需不需要效果」从一张旁表挪到条目自己身上，于是少了一处对不上。
//
// 世界仍然从那一个对象里取（vm.cap）。这一份文件不 import 任何 node: 模块。
export const 内置表 = {
  len: { 做: (vm, a) => {
    const v = a[0];
    if (typeof v === "string" || Array.isArray(v)) return v.length;
    vm.坏("HMYR-R0140", "len() wants a string or a tuple");
  } },
  str: { 做: (vm, a) => vm.成串(a[0]) },
  slice: { 做: (vm, a) => {
    const s = vm.成串(a[0]);
    const 起 = a[1] === undefined || a[1] === null ? 0 : Math.max(0, Math.floor(vm.成数(a[1])));
    const 止 = a[2] === undefined || a[2] === null ? s.length : Math.min(s.length, Math.floor(vm.成数(a[2])));
    return 起 >= 止 ? "" : s.slice(起, 止);
  } },
  chr: { 做: (vm, a) => {
    const cp = Math.floor(vm.成数(a[0]));
    if (cp < 0 || cp > 0x10ffff) vm.坏("HMYR-R0207", "not a code point: " + cp);
    return String.fromCodePoint(cp);
  } },
  to_int: { 做: (vm, a) => {
    const s = vm.成串(a[0]).trim();
    if (!/^-?[0-9]+$/.test(s)) vm.坏("HMYR-R0208", "not an integer literal: '" + s + "'");
    return Number(s);
  } },
  nfc: { 做: (vm, a) => String(a[0]).normalize("NFC") },
  is_letter: { 做: (vm, a) => /\p{L}/u.test(String(a[0])) },
  is_mark: { 做: (vm, a) => /\p{M}/u.test(String(a[0])) },
  record_new: { 做: (vm, a) => {
    const pairs = a[0];
    if (!Array.isArray(pairs)) vm.坏("HMYR-R0214", "record_of wants a tuple of (name, value) pairs");
    const out = {};
    for (const p of pairs) {
      if (!Array.isArray(p) || p.length !== 2) vm.坏("HMYR-R0214", "every item must be a (name, value) pair");
      const k = vm.成串(p[0]);
      if (!/^[\p{L}_][\p{L}\p{N}\p{M}_]*$/u.test(k)) vm.坏("HMYR-R0214", "not a name a record could hold: " + JSON.stringify(k));
      out[k] = p[1];
    }
    return out;
  } },
  field_get: { 做: (vm, a) => {
    const rec = a[0], name = vm.成串(a[1]);
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) vm.坏("HMYR-R0215", "field_get wants a record, found " + 述(rec));
    if (!Object.prototype.hasOwnProperty.call(rec, name)) vm.坏("HMYR-R0216", "no field '" + name + "' on that record");
    return rec[name];
  } },
  field_has: { 做: (vm, a) => {
    const rec = a[0], name = vm.成串(a[1]);
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) return false;
    return Object.prototype.hasOwnProperty.call(rec, name);
  } },
  print: { 做: (vm, a) => { vm.write(a.map((x) => vm.成串(x)).join("")); return null; } },
  print_err: { 效果: "process", 做: (vm, a) => {
    const 文 = a.map((x) => vm.成串(x)).join("");
    if (vm.writeErr) vm.writeErr(文); else vm.write(a.map((x) => vm.成串(x)).join(""));
    return null;
  } },
  read_text: { 效果: "file", 做: (vm, a) => {
    const 路径 = String(a[0]);
    let buf;
    try { buf = vm.cap.file.read(路径); }
    catch (err) { vm.坏("HMYR-R0211", "cannot read '" + 路径 + "': " + String(err && err.message ? err.message : err)); }
    const enc = a[1] === undefined || a[1] === null ? null : vm.成串(a[1]);
    if (enc) {
      const 名 = String(enc).toLowerCase();
      if (名 === "utf8" || 名 === "utf-8") return buf.toString("utf8");
      if (名 === "utf16le" || 名 === "utf-16le") return new TextDecoder("utf-16le").decode(buf);
      if (名 === "latin1") return buf.toString("latin1");
      vm.坏("HMYR-R0212", "this runtime cannot decode '" + enc + "'");
    }
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
    return buf.toString("utf8");
  } },
  file_exists: { 效果: "file", 做: (vm, a) => {
    try { return vm.cap.file.exists(String(a[0])); } catch (err) { return false; }
  } },
  argv: { 效果: "process", 做: (vm) => (vm.argv || []).map((x) => String(x)) },
};

// 错误消息里要用「这个值长什么样」。这一份与 src/vm.mjs 里那份相同，而刻意不共享：
// 两个模块互相 import 会把依赖绕成环，而这两个小函数不值得为它绕环。
const 述 = (v) => {
  if (v === null) return "nil";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "tuple";
  if (typeof v === "object") return "a host object";
  return String(v);
};
