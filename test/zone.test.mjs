// 区（zone）的记账那一半：freeze 与 adopt。
//
// design/MEMORY.txt 定了三区模型与三条硬规则，其中第一条是「不静默换区」——
// 而这一套验的就是那条规则在桩这一层能检查的部分：块带一个看得见的 zone，
// freeze 把它交给托管区，adopt 把它收回来，走错有编号。
//
// 这一套不验、也不该验的：真内存、真释放、逃逸的编译期检查。那三件要么在第三层
// （机器层），要么在编译器里，都还没到。所以这里每一条都是「记账对不对」，
// 而不是「内存安不安全」—— 把这两件事说清楚，比多验几条重要。
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { Runtime } from "../src/eval.mjs";

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 跑 = (body) => {
  const src = "fn main() -> Int {\n  " + body + "\n}\n";
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });
  const errs = d.items.filter((x) => x.s === "error");
  if (errs.length) return { error: "解析报错 " + errs.map((x) => x.c).join(",") };
  let out = "";
  const rt = new Runtime({});
  rt.write = (s) => { out += s; };
  rt.registerModule(ast);
  try { rt.callFunction(rt.functions.get("main"), [], null); return { out }; }
  catch (e) { return { error: (e.code || "") + " " + e.message }; }
};

console.log("一、arena 交回的块带着区");
ok("块在竞技场区里", 跑('let a = arena()\n  let b = a.alloc(16)\n  print(b.zone)').out === "arena");
ok("大小照给的数", 跑('let a = arena()\n  let b = a.alloc(16)\n  print(str(b.size))').out === "16");
ok("记账里有一块", 跑('let a = arena()\n  let b = a.alloc(16)\n  print(str(a.held()))').out === "1");
ok("块是活的", 跑('let a = arena()\n  let b = a.alloc(4)\n  if b.live { print("live") }') .out === "live");

console.log("二、freeze 交给托管区");
ok("区名换成 managed", 跑('let a = arena()\n  let b = a.alloc(16)\n  a.freeze(b)\n  print(b.zone)').out === "managed");
// 这一条是 freeze 的全部意义：交出之后，那个 arena 关掉也不带走它。
ok("交出之后不再记账", 跑('let a = arena()\n  let b = a.alloc(16)\n  a.freeze(b)\n  print(str(a.held()))').out === "0");
ok("arena 关了它仍然活着", 跑('let a = arena()\n  let b = a.alloc(16)\n  a.freeze(b)\n  a.close()\n  if b.live { print("alive") } else { print("dead") }').out === "alive");
ok("交回的仍是同一条记录（不移动）", 跑('let a = arena()\n  let b = a.alloc(16)\n  let c = a.freeze(b)\n  print(str(c.size))').out === "16");

console.log("三、adopt 收回来");
ok("区名换回 arena", 跑('let a = arena()\n  let b = a.alloc(8)\n  a.freeze(b)\n  a.adopt(b)\n  print(b.zone)').out === "arena");
ok("又记账了", 跑('let a = arena()\n  let b = a.alloc(8)\n  a.freeze(b)\n  a.adopt(b)\n  print(str(a.held()))').out === "1");
ok("这回 close 带走了它", 跑('let a = arena()\n  let b = a.alloc(8)\n  a.freeze(b)\n  a.adopt(b)\n  a.close()\n  if b.live { print("alive") } else { print("dead") }').out === "dead");
// 已经被关掉的区交出来的块，收养它同样被拒：那块内存已经没了，
// 收回来只是把一块死内存记在账上 —— 记账错的地方比不记账更坏。
{
  const r = 跑('let a = arena()\n  let b = arena()\n  let x = b.alloc(4)\n  b.close()\n  a.adopt(x)');
  ok("收养一个已关闭区的块给 R0302", r.error && r.error.includes("HMYR-R0302"), String(r.error).slice(0, 80));
}

console.log("四、走错的两个编号");
{
  const r = 跑('let a = arena()\n  a.freeze(1)');
  ok("freeze 拿到不是块的东西给 R0302", r.error && r.error.includes("HMYR-R0302"), String(r.error).slice(0, 80));
}
{
  const r = 跑('let a = arena()\n  let b = a.alloc(4)\n  a.close()\n  a.freeze(b)');
  ok("freeze 拿到已关闭区的块给 R0302", r.error && r.error.includes("HMYR-R0302"), String(r.error).slice(0, 80));
}
{
  const r = 跑('let a = arena()\n  let b = arena()\n  let x = b.alloc(4)\n  a.freeze(x)');
  ok("freeze 拿到别人家的块给 R0302", r.error && r.error.includes("HMYR-R0302"), String(r.error).slice(0, 80));
}
{
  const r = 跑('let a = arena()\n  let b = arena()\n  let x = b.alloc(4)\n  a.adopt(x)');
  ok("adopt 一块两处拥有的块给 R0303", r.error && r.error.includes("HMYR-R0303"), String(r.error).slice(0, 80));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
