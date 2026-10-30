// 宿主能力契约的验收：先只验「文件」这一组的拒绝路径。
//
// 契约在 design/CAPABILITIES.txt。这一套要钉住的是：读不到与写不进都不抛宿主的原始异常，
// 而是给出稳定的编号——因为「拒绝时给哪个编号」是契约的一部分。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { Runtime } from "../src/eval.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 跑 = (src) => {
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });
  const errs = d.items.filter((x) => x.s === "error");
  if (errs.length) return { error: "解析报错 " + errs.map((x) => x.c).join(",") };
  const rt = new Runtime({});
  let out = "";
  rt.write = (s) => { out += s; };
  rt.registerModule(ast);
  try { return { value: rt.callFunction(rt.functions.get("main"), [], null), out }; }
  catch (e) { return { error: (e.code || "") + " " + e.message }; }
};

console.log("读不到：给出编号 HMYR-內-011");
{
  const r = 跑('fn main() -> Int effects(file) { print(read_text("E:/definitely-missing-9f3a.txt")) return 0 }\n');
  ok("缺文件时是 HMYR-內-011", r.error && r.error.includes("HMYR-內-011"), String(r.error).slice(0, 90));
  ok("而且带着宿主的说法（不吞掉原因）", r.error && r.error.includes("cannot read"), String(r.error).slice(0, 90));
}
console.log("写不进：给出编号 HMYR-內-012");
{
  const r = 跑('fn main() -> Int effects(file) { write_text("E:/no-such-dir-9f3a/x.txt", "hello") return 0 }\n');
  ok("目录不存在时是 HMYR-內-012", r.error && r.error.includes("HMYR-內-012"), String(r.error).slice(0, 90));
}
console.log("正常路径不受影响");
{
  const tmp = "E:/DaShaoHuo/cache/tmp/caps-ok.txt";
  const r = 跑('fn main() -> Int effects(file) { print(str(write_text("' + tmp + '", "hello"))) return 0 }\n');
  // 写入的长度是被 print 写在输出里的；main 的返回值是零，两者别弄混。
  ok("写得进时交回写入的长度", r.out === "5", JSON.stringify(r.out));
  ok("内容真的落盘了", fs.existsSync(tmp) && fs.readFileSync(tmp, "utf8") === "hello");
  fs.rmSync(tmp, { force: true });
  const r2 = 跑('fn main() -> Int effects(file) { print(read_text("' + tmp + '")) return 0 }\n');
  ok("读一个刚删掉的文件也给编号（不静默）", r2.error && r2.error.includes("HMYR-內-011"), String(r2.error).slice(0, 60));
}

console.log("进程组：返回形状是记录，跑不起来时带宿主的错误码");
{
  const r = 跑('fn main() -> Int effects(process) {\n  let x = run_program("definitely-no-such-cmd-9f3a", ())\n  print(str(x.code) + "|" + str(x.error))\n  return 0\n}\n');
  ok("跑不起来的程序交回记录，不是抛", !r.error, String(r.error).slice(0, 70));
  ok("code 是 -1、error 带宿主的错误码", r.out && r.out.split("|")[0] === "-1" && r.out.includes("ENOENT"), JSON.stringify(r.out));
  const r2 = 跑('fn main() -> Int effects(process) {\n  let x = run_program("", ())\n  return 0\n}\n');
  ok("空程序名给编号 HMYR-內-013", r2.error && r2.error.includes("HMYR-內-013"), String(r2.error).slice(0, 70));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
