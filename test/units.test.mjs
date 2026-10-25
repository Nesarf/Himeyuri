// 码元序列：同一套字符串规矩，换一个底。
//
// 判据是逐码元对得上的：src/text.mjs 那一套规矩（长度按码元、下标取一个码元、
// 比较按码元序）在 Uint16Array 上重写一遍，然后与宿主的字符串逐条对照。
//
// 随机串里故意放进代理区（0xD800 到 0xDFFF）的单个码元 —— 那是落单代理，
// 一个真正的字符不会这么出现，而码元序列允许它存在。规矩说下标取一个码元，
// 那就得连半边也取得出来。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/eval.mjs";
import { loadUnit } from "../src/loader.mjs";
import { 最小运行 } from "../src/minimal-eval.mjs";
import { 跑字节码 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";
import * as u from "../src/units.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

let 种 = 20261027;
const 随 = () => { 种 = (种 * 1103515245 + 12345) % 2147483648; return 种 / 2147483648; };
const 随串 = (长) => {
  let s = "";
  for (let i = 0; i < 长; i++) s += String.fromCharCode(Math.floor(随() * 0x10000));
  return s;
};

console.log("一、一千个随机串：每一项操作都与宿主的串对得上");
{
  const 坏 = [];
  for (let n = 0; n < 1000; n++) {
    const s = 随串(Math.floor(随() * 12));
    const t = 随串(Math.floor(随() * 12));
    const a = u.由宿主(s), b = u.由宿主(t);
    if (u.长(a) !== s.length) 坏.push("长");
    if (u.成宿主(a) !== s) 坏.push("往返");
    for (let i = -1; i <= s.length; i++) {
      const 在 = u.在界内(a, i);
      const 应 = i >= 0 && i < s.length;
      if (在 !== 应) 坏.push("界内 " + i);
      if (在 && u.元(a, i) !== s.charCodeAt(i)) 坏.push("元 " + i);
    }
    // 切片只在合法区间里对照：两边都要求调用处先把负数与超界夹好，
    // 而「夹到哪一头」是内置表那一侧的规矩，不在这里重复一遍。
    const 起 = Math.floor(随() * (s.length + 1));
    const 止 = 起 + Math.floor(随() * (s.length - 起 + 1));
    if (u.成宿主(u.切(a, 起, 止)) !== s.slice(起, 止)) 坏.push("切 " + 起 + " " + 止);
    if (u.成宿主(u.拼(a, b)) !== s + t) 坏.push("拼");
    const 应比 = s < t ? -1 : s > t ? 1 : 0;
    if (u.比(a, b) !== 应比) 坏.push("比");
    if (坏.length > 4) break;
  }
  ok("一千个串、每一项都对得上", 坏.length === 0, 坏.slice(0, 4).join(" · "));
}

console.log("二、码点：代理对是怎么算出来的");
{
  const 例 = [0, 65, 0xD7FF, 0xD800, 0xDFFF, 0xE000, 0xFFFF, 0x10000, 0x1F600, 0x10FFFF];
  let 全同 = true, 错 = "";
  for (const cp of 例) {
    const 得 = u.码点(cp);
    if (!得) { 全同 = false; 错 = "码点 " + cp + " 交回 null"; break; }
    const 应 = String.fromCodePoint(cp);
    if (u.成宿主(得) !== 应) { 全同 = false; 错 = "码点 " + cp + " 成了 " + u.述(得); break; }
  }
  ok("十个码点（含代理区两端与星平面）都与宿主一字不差", 全同, 错);
  ok("星平面那个是两码元", u.长(u.码点(0x1F600)) === 2);
  ok("它第一个码元落在高位代理区", u.元(u.码点(0x1F600), 0) >= 0xD800 && u.元(u.码点(0x1F600), 0) <= 0xDBFF);
  ok("它第二个码元落在低位代理区", u.元(u.码点(0x1F600), 1) >= 0xDC00 && u.元(u.码点(0x1F600), 1) <= 0xDFFF);
  ok("代理区里的码点只出一个码元（落单代理）", u.长(u.码点(0xD800)) === 1);
  ok("超出范围的码点交回 null", u.码点(0x110000) === null && u.码点(-1) === null);
}

console.log("三、边界：空、半边、长短不一");
{
  const 空 = u.由宿主("");
  ok("空串长度是零", u.长(空) === 0);
  ok("空串里没有界内的位置", !u.在界内(空, 0));
  ok("空串切成空串", u.长(u.切(空, 0, 5)) === 0);
  ok("空串拼上非空就是那一个", u.成宿主(u.拼(空, u.由宿主("ab"))) === "ab");

  const 两 = u.码点(0x1F600);
  ok("取半个代理对，拿到的是那一个半边", u.元(两, 0) === 0xD83D);
  ok("另一个半边也在", u.元(两, 1) === 0xDE00);
  ok("它的长度是二", u.长(两) === 2);

  ok("前缀相同的短串更小", u.比(u.由宿主("ab"), u.由宿主("abc")) === -1);
  ok("同一个串比出来是零", u.比(u.由宿主("ab"), u.由宿主("ab")) === 0);
  ok("大写字母小于小写字母（按码元）", u.比(u.由宿主("Z"), u.由宿主("a")) === -1);
  ok("一个字面量字符与它的码元是同一个东西", u.成宿主(u.由宿主("中")) === "中");
}

console.log("四、已经接到最小求值器上：打开开关，十六条与宿主求值器一致");
{
  // 开关叫 字符串用码元序列。打开之后，语言的每一个字符串值都是 Uint16Array，
  // 宿主串只在字面量进来与输出出去这两处出现。这一节要的是「答案不变」。
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-units-"));
  const 案子 = [
    "len(\"abc\")", "len(\"abcdef\")", "slice(\"abcdef\", 1, 3)", "\"abc\"[1]",
    "\"a\" + \"b\"", "\"abc\" + 1", "str(\"abc\")", "\"a\" < \"b\"",
    "\"abc\" == \"abc\"", "chr(65)", "len(chr(128512))", "chr(128512) == chr(128512)",
    "str(len(\"abcd\"))", "slice(\"abc\", 2, 1)", "nfc(\"e\")", "is_letter(\"a\")",
  ];
  const 描述 = (v) => {
    if (typeof v === "number") return "num:" + String(v);
    if (typeof v === "string") return "str:" + JSON.stringify(v);
    if (v instanceof Uint16Array) return "str:" + JSON.stringify(u.成宿主(v));
    if (typeof v === "boolean") return "bool:" + v;
    if (v === null) return "nil";
    if (Array.isArray(v)) return "聚合:tuple";
    return "对象";
  };
  let 分叉 = 0;
  const 例 = [];
  try {
    for (const 源 of 案子) {
      const 文 = "fn main() -> Int {\n  return " + 源 + "\n}\n";
      const p = path.join(临, "case.hmyr");
      fs.writeFileSync(p, 文);
      const r = run(文);
      const 甲 = r.diagnostics.errors.length ? "错:" + r.diagnostics.errors[0].code : 描述(r.value);
      const 层 = loadUnit(p);
      if (!层.ok) { 分叉++; 例.push("读不进 " + 源); continue; }
      let 乙;
      try {
        const rt = 最小运行(层, { write: () => {}, capabilities: 本机能力(), argv: ["hmyr", p], 字符串用码元序列: true });
        乙 = 描述(rt.callFunction(rt.functions.get("main"), [], null));
      } catch (e) {
        乙 = "错:" + (e.code || "?");
      }
      if (甲 !== 乙) { 分叉++; 例.push(源 + " -> " + 甲 + " / " + 乙); }
    }
  } finally {
    fs.rmSync(临, { recursive: true, force: true });
  }
  ok(案子.length + " 条里没有一处分叉", 分叉 === 0, 例.slice(0, 4).join(" · "));
}

console.log("五、字节码那边也打开同一个开关，三条路仍然一致");
{
  // 选项名一样，两条执行路就能一起换。这一节要的是「三条路给同一个答案」：
  // 宿主求值器用宿主串，最小求值器与字节码用码元序列。
  const 临2 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-units-vm-"));
  const 案子 = [
    "len(\"abc\")", "slice(\"abcdef\", 1, 3)", "\"abc\"[1]", "\"a\" + \"b\"",
    "\"abc\" + 1", "str(\"abc\")", "\"a\" < \"b\"", "\"abc\" == \"abc\"",
    "chr(65)", "len(chr(128512))", "chr(128512) == chr(128512)", "str(len(\"abcd\"))",
    "slice(\"abc\", 2, 1)", "nfc(\"e\")", "is_letter(\"a\")",
  ];
  const 描述 = (v) => {
    if (typeof v === "number") return "num:" + String(v);
    if (typeof v === "string") return "str:" + JSON.stringify(v);
    if (v instanceof Uint16Array) return "str:" + JSON.stringify(u.成宿主(v));
    if (typeof v === "boolean") return "bool:" + v;
    if (v === null) return "nil";
    if (Array.isArray(v)) return "聚合:tuple";
    return "对象";
  };
  let 分叉 = 0;
  const 例 = [];
  try {
    for (const 源 of 案子) {
      const 文 = "fn main() -> Int {\n  return " + 源 + "\n}\n";
      const p = path.join(临2, "case.hmyr");
      fs.writeFileSync(p, 文);
      const r = run(文);
      const 甲 = r.diagnostics.errors.length ? "错:" + r.diagnostics.errors[0].code : 描述(r.value);
      const 层 = loadUnit(p);
      if (!层.ok) { 分叉++; 例.push("读不进 " + 源); continue; }
      let 乙, 丙;
      try {
        const rt = 最小运行(层, { write: () => {}, capabilities: 本机能力(), argv: ["hmyr", p], 字符串用码元序列: true });
        乙 = 描述(rt.callFunction(rt.functions.get("main"), [], null));
      } catch (e) { 乙 = "错:" + (e.code || "?"); }
      try {
        const vm = 跑字节码(层, { write: () => {}, capabilities: 本机能力(), argv: ["hmyr", p], 字符串用码元序列: true });
        const q = vm.调用("main", [], null);
        丙 = q.ok ? 描述(q.值) : "错:" + q.码;
      } catch (e) { 丙 = "错:" + (e.code || "?"); }
      if (!(甲 === 乙 && 乙 === 丙)) { 分叉++; 例.push(源 + " -> " + 甲 + " / " + 乙 + " / " + 丙); }
    }
  } finally {
    fs.rmSync(临2, { recursive: true, force: true });
  }
  ok("十五条文本程序，三条路一个答案", 分叉 === 0, 例.slice(0, 3).join(" · "));

  // 默认就是码元序列。这一条盯的是「默认」本身 —— 上面几节都在显式传选项，
  // 谁把默认悄悄改回去它们不会红。翻默认之前它红过一次：那时 packValue 把码元序列
  // 当成记录编，self-vm-compile 的「if 与字符串」多出 44 字节。
  {
    const 临三 = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/hmyr-units-default-");
    try {
      const p = path.join(临三, "默认.hmyr");
      fs.writeFileSync(p, "fn main() -> Int {\n  return \"abc\"\n}\n");
      const 层 = loadUnit(p);
      const vm = 跑字节码(层, { write: () => {}, capabilities: 本机能力(), argv: ["hmyr", p] });
      const q = vm.调用("main", [], null);
      ok("不传选项时，默认的字符串底是码元序列", q.ok && q.值 instanceof Uint16Array,
        q.ok ? Object.prototype.toString.call(q.值) : String(q.码));
    } finally {
      fs.rmSync(临三, { recursive: true, force: true });
    }
  }
}

console.log("六、这一份借了什么");
{
  // 判据要剥掉注释：注释里提到那个名字，是为了说明「这里借的是什么」，那不算借。
  const 剥注释 = (文) => 文.replace(/^[ \t]*\/\/.*$/gm, " ").replace(/([^:])\/\/.*$/gm, "$1");
  const 源 = 剥注释(fs.readFileSync(path.join(ROOT, "src/units.mjs"), "utf8"));
  ok("它没有 .slice(", !/\.slice\(/.test(源));
  ok("它没有 String.prototype", !源.includes("String.prototype"));
  ok("它只在两处碰字符与码元之间那道转换（charCodeAt 与 fromCharCode 各一次）",
    (源.match(/charCodeAt/g) || []).length === 1 && (源.match(/fromCharCode/g) || []).length === 1,
    String((源.match(/charCodeAt/g) || []).length) + " / " + String((源.match(/fromCharCode/g) || []).length));
  ok("除了那块内存与那一个原语，它不碰别的东西", !/Buffer|TextEncoder|encodeURI/.test(源));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
