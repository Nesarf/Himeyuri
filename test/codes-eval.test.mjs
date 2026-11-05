// 一个编号一个用例：求值层那七条。
//
// 这些编号都不是词法或语法能抓到的：要真跑到求值那一步才会出现。
// 所以这一套用 run() 跑完整程序，再看诊断里有没有那个编号。
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

console.log("HMYR-行-001 · HMYR-行-002 · HMYR-行-005");
// 2026-11-05：这一条原来把同一个程序跑了两次（条件里一次、detail 里一次），
// 而 detail 只在失败时才用得上。纯尾递归那条一次十一秒，两次就是二十二秒。
{
  const 码 = 跑("fn helper() -> Int {\n  return 1\n}\n");
  ok("HMYR-行-001 没有 main", 码.includes("HMYR-行-001"), JSON.stringify(码));
}
// 用自定函数的参数个数来触发：len() 无参会先撞上 HMYR-行-015（给了没有长度的东西）。
// 2026-11-05：这一条原来把同一个程序跑了两次（条件里一次、detail 里一次），
// 而 detail 只在失败时才用得上。纯尾递归那条一次十一秒，两次就是二十二秒。
{
  const 码 = 跑("fn f(a: Int) -> Int {\n  return a\n}\nfn main() -> Int {\n  return f()\n}\n");
  ok("HMYR-行-002 参数个数不对", 码.includes("HMYR-行-002"), JSON.stringify(码));
}
// 2026-11-05：这一条原来把同一个程序跑了两次（条件里一次、detail 里一次），
// 而 detail 只在失败时才用得上。纯尾递归那条一次十一秒，两次就是二十二秒。
{
  const 码 = 跑("fn main() -> Int {\n  return nope\n}\n");
  ok("HMYR-行-005 名字不在作用域", 码.includes("HMYR-行-005"), JSON.stringify(码));
}

console.log("HMYR-行-006 · HMYR-行-007 · HMYR-行-008");
// 2026-11-05：这一条原来把同一个程序跑了两次（条件里一次、detail 里一次），
// 而 detail 只在失败时才用得上。纯尾递归那条一次十一秒，两次就是二十二秒。
{
  const 码 = 跑('fn main() -> Int {\n  return match 9 { 1 => 1 }\n}\n');
  ok("HMYR-行-006 match 没有分支接住", 码.includes("HMYR-行-006"), JSON.stringify(码));
}
// 2026-11-05：这一条原来把同一个程序跑了两次（条件里一次、detail 里一次），
// 而 detail 只在失败时才用得上。纯尾递归那条一次十一秒，两次就是二十二秒。
{
  const 码 = 跑("fn main() -> Int {\n  let r = {a: 1}\n  return r.b\n}\n");
  ok("HMYR-行-007 字段不存在", 码.includes("HMYR-行-007"), JSON.stringify(码));
}
// 2026-11-05：这一条原来把同一个程序跑了两次（条件里一次、detail 里一次），
// 而 detail 只在失败时才用得上。纯尾递归那条一次十一秒，两次就是二十二秒。
{
  const 码 = 跑("fn main() -> Int {\n  let x = 1\n  return x()\n}\n");
  ok("HMYR-行-008 被调的不是可调用", 码.includes("HMYR-行-008"), JSON.stringify(码));
}

console.log("HMYR-行-009 调用深度超限");
{
  // 尾调用之后，「纯尾递归」不再撞深度：它撞的是步数。
  // 两条都在这里钉住，因为它们是两种不同的 runaway：
  //   非尾递归（要保留这一层）  → 撞深度 HMYR-行-009
  //   尾递归（不必保留这一层）  → 撞步数 HMYR-行-003
  const 非尾 = "fn f(n: Int) -> Int {\n  return 1 + f(n + 1)\n}\nfn main() -> Int {\n  return f(0)\n}\n";
  // 2026-11-05：这一条原来把同一个程序跑了两次（条件里一次、detail 里一次），
  // 而 detail 只在失败时才用得上。纯尾递归那条一次十一秒，两次就是二十二秒。
  {
    const 码 = 跑(非尾);
    ok("HMYR-行-009 非尾递归撞上深度上限", 码.includes("HMYR-行-009"), JSON.stringify(码));
  }
  const 尾 = "fn f() -> Int {\n  return f()\n}\nfn main() -> Int {\n  return f()\n}\n";
  // 2026-11-05：这一条原来把同一个程序跑了两次（条件里一次、detail 里一次），
  // 而 detail 只在失败时才用得上。纯尾递归那条一次十一秒，两次就是二十二秒。
  {
    const 码 = 跑(尾);
    ok("而纯尾递归撞的是步数（它不再占栈）", 码.includes("HMYR-行-003"), JSON.stringify(码));
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
