// 一个编号一个用例：最后十条。
//
// 这些大多是「值不对」的拒绝，每一条都只有一个自然的触发方式。
// 而 HMYR-內-001 与 HMYR-詞-002 是两道门：一个是效果系统的门，一个是字符集的门。
import { run } from "../src/eval.mjs";

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 跑 = (src) => {
  const r = run(src, {});
  return r.diagnostics.items.map((x) => x.code);
};
const 程序 = (body) => "fn main() -> Int {\n  " + body + "\n}\n";
const 断言 = (label, code, body) => ok(label, 跑(程序(body)).includes(code), JSON.stringify(跑(程序(body))));

console.log("值的拒绝");
断言("HMYR-行-012 除以零", "HMYR-行-012", "return 1 / 0");
断言("HMYR-行-013 要有数字", "HMYR-行-013", 'return "a" - 1');
断言("HMYR-行-014 两个值不能比", "HMYR-行-014", 'return 1 < "a"');

console.log("内置的拒绝");
断言("HMYR-行-015 len 没有长度", "HMYR-行-015", "return len(1)");
断言("HMYR-行-016 int 读不出", "HMYR-行-016", 'return int("abc")');

console.log("变量与下标");
断言("HMYR-行-017 给不可变的赋值", "HMYR-行-017", "let x = 1\n  x = 2\n  return x");
断言("HMYR-行-018 下标越界", "HMYR-行-018", 'return ("a", "b")[5]');
断言("HMYR-行-019 被下标的东西没有元素", "HMYR-行-019", "return 5[0]");

console.log("两道门");
{
  // 效果的门：main 没有声明 effects，而 chdir 要 process。
  // print 不算——它写到一个可替换的出口，不是动世界（这一条契约里也写着）。
  const codes = 跑('fn main() -> Int {\n  chdir("/")\n  return 0\n}\n');
  ok("HMYR-內-001 调用了调用者没声明的效果", codes.includes("HMYR-內-001"), JSON.stringify(codes));
}
{
  // 字符集的门：一个标识符里混了中文与拉丁
  const codes = 跑("fn main() -> Int {\n  let 名字abc = 1\n  return 名字abc\n}\n");
  ok("HMYR-詞-002 标识符混用文字", codes.includes("HMYR-詞-002"), JSON.stringify(codes));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
