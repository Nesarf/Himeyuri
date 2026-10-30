// 六个字符串内置的验收：既有正常路径，也有三条拒绝。
//
// 那三条编号（HMYR-內-006 / HMYR-內-007 / HMYR-內-008）必须被真正触发一次——语言那边登记的编号
// 不能只是写着好看。这一套同时是「先动语言」那条规矩的落点：此前这些能力
// 是靠手写替代品绕过去的（截、片段、十项码位表、二十六项大小写表）。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const rt = runUnit(loadUnit(path.join(ROOT, "term.hmoca")));   // 借它拿一个求值器
const 跑 = (body) => {
  const src = "fn main() -> Int { print(" + body + ") return 0 }\n";
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });
  const errs = d.items.filter((x) => x.s === "error");
  if (errs.length) return { out: null, error: "解析报错 " + errs.map((x) => x.c).join(",") };
  let out = "";
  rt.write = (s) => { out += s; };
  rt.registerModule(ast);
  try { rt.callFunction(rt.functions.get("main"), [], null); return { out, error: null }; }
  catch (e) { return { out: null, error: (e.code || "") + " " + e.message }; }
};
const 值 = (body) => { const r = 跑(body); return r.out; };

console.log("slice：截一段");
ok("中间的四个字符", 值('slice("abcdef", 1, 4)') === "bcd", JSON.stringify(值('slice("abcdef", 1, 4)')));
ok("越界会被夹到边界", 值('slice("abc", -5, 99)') === "abc", JSON.stringify(值('slice("abc", -5, 99)')));
ok("起止相同给空串", 值('slice("abcdef", 3, 3)') === "");
ok("起大于止也给空串", 值('slice("abcdef", 4, 2)') === "");
ok("省掉止就到最后", 值('slice("abcdef", 3)') === "def", JSON.stringify(值('slice("abcdef", 3)')));

console.log("ord / chr：字符与码位");
ok("ord 给出 A 的码位", 值('str(ord("A"))') === "65");
ok("chr 给出 H 与 i", 值('chr(72) + chr(105)') === "Hi");
ok("往返一致（绕过中文）", 值('chr(ord("中"))') === "中", JSON.stringify(值('chr(ord("中"))')));
ok("代理对：一个表情也是一个码位", 值('str(ord("🎉"))') === "127881", JSON.stringify(值('str(ord("🎉"))')));

console.log("to_upper / to_lower");
ok("小写转大写", 值('to_upper("himeyuri")') === "HIMEYURI");
ok("大写转小写", 值('to_lower("HIMEYURI")') === "himeyuri");
ok("别的文字不受影响", 值('to_upper("中文")') === "中文");

console.log("to_int：只认整数写法");
ok("前后空白会被吃掉", 值('str(to_int("  -42  "))') === "-42");
ok("正数", 值('str(to_int("7"))') === "7");

console.log("三条拒绝：登记的编号要被真正触发");
{
  const r1 = 跑('str(ord(""))');
  ok("空串取码位被拒绝（HMYR-內-006）", r1.error && r1.error.includes("HMYR-內-006"), String(r1.error));
  const r2 = 跑("chr(-1)");
  ok("超出范围的码位被拒绝（HMYR-內-007）", r2.error && r2.error.includes("HMYR-內-007"), String(r2.error));
  const r3 = 跑('str(to_int("4.2"))');
  ok("不是整数写法被拒绝（HMYR-內-008）", r3.error && r3.error.includes("HMYR-內-008"), String(r3.error));
  const r4 = 跑('str(to_int("abc"))');
  ok("乱写也被拒绝，不猜成零", r4.error && r4.error.includes("HMYR-內-008"), String(r4.error));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
